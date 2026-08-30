import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import {
  CaptureIngest,
  CapturePatch,
  EnrichmentResult,
  type Capture,
  type FacetCount,
} from "@atlas/shared";
import {
  LEASE_STALE_MS,
  MAX_ENRICH_ATTEMPTS,
  RETRY_BACKOFF_MS,
} from "./config.ts";
import type { Env } from "./auth.ts";
import { requireScope } from "./auth.ts";
import { absBlobPath, storeBlob } from "./blobs.ts";
import {
  getCaptureRow,
  rowToCapture,
  type CaptureRow,
} from "./db.ts";
import { sha256hex, ulid } from "./ids.ts";

function getCapture(db: Database, id: string): Capture | null {
  const row = getCaptureRow(db, id);
  return row ? rowToCapture(row) : null;
}

/** Build a safe FTS5 MATCH string from arbitrary user text (prefix, AND). */
function ftsMatch(raw: string): string | null {
  const tokens = raw.match(/[\p{L}\p{N}]+/gu);
  if (!tokens?.length) return null;
  return tokens.map((t) => `"${t}"*`).join(" ");
}

interface BlobInput {
  bytes: Uint8Array;
  mime: string;
}

export async function createCapture(
  db: Database,
  ingest: CaptureIngest,
  blob: BlobInput | null,
  deviceId: string,
): Promise<Capture> {
  const now = Date.now();
  const id = ulid("cap");
  let blobPath: string | null = null;
  let blobMime: string | null = null;
  let blobBytes: number | null = null;
  let blobSha: string | null = null;

  if (blob) {
    const sha = sha256hex(blob.bytes);
    const existing = db
      .query(
        "SELECT blob_path FROM captures WHERE blob_sha256 = ? AND blob_path IS NOT NULL LIMIT 1",
      )
      .get(sha) as { blob_path: string } | undefined;
    blobPath = existing?.blob_path ?? (await storeBlob(blob.bytes, blob.mime)).relPath;
    blobMime = blob.mime;
    blobBytes = blob.bytes.length;
    blobSha = sha;
  }

  db.query(
    `INSERT INTO captures
      (id, type, status, source_url, source_title, favicon_url,
       selection_text, selection_context, note_text,
       blob_path, blob_mime, blob_bytes, blob_sha256, width, height,
       tags, associations, enrich_attempts, device_id, captured_at, created_at, updated_at)
     VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', 0, ?, ?, ?, ?)`,
  ).run(
    id,
    ingest.type,
    ingest.sourceUrl ?? null,
    ingest.sourceTitle ?? null,
    ingest.faviconUrl ?? null,
    ingest.selectionText ?? null,
    ingest.selectionContext ? JSON.stringify(ingest.selectionContext) : null,
    ingest.noteText ?? null,
    blobPath,
    blobMime,
    blobBytes,
    blobSha,
    ingest.width ?? null,
    ingest.height ?? null,
    deviceId,
    ingest.capturedAt ?? now,
    now,
    now,
  );
  return getCapture(db, id)!;
}

interface ListParams {
  type?: string | null;
  status?: string | null;
  tag?: string | null;
  category?: string | null;
  q?: string | null;
  cursor?: string | null;
  limit?: number | null;
}

export function listCaptures(
  db: Database,
  p: ListParams,
): { captures: Capture[]; nextCursor: string | null } {
  const limit = Math.min(Math.max(p.limit ?? 30, 1), 100);
  const where: string[] = [];
  const args: unknown[] = [];
  if (p.type) {
    where.push("c.type = ?");
    args.push(p.type);
  }
  if (p.status) {
    where.push("c.status = ?");
    args.push(p.status);
  }
  if (p.category) {
    where.push("c.category = ?");
    args.push(p.category);
  }
  if (p.tag) {
    where.push("c.tags LIKE ?");
    args.push(`%"${p.tag}"%`);
  }

  const match = p.q ? ftsMatch(p.q) : null;

  if (match) {
    // FTS branch: rank order, opaque numeric-offset cursor.
    const offset = p.cursor ? Number(p.cursor) || 0 : 0;
    const clauses = ["captures_fts MATCH ?", ...where];
    const rows = db
      .query(
        `SELECT c.* FROM captures c JOIN captures_fts f ON c.rowid = f.rowid
         WHERE ${clauses.join(" AND ")}
         ORDER BY bm25(captures_fts) LIMIT ? OFFSET ?`,
      )
      .all(match, ...args, limit + 1, offset) as CaptureRow[];
    const page = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? String(offset + limit) : null;
    return { captures: page.map(rowToCapture), nextCursor };
  }

  // Keyset branch: (created_at, id) DESC.
  if (p.cursor) {
    const [cAt, cId] = p.cursor.split("_");
    where.push("(c.created_at < ? OR (c.created_at = ? AND c.id < ?))");
    args.push(Number(cAt), Number(cAt), cId);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .query(
      `SELECT c.* FROM captures c ${whereSql}
       ORDER BY c.created_at DESC, c.id DESC LIMIT ?`,
    )
    .all(...args, limit + 1) as CaptureRow[];
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? `${last.created_at}_${last.id}` : null;
  return { captures: page.map(rowToCapture), nextCursor };
}

/** Lease up to `limit` claimable captures for the enrichment worker. */
export function claimCaptures(
  db: Database,
  owner: string,
  limit: number,
): Capture[] {
  const now = Date.now();
  const claim = db.transaction(() => {
    db.query(
      `UPDATE captures SET status='pending', lease_owner=NULL, updated_at=?
       WHERE status='processing' AND (lease_at IS NULL OR lease_at < ?)`,
    ).run(now, now - LEASE_STALE_MS);

    const ids = db
      .query(
        `SELECT id FROM captures
         WHERE status='pending'
            OR (status='failed' AND enrich_attempts < ? AND updated_at < ?)
         ORDER BY created_at ASC LIMIT ?`,
      )
      .all(MAX_ENRICH_ATTEMPTS, now - RETRY_BACKOFF_MS, limit) as {
      id: string;
    }[];

    const upd = db.query(
      "UPDATE captures SET status='processing', lease_owner=?, lease_at=?, updated_at=? WHERE id=?",
    );
    const out: Capture[] = [];
    for (const { id } of ids) {
      upd.run(owner, now, now, id);
      out.push(getCapture(db, id)!);
    }
    return out;
  });
  return claim();
}

export function applyEnrichment(
  db: Database,
  id: string,
  result: EnrichmentResult,
): Capture | null {
  if (!getCaptureRow(db, id)) return null;
  const now = Date.now();
  const sets: string[] = [];
  const args: unknown[] = [];
  const set = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    args.push(val);
  };
  const setIf = (col: string, val: string | null | undefined) => {
    if (val !== undefined && val !== null) set(col, val);
  };
  setIf("ocr_text", result.ocrText);
  setIf("description", result.description);
  setIf("summary", result.summary);
  setIf("category", result.category);
  setIf("article_text", result.articleText);
  setIf("lang", result.lang);
  setIf("model", result.model);
  if (result.tags) set("tags", JSON.stringify(result.tags));
  if (result.associations) set("associations", JSON.stringify(result.associations));

  if (result.status === "failed") {
    set("status", "failed");
    set("enrich_error", result.error ?? "unknown");
    sets.push("enrich_attempts = enrich_attempts + 1");
  } else {
    set("status", "done");
    set("enriched_at", now);
    set("enrich_error", null);
  }
  set("lease_owner", null);
  set("updated_at", now);

  db.query(`UPDATE captures SET ${sets.join(", ")} WHERE id = ?`).run(...args, id);
  return getCapture(db, id);
}

export function patchCapture(
  db: Database,
  id: string,
  patch: CapturePatch,
): Capture | null {
  if (!getCaptureRow(db, id)) return null;
  const sets: string[] = [];
  const args: unknown[] = [];
  const set = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    args.push(val);
  };
  if (patch.tags) set("tags", JSON.stringify(patch.tags));
  if (patch.category !== undefined && patch.category !== null)
    set("category", patch.category);
  if (patch.noteText !== undefined && patch.noteText !== null)
    set("note_text", patch.noteText);
  if (patch.summary !== undefined && patch.summary !== null)
    set("summary", patch.summary);
  if (!sets.length) return getCapture(db, id);
  set("updated_at", Date.now());
  db.query(`UPDATE captures SET ${sets.join(", ")} WHERE id = ?`).run(...args, id);
  return getCapture(db, id);
}

export function listCategoryFacets(db: Database): FacetCount[] {
  return db
    .query(
      `SELECT category AS name, COUNT(*) AS count FROM captures
       WHERE category IS NOT NULL AND category <> ''
       GROUP BY category ORDER BY count DESC`,
    )
    .all() as FacetCount[];
}

export function listTagFacets(db: Database): FacetCount[] {
  const rows = db
    .query("SELECT tags FROM captures WHERE tags IS NOT NULL AND tags <> '[]'")
    .all() as { tags: string }[];
  const counts = new Map<string, number>();
  for (const r of rows) {
    let tags: string[] = [];
    try {
      tags = JSON.parse(r.tags);
    } catch {
      /* skip */
    }
    for (const t of tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

async function serveBlob(
  abs: string,
  mime: string,
  range: string | undefined,
): Promise<Response> {
  const file = Bun.file(abs);
  if (!(await file.exists())) {
    return new Response(JSON.stringify({ error: "gone" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  const size = file.size;
  const baseHeaders: Record<string, string> = {
    "content-type": mime,
    "cache-control": "private, max-age=31536000, immutable",
    "accept-ranges": "bytes",
  };
  const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
  if (m) {
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? parseInt(m[2], 10) : size - 1;
    if (start <= end && start < size) {
      return new Response(file.slice(start, end + 1), {
        status: 206,
        headers: {
          ...baseHeaders,
          "content-range": `bytes ${start}-${end}/${size}`,
          "content-length": String(end - start + 1),
        },
      });
    }
  }
  return new Response(file, { headers: baseHeaders });
}

/** All capture + queue HTTP routes, mounted at /v1/captures. */
export function captureRoutes(db: Database): Hono<Env> {
  const app = new Hono<Env>();

  // Ingest — JSON (highlight/bookmark/note) or multipart (screenshot/image).
  app.post("/", requireScope("ingest"), async (c) => {
    const ct = c.req.header("content-type") ?? "";
    let blob: BlobInput | null = null;
    let ingest: CaptureIngest;
    if (ct.includes("multipart/form-data")) {
      const form = await c.req.formData();
      ingest = CaptureIngest.parse(JSON.parse(String(form.get("meta") ?? "{}")));
      const file = form.get("blob");
      if (file instanceof File) {
        blob = {
          bytes: new Uint8Array(await file.arrayBuffer()),
          mime: file.type || "application/octet-stream",
        };
      }
    } else {
      ingest = CaptureIngest.parse(await c.req.json());
    }
    const capture = await createCapture(db, ingest, blob, c.get("device").id);
    return c.json(capture, 201);
  });

  // Claim work for the enrichment worker.
  app.post("/claim", requireScope("enrich"), async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      owner?: string;
      limit?: number;
    };
    const owner = body.owner ?? c.get("device").id;
    const limit = Math.min(Math.max(body.limit ?? 2, 1), 10);
    return c.json({ captures: claimCaptures(db, owner, limit) });
  });

  // List / FTS search.
  app.get("/", requireScope("read"), (c) => {
    const q = c.req.query();
    const limit = q.limit ? Number(q.limit) : null;
    return c.json(
      listCaptures(db, {
        type: q.type,
        status: q.status,
        tag: q.tag,
        category: q.category,
        q: q.q,
        cursor: q.cursor,
        limit,
      }),
    );
  });

  app.get("/:id", requireScope("read"), (c) => {
    const capture = getCapture(db, c.req.param("id"));
    return capture ? c.json(capture) : c.json({ error: "not_found" }, 404);
  });

  app.get("/:id/blob", requireScope("read"), async (c) => {
    const row = getCaptureRow(db, c.req.param("id"));
    if (!row?.blob_path) return c.json({ error: "not_found" }, 404);
    return serveBlob(
      absBlobPath(row.blob_path),
      row.blob_mime ?? "application/octet-stream",
      c.req.header("range"),
    );
  });

  app.get("/:id/thumb", requireScope("read"), async (c) => {
    const row = getCaptureRow(db, c.req.param("id"));
    // No server-side thumbnailing in v1 — fall back to the original blob.
    const path = row?.thumb_path ?? row?.blob_path;
    if (!path) return c.json({ error: "not_found" }, 404);
    return serveBlob(
      absBlobPath(path),
      row?.blob_mime ?? "application/octet-stream",
      c.req.header("range"),
    );
  });

  // Worker writes enrichment results.
  app.patch("/:id/enrichment", requireScope("enrich"), async (c) => {
    const result = EnrichmentResult.parse(await c.req.json());
    const capture = applyEnrichment(db, c.req.param("id"), result);
    return capture ? c.json(capture) : c.json({ error: "not_found" }, 404);
  });

  // User edits from the Library UI.
  app.patch("/:id", requireScope("read"), async (c) => {
    const patch = CapturePatch.parse(await c.req.json());
    const capture = patchCapture(db, c.req.param("id"), patch);
    return capture ? c.json(capture) : c.json({ error: "not_found" }, 404);
  });

  app.delete("/:id", requireScope("read"), (c) => {
    const changed = db
      .query("DELETE FROM captures WHERE id = ?")
      .run(c.req.param("id"));
    // Blob files are content-addressed and may be shared (dedupe) — leave on disk.
    return changed.changes
      ? c.json({ ok: true })
      : c.json({ error: "not_found" }, 404);
  });

  return app;
}
