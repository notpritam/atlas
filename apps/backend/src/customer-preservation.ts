import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { config } from "./config.ts";
import { accountPlan } from "./customer-plans.ts";
import {
  normalizeSocialContext,
  resolveTwitterPost,
  twitterPost,
  type SocialContext,
  type TwitterManifest,
} from "./customer-twitter.ts";
import {
  readPublicResource,
  type PublicReader,
} from "./customer-public-resource.ts";
import { fetchCustomerSource, type SourceSnapshot } from "./customer-source.ts";
import {
  preserveRemoteVideo,
  type RemoteDownloader,
} from "./customer-remote-preservation.ts";
import { downloadCustomerRemoteMedia } from "./customer-remote-media.ts";
import {
  writeCustomerFile,
  removeCustomerFile,
  type StoredCustomerFile,
} from "./customer-files.ts";
import { createRemoteFileSweeper } from "./customer-remote-cleanup.ts";
const BUNDLE_BYTES = 100 * 1024 * 1024,
  LEASE_MS = 300_000;
type Job = {
  capture_id: string;
  account_id: string;
  source_url: string;
  context_json: string;
  status: string;
  attempts: number;
  lease_token: string;
  created_at: number;
};
type Save = {
  source_url: string;
  source_title: string | null;
  selection_text: string | null;
  note_text: string | null;
  article_text: string | null;
  storage_bytes: number;
};
export function enqueuePreservation(
  db: Database,
  owner: string,
  id: string,
  source: string | null,
  context: SocialContext = normalizeSocialContext(null),
) {
  const post = twitterPost(source);
  if (!post) return;
  db.query(
    "INSERT OR IGNORE INTO customer_preservation_jobs(capture_id,account_id,source_url,context_json,created_at,updated_at) VALUES(?,?,?,?,?,?)",
  ).run(id, owner, post.url, JSON.stringify(context), Date.now(), Date.now());
}
export function preservationDetails(db: Database, owner: string, id: string) {
  const job = db
    .query(
      "SELECT status,attempts,error,updated_at AS updatedAt FROM customer_preservation_jobs WHERE capture_id=? AND account_id=?",
    )
    .get(id, owner) as {
    status: string;
    attempts: number;
    error: string | null;
    updatedAt: number;
  } | null;
  if (!job) return null;
  const assets = db
    .query(
      "SELECT id,kind,title,mime,bytes,sha256,source_url AS sourceUrl,body_text AS text,created_at AS createdAt FROM customer_media_assets WHERE capture_id=? AND account_id=? ORDER BY position,id",
    )
    .all(id, owner) as {
    id: string;
    kind: string;
    title: string;
    mime: string;
    bytes: number;
    sha256: string;
    sourceUrl: string;
    text: string | null;
    createdAt: number;
  }[];
  return {
    ...job,
    assets: assets.map((asset) => ({
      ...asset,
      url: `/api/captures/${id}/assets/${asset.id}`,
      downloadUrl: `/api/captures/${id}/assets/${asset.id}?download=1`,
    })),
  };
}
export function preparePreservedCleanup(
  db: Database,
  root: string,
  owner: string,
  id?: string,
) {
  const rows = db
    .query(
      `SELECT file_path FROM customer_media_assets WHERE account_id=?${id ? " AND capture_id=?" : ""}`,
    )
    .all(...(id ? [owner, id] : [owner])) as { file_path: string | null }[];
  return () => {
    for (const row of rows) removeCustomerFile(root, row.file_path);
  };
}
export function createPreservationService(
  db: Database,
  options: {
    root?: string;
    now?: () => number;
    read?: PublicReader;
    resolve?: (
      url: string,
      hints: SocialContext,
      signal: AbortSignal,
    ) => Promise<TwitterManifest>;
    remote?: RemoteDownloader;
    source?: (url: string) => Promise<SourceSnapshot>;
    globalMaxBytes?: number;
  } = {},
) {
  const root = options.root || config.dataDir,
    now = options.now || Date.now,
    read = options.read || readPublicResource;
  const globalMax =
    options.globalMaxBytes ??
    (Number(process.env.ATLAS_CUSTOMER_GLOBAL_MAX_BYTES) ||
      2 * 1024 * 1024 * 1024);
  const sweep = createRemoteFileSweeper(db, root);
  let busy = false,
    lastSweep = 0;
  function current(job: Job): Save | null {
    const row = db
      .query(
        "SELECT c.source_url,c.source_title,c.selection_text,c.note_text,c.article_text,c.storage_bytes FROM customer_captures c JOIN customer_preservation_jobs j ON j.capture_id=c.id AND j.account_id=c.account_id WHERE c.id=? AND c.account_id=? AND j.lease_token=? AND j.status='running'",
      )
      .get(job.capture_id, job.account_id, job.lease_token) as Save | null;
    return row && twitterPost(row.source_url)?.url === job.source_url
      ? row
      : null;
  }
  function existing(job: Job, key: string) {
    return !!db
      .query(
        "SELECT 1 FROM customer_media_assets WHERE capture_id=? AND source_key=?",
      )
      .get(job.capture_id, key);
  }
  function remaining(job: Job) {
    const used = db
      .query(
        "SELECT COALESCE(SUM(storage_bytes),0) total,COALESCE(SUM(CASE WHEN account_id=? THEN storage_bytes ELSE 0 END),0) own FROM customer_captures",
      )
      .get(job.account_id) as { total: number; own: number };
    const bundle = (
      db
        .query(
          "SELECT COALESCE(SUM(bytes),0) n FROM customer_media_assets WHERE capture_id=?",
        )
        .get(job.capture_id) as { n: number }
    ).n;
    return Math.max(
      0,
      Math.min(
        accountPlan(db, job.account_id, now()).limits.maxBytes - used.own,
        globalMax - used.total,
        BUNDLE_BYTES - bundle,
      ),
    );
  }
  function commit(
    job: Job,
    asset: {
      key: string;
      source: string;
      kind: string;
      position: number;
      title: string;
      mime: string;
      file?: StoredCustomerFile;
      text?: string;
    },
  ) {
    const bytes = asset.file?.bytes ?? Buffer.byteLength(asset.text || ""),
      sha =
        asset.file?.sha256 ||
        createHash("sha256")
          .update(asset.text || "")
          .digest("base64url");
    let stored = false;
    try {
      return db
        .transaction(() => {
          if (!current(job))
            throw Error("The saved source changed or was removed.");
          if (existing(job, asset.key)) return false;
          const used = db
            .query(
              "SELECT COALESCE(SUM(storage_bytes),0) total,COALESCE(SUM(CASE WHEN account_id=? THEN storage_bytes ELSE 0 END),0) own FROM customer_captures",
            )
            .get(job.account_id) as { total: number; own: number };
          const bundle = (
            db
              .query(
                "SELECT COALESCE(SUM(bytes),0) n FROM customer_media_assets WHERE capture_id=?",
              )
              .get(job.capture_id) as { n: number }
          ).n;
          if (
            used.own + bytes >
              accountPlan(db, job.account_id, now()).limits.maxBytes ||
            used.total + bytes > globalMax ||
            bundle + bytes > BUNDLE_BYTES
          )
            throw Error(
              "Storage limit reached. Saved files are kept; free space and retry.",
            );
          db.query(
            "INSERT INTO customer_media_assets(id,capture_id,account_id,source_key,source_url,kind,position,title,mime,file_path,body_text,bytes,sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          ).run(
            crypto.randomUUID(),
            job.capture_id,
            job.account_id,
            asset.key,
            asset.source,
            asset.kind,
            asset.position,
            asset.title.slice(0, 1000),
            asset.mime,
            asset.file?.relativePath || null,
            asset.text || null,
            bytes,
            sha,
            now(),
          );
          db.query(
            "UPDATE customer_captures SET storage_bytes=storage_bytes+?,updated_at=MAX(updated_at+1,?) WHERE id=? AND account_id=?",
          ).run(bytes, now(), job.capture_id, job.account_id);
          stored = true;
          return true;
        })
        .immediate();
    } finally {
      if (asset.file && !stored)
        removeCustomerFile(root, asset.file.relativePath);
    }
  }
  async function tick() {
    if (busy) return 0;
    busy = true;
    let job: Job | null = null;
    try {
      if (now() - lastSweep > 60_000) {
        sweep.sweep(now());
        lastSweep = now();
      }
      db.query(
        "UPDATE customer_preservation_jobs SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,lease_token=NULL,error='The download was interrupted. Retry to keep the remaining files.' WHERE status='running' AND lease_until<?",
      ).run(now());
      job = db
        .query(
          "UPDATE customer_preservation_jobs SET status='running',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE capture_id=(SELECT capture_id FROM customer_preservation_jobs WHERE status='pending' AND attempts<3 AND next_attempt_at<=? ORDER BY created_at LIMIT 1) RETURNING *",
        )
        .get(crypto.randomUUID(), now() + LEASE_MS, now(), now()) as Job | null;
      if (!job) return 0;
      const active = job;
      const signal = AbortSignal.timeout(210_000),
        save = current(job);
      if (!save) throw Error("The saved source changed or was removed.");
      const context = normalizeSocialContext(JSON.parse(job.context_json));
      const manifest = await (options.resolve || resolveTwitterPost)(
        job.source_url,
        context,
        signal,
      );
      signal.throwIfAborted();
      if (!current(job))
        throw Error("The saved source changed or was removed.");
      const issues: string[] = [];
      const captured = save.selection_text || save.article_text || "";
      const postText =
        captured.length > manifest.text.length ? captured : manifest.text;
      const archive = [
        manifest.author || save.source_title || "",
        manifest.publishedAt || "",
        job.source_url,
        "",
        postText || save.note_text || "",
      ].join("\n");
      commit(job, {
        key: "post",
        source: job.source_url,
        kind: "post",
        position: 0,
        title: "Saved post",
        mime: "text/plain",
        text: archive,
      });
      if (context.articleText)
        commit(job, {
          key: "visible-article",
          source: job.source_url,
          kind: "article",
          position: 1,
          title: "Article captured from X",
          mime: "text/plain",
          text: context.articleText,
        });
      const media = [...manifest.media];
      // Download only variants belonging to this post. A generic post extractor may
      // include quoted-post media and cannot establish that ownership when X is unavailable.
      for (const [index, item] of media.slice(0, 8).entries()) {
        signal.throwIfAborted();
        if (!current(job))
          throw Error("The saved source changed or was removed.");
        const key = "media:" + item.url;
        if (existing(job, key)) continue;
        try {
          const budget = remaining(job);
          if (!budget)
            throw Error(
              "Storage limit reached. Saved files are kept; free space and retry.",
            );
          if (item.kind === "video") {
            const result = await preserveRemoteVideo(
              item.url,
              root,
              signal,
              (url, opts) =>
                (options.remote || downloadCustomerRemoteMedia)(url, {
                  ...opts,
                  maxBytes: Math.min(budget, 50 * 1024 * 1024),
                }),
            );
            if (!result.file) {
              issues.push("A video copy was unavailable.");
              continue;
            }
            commit(job, {
              key,
              source: item.url,
              kind: "video",
              position: 10 + index,
              title: result.fileName || "Saved video.mp4",
              mime: result.file.mime,
              file: result.file,
            });
          } else {
            const data = await read(item.url, {
              maxBytes: Math.min(budget, 8 * 1024 * 1024),
              signal,
            });
            if (!["image/jpeg", "image/png", "image/webp"].includes(data.mime))
              throw Error("Unsupported image.");
            const file = await writeCustomerFile(
              new Request("http://local/image", {
                method: "POST",
                headers: {
                  "content-type": data.mime,
                  "content-length": String(data.data.length),
                },
                body: data.data,
              }),
              { root, namespace: "remote", maxBytes: 8 * 1024 * 1024 },
            );
            if (file.mime !== data.mime) {
              removeCustomerFile(root, file.relativePath);
              throw Error("Invalid image.");
            }
            commit(job, {
              key,
              source: item.url,
              kind: "image",
              position: 10 + index,
              title: `Photo ${index + 1}.${data.mime === "image/jpeg" ? "jpg" : data.mime.split("/")[1]}`,
              mime: file.mime,
              file,
            });
          }
        } catch (error) {
          if (!current(job)) throw error;
          issues.push(
            error instanceof Error && error.message.startsWith("Storage limit")
              ? error.message
              : "A media file could not be downloaded.",
          );
        }
      }
      for (const [index, url] of manifest.links.slice(0, 3).entries()) {
        signal.throwIfAborted();
        if (!current(job))
          throw Error("The saved source changed or was removed.");
        const key = "article:" + url;
        if (existing(job, key)) continue;
        try {
          const source = await (options.source || fetchCustomerSource)(url);
          signal.throwIfAborted();
          if (source.extractionStatus !== "readable" || !source.text)
            throw Error("Article unavailable.");
          commit(job, {
            key,
            source: source.url,
            kind: "article",
            position: 30 + index,
            title: source.title || "Linked article",
            mime: "text/plain",
            text: [source.title, source.author, source.url, "", source.text]
              .filter((x) => x != null)
              .join("\n"),
          });
        } catch (error) {
          if (!current(job)) throw error;
          issues.push(
            "A linked article was unavailable. The original link is kept.",
          );
        }
      }
      if (!manifest.metadataAvailable)
        issues.push(
          "X did not expose the full public post. The captured text and available files are kept.",
        );
      if (manifest.incomplete)
        issues.push(
          "Some attachments or long-form content were not exposed in a supported format. The original link is kept.",
        );
      const status = issues.length ? "partial" : "ready";
      db.query(
        "UPDATE customer_preservation_jobs SET status=?,error=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE capture_id=? AND lease_token=?",
      ).run(
        status,
        issues.length ? [...new Set(issues)].join(" ") : null,
        now(),
        active.capture_id,
        active.lease_token,
      );
      return 1;
    } catch {
      if (job)
        db.query(
          "UPDATE customer_preservation_jobs SET status=?,error='The remaining files could not be saved. Your existing copies are safe.',lease_token=NULL,lease_until=NULL,next_attempt_at=?,updated_at=? WHERE capture_id=? AND lease_token=?",
        ).run(
          job.attempts < 3 ? "pending" : "failed",
          now() + 30_000,
          now(),
          job.capture_id,
          job.lease_token,
        );
      return job ? 1 : 0;
    } finally {
      busy = false;
    }
  }
  return { tick, close: () => sweep.close() };
}
