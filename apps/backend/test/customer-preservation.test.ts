import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { openDb } from "../src/db.ts";
import {
  createPreservationService,
  enqueuePreservation,
  preservationDetails,
} from "../src/customer-preservation.ts";
import { normalizeSocialContext } from "../src/customer-twitter.ts";
import { createRemoteFileSweeper } from "../src/customer-remote-cleanup.ts";
let db: ReturnType<typeof openDb>, root: string;
const owner = "owner",
  capture = "capture",
  url = "https://x.com/mina/status/12345";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEwoAAAAASUVORK5CYII=",
  "base64",
);
const manifest = {
  text: "The exact post",
  author: "Mina",
  publishedAt: null,
  metadataAvailable: true,
  media: [{ kind: "image" as const, url: "https://pbs.twimg.com/media/a.jpg" }],
  links: ["https://blog.example.org/story"],
};
beforeEach(async () => {
  db = openDb(":memory:");
  root = await mkdtemp("/tmp/foundkeep-preservation-");
  db.query(
    "INSERT INTO customer_accounts(id,email,name,password_hash,recovery_hash,created_at) VALUES(?,'owner@example.test','Owner','','',0)",
  ).run(owner);
  db.query(
    "INSERT INTO customer_captures(id,account_id,client_id,type,status,source_url,selection_text,storage_bytes,captured_at,created_at,updated_at) VALUES(?,?,?,'tweet','done',?,'Captured original',100,1,1,1)",
  ).run(capture, owner, capture, url);
});
afterEach(async () => {
  db.close();
  await rm(root, { recursive: true, force: true });
});
const service = (extra = {}) =>
  createPreservationService(db, {
    root,
    resolve: async () => manifest,
    read: async (url) => ({ url, mime: "image/png", data: png }),
    source: async (url) => ({
      url,
      requestedUrl: url,
      text: "A full readable blog",
      title: "Blog",
      author: "Mina",
      description: null,
      imageUrl: null,
      publishedAt: null,
      siteName: null,
      extractionStatus: "readable" as const,
      contentHash: "hash",
      fetchedAt: 1,
    }),
    ...extra,
  });
test("Free saves preserve independent assets without AI, account settings or processing credits", async () => {
  enqueuePreservation(db, owner, capture, url);
  enqueuePreservation(db, owner, capture, url);
  expect(
    (db.query("SELECT COUNT(*) n FROM customer_preservation_jobs").get() as any)
      .n,
  ).toBe(1);
  await service().tick();
  const result = preservationDetails(db, owner, capture)!;
  expect(result.status).toBe("ready");
  expect(result.assets.map((x) => x.kind)).toEqual([
    "post",
    "image",
    "article",
  ]);
  expect(result.assets[2]!.text).toContain("A full readable blog");
  expect(
    (db.query("SELECT selection_text FROM customer_captures").get() as any)
      .selection_text,
  ).toBe("Captured original");
  expect(preservationDetails(db, "other", capture)).toBeNull();
  const file = (
    db
      .query("SELECT file_path FROM customer_media_assets WHERE kind='image'")
      .get() as any
  ).file_path;
  expect(await Bun.file(root + "/" + file).exists()).toBe(true);
  const sweeper = createRemoteFileSweeper(db, root);
  sweeper.sweep(Date.now() + 7200_000);
  sweeper.close();
  expect(await Bun.file(root + "/" + file).exists()).toBe(true);
});
test("partial failure keeps committed files, and a retry does not store them twice", async () => {
  enqueuePreservation(db, owner, capture, url);
  await service({
    source: async () => {
      throw Error("unavailable");
    },
  }).tick();
  expect(preservationDetails(db, owner, capture)?.status).toBe("partial");
  const bytes = (
    db.query("SELECT storage_bytes FROM customer_captures").get() as any
  ).storage_bytes;
  db.query("UPDATE customer_preservation_jobs SET status='pending'").run();
  await service().tick();
  expect(preservationDetails(db, owner, capture)?.assets.length).toBe(3);
  expect(
    (db.query("SELECT storage_bytes FROM customer_captures").get() as any)
      .storage_bytes,
  ).toBeGreaterThan(bytes);
  db.query("UPDATE customer_preservation_jobs SET status='pending'").run();
  await service().tick();
  expect(preservationDetails(db, owner, capture)?.assets.length).toBe(3);
});
test("source edits and deletion while resolving cannot attach files to a different save", async () => {
  enqueuePreservation(db, owner, capture, url, normalizeSocialContext(null));
  await service({
    resolve: async () => {
      db.query(
        "UPDATE customer_captures SET source_url='https://x.com/other/status/999'",
      ).run();
      return manifest;
    },
  }).tick();
  expect(
    (db.query("SELECT COUNT(*) n FROM customer_media_assets").get() as any).n,
  ).toBe(0);
  db.query("UPDATE customer_captures SET source_url=?").run(url);
  db.query(
    "UPDATE customer_preservation_jobs SET status='pending',next_attempt_at=0",
  ).run();
  await service({
    resolve: async () => {
      db.query("DELETE FROM customer_captures").run();
      return manifest;
    },
  }).tick();
  expect(preservationDetails(db, owner, capture)).toBeNull();
});
test("storage quota is rechecked during incremental commits and existing content stays intact", async () => {
  enqueuePreservation(db, owner, capture, url);
  await service({ globalMaxBytes: 180 }).tick();
  const result = preservationDetails(db, owner, capture)!;
  expect(result.status).toBe("partial");
  expect(result.assets.every((x) => x.kind !== "image")).toBe(true);
  expect(
    (db.query("SELECT storage_bytes FROM customer_captures").get() as any)
      .storage_bytes,
  ).toBeLessThanOrEqual(180);
});

test('expired leases resume missing work, and unavailable metadata never downloads a quoted video by guessing',async()=>{
 enqueuePreservation(db,owner,capture,url);
 db.query("UPDATE customer_preservation_jobs SET status='running',attempts=1,lease_token='old',lease_until=1").run();
 let downloads=0;
 const worker=service({resolve:async()=>({...manifest,metadataAvailable:false,media:[],links:[]}),remote:async()=>{downloads++;throw Error('Must not guess media ownership');}});
 await worker.tick();worker.close();
 expect(preservationDetails(db,owner,capture)?.status).toBe('partial');expect(preservationDetails(db,owner,capture)?.attempts).toBe(2);expect(downloads).toBe(0);
 expect(preservationDetails(db,owner,capture)?.assets.map(asset=>asset.kind)).toEqual(['post']);
});
