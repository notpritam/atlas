import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { openDb } from "../src/db.ts";
import { createApp } from "../src/app.ts";
import { processCustomerQueue } from "../src/customer-enrichment.ts";
import { customerRoutes } from "../src/customer.ts";
import { createPreviewFetcher } from "../src/customer-preview.ts";

const ORIGIN = process.env.ATLAS_CUSTOMER_ORIGIN || "https://atlas.notpritam.in";
const PRIMARY_ORIGIN = "https://foundkeep.app";
const LEGACY_ORIGIN = "https://atlas.notpritam.in";
const EXTENSION = "chrome-extension://mjfcgmboaijfcaanepdipbgmipnccnpn";
const PASSWORD = "a correct horse battery staple";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=";
let db: Database;
let app: ReturnType<typeof createApp>;
let sequence = 0;
type TestResponse = Omit<Response, "json"> & { json(): Promise<any> };
beforeEach(() => { db = openDb(":memory:"); app = createApp(db); });
afterEach(() => db.close());

async function request(path: string, method = "GET", data?: unknown, credential?: string, origin: string | null = ORIGIN) {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  if (credential) headers.set(credential.startsWith("Bearer ") ? "authorization" : "cookie", credential);
  if (data !== undefined) headers.set("content-type", "application/json");
  return await app.request(`${ORIGIN}/api${path}`, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) }) as TestResponse;
}
async function register(email = `person${++sequence}@example.com`) {
  const response = await request("/auth/register", "POST", { email, name: "Person", password: PASSWORD });
  expect(response.status).toBe(201);
  const body = await response.json();
  return { ...body, email, cookie: response.headers.get("set-cookie")!.split(";")[0]!, response };
}
async function connect(cookie: string) {
  const pairing = await (await request("/pairing", "POST", {}, cookie)).json();
  const response = await request("/pairing/claim", "POST", { code: pairing.code, name: "Test browser" }, undefined, EXTENSION);
  expect(response.status).toBe(201);
  const body = await response.json();
  return { ...body, bearer: `Bearer ${body.token}`, code: pairing.code };
}
async function capture(credential: string, extra: Record<string, unknown> = {}) {
  return request("/captures", "POST", { clientId: crypto.randomUUID(), type: "note", noteText: "Private note", ...extra }, credential);
}
async function mobile(path: string, method = "GET", data?: unknown, bearer?: string) {
  return request(`/mobile${path}`, method, data, bearer, null);
}
function heldUpload(cookie: string, target = app) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const signal = new AbortController();
  const body = new ReadableStream<Uint8Array>({
    start(value) { controller = value; controller.enqueue(new TextEncoder().encode('{"noteText":"')); },
    cancel() { cancelled = true; },
  });
  const response = target.request(`${ORIGIN}/api/captures`, { method: "POST", headers: { origin: ORIGIN, cookie, "content-type": "application/json" }, body, signal: signal.signal });
  return { response, signal, controller, isCancelled: () => cancelled, close() { try { controller.close(); } catch {} } };
}

test("recent order uses collection arrival time and persists the saving platform", async () => {
  const owner = await register();
  const device = await connect(owner.cookie);
  const first = (await (await capture(owner.cookie, { capturedAt: Date.now() + 60000 })).json()).capture;
  const latest = (await (await capture(device.bearer, { capturedAt: 1000, savedVia: "iphone", sourceUrl: "https://youtube.com/watch?v=1" })).json()).capture;
  db.query("UPDATE customer_captures SET created_at=10 WHERE id=?").run(first.id);
  db.query("UPDATE customer_captures SET created_at=20 WHERE id=?").run(latest.id);
  const page = await (await request("/captures?sort=recent&limit=1", "GET", undefined, owner.cookie)).json();
  expect(page.captures[0].id).toBe(latest.id);
  expect(page.captures[0].savedVia).toBe("browser");
  const next = await (await request(`/captures?sort=recent&limit=1&cursor=${page.nextCursor}`, "GET", undefined, owner.cookie)).json();
  expect(next.captures[0].id).toBe(first.id);
  expect(next.captures[0].savedVia).toBe("dashboard");
  expect(next.nextCursor).toBeNull();
  db.query("UPDATE customer_captures SET article_text=? WHERE id=?").run("a".repeat(2000), latest.id);
  const cards = await (await request("/captures?sort=recent&view=cards", "GET", undefined, owner.cookie)).json();
  expect(cards.captures[0].articleText.length).toBe(480);
  expect((await (await request(`/captures/${latest.id}`, "GET", undefined, owner.cookie)).json()).capture.articleText.length).toBe(2000);
  const native = await (await mobile("/captures?sort=recent", "GET", undefined, device.bearer)).json();
  expect(native.captures.map((item: any) => item.id)).toEqual([latest.id, first.id]);
  expect((await request("/captures?sort=invalid", "GET", undefined, owner.cookie)).status).toBe(400);
  expect((await mobile("/captures?sort=invalid", "GET", undefined, device.bearer)).status).toBe(400);
});

describe("customer account security", () => {
  test("public session discovery treats missing or expired cookies as signed out without exposing private account data", async () => {
    for (const cookie of [undefined, "__Host-atlas_session=invalid", `__Host-atlas_session=${"x".repeat(43)}`]) {
      const response = await request("/auth/session", "GET", undefined, cookie);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ account: null });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    const owner = await register();
    const read = () => request("/auth/session", "GET", undefined, owner.cookie);
    expect(await (await read()).json()).toEqual({ account: { id: owner.account.id } });
    const device = await connect(owner.cookie);
    expect((await request("/auth/session", "GET", undefined, device.bearer)).status).toBe(403);
    const switched = await app.request(`${ORIGIN}/api/auth/session`, { headers: { cookie: owner.cookie, "X-Atlas-Account": "different-account" } });
    expect(switched.status).toBe(409);
    db.query("UPDATE customer_sessions SET expires_at=0 WHERE account_id=?").run(owner.account.id);
    expect(await (await read()).json()).toEqual({ account: null });
    expect((await request("/me", "GET", undefined, owner.cookie)).status).toBe(401);
    const renewed = await request("/auth/login", "POST", { email: owner.email, password: PASSWORD });
    const cookie = renewed.headers.get("set-cookie")!.split(";")[0]!;
    await request("/auth/logout", "POST", {}, cookie);
    expect(await (await request("/auth/session", "GET", undefined, cookie)).json()).toEqual({ account: null });
    expect((await request("/me")).status).toBe(401);
  });

  test("article preview DTOs use an owned same-origin endpoint and ignore caller-selected URLs", async () => {
    const owner = await register();
    const other = await register();
    const saved = (await (await capture(owner.cookie, { type: "bookmark", sourceUrl: "https://example.com/article" })).json()).capture;
    const lead = "https://images.example.com/article.png";
    db.query("UPDATE customer_captures SET provenance_json=? WHERE id=?").run(JSON.stringify({ leadImageUrl: lead }), saved.id);
    const dto = (await (await request(`/captures/${saved.id}`, "GET", undefined, owner.cookie)).json()).capture;
    expect(dto.previewUrl).toBe(`/api/captures/${saved.id}/preview`);
    const requested: string[] = [];
    const fetcher = createPreviewFetcher({
      resolve: async () => [{ address: "93.184.215.14", family: 4 }],
      transport: async target => {
        requested.push(target.url.href);
        return { status: 200, headers: new Headers({ "content-type": "image/png", "set-cookie": "untrusted=value" }),
          body: (async function* () { yield Buffer.from(PNG.split(",")[1]!, "base64"); })(), cancel() {} };
      },
    });
    const router = customerRoutes(db, undefined, fetcher);
    const read = (cookie: string) => router.request(`${ORIGIN}/captures/${saved.id}/preview?url=http://127.0.0.1/`, { headers: { cookie } });
    expect((await read(other.cookie)).status).toBe(404);
    expect(requested).toEqual([]);
    const response = await read(owner.cookie);
    expect(response.status).toBe(200);
    expect(requested).toEqual([lead]);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    for (const url of ["http://127.0.0.1/x", "data:image/png;base64,abc", null]) {
      db.query("UPDATE customer_captures SET provenance_json=? WHERE id=?").run(JSON.stringify({ leadImageUrl: url }), saved.id);
      const invalid = (await (await request(`/captures/${saved.id}`, "GET", undefined, owner.cookie)).json()).capture;
      expect(invalid.previewUrl).toBeNull();
      expect((await read(owner.cookie)).status).toBe(404);
    }
    expect(requested).toEqual([lead]);
  });

  test("in-flight article previews recheck owner sessions and capture existence before returning bytes", async () => {
    for (const revoke of ["session", "capture"]) {
      const owner = await register();
      const saved = (await (await capture(owner.cookie)).json()).capture;
      db.query("UPDATE customer_captures SET provenance_json=? WHERE id=?").run(JSON.stringify({ leadImageUrl: "https://images.example.com/a.png" }), saved.id);
      let entered!: () => void; let release!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const held = new Promise<void>(resolve => { release = resolve; });
      const fetcher = createPreviewFetcher({ resolve: async () => [{ address: "93.184.215.14", family: 4 }], transport: async () => {
        entered(); await held;
        return { status: 200, headers: new Headers({ "content-type": "image/png" }), body: (async function* () { yield Buffer.from(PNG.split(",")[1]!, "base64"); })(), cancel() {} };
      } });
      const router = customerRoutes(db, undefined, fetcher);
      const pending = router.request(`${ORIGIN}/captures/${saved.id}/preview`, { headers: { cookie: owner.cookie } });
      await started;
      if (revoke === "session") expect((await request("/auth/logout", "POST", {}, owner.cookie)).status).toBe(200);
      else expect((await request(`/captures/${saved.id}`, "DELETE", undefined, owner.cookie)).status).toBe(200);
      release();
      expect((await pending).status).toBe(revoke === "session" ? 401 : 404);
    }
  });

  test("web previews can use an existing uploaded raster file and refuse other file types", async () => {
    const owner = await register();
    const device = await connect(owner.cookie);
    const png = Buffer.from(PNG.split(",")[1]!, "base64");
    const uploaded = await app.request(`${ORIGIN}/api/mobile/captures/file`, {
      method: "POST", headers: { authorization: device.bearer, "content-type": "image/png", "content-length": String(png.length),
        "x-foundkeep-capture": Buffer.from(JSON.stringify({ clientId: crypto.randomUUID(), type: "image", fileName: "preview.png" })).toString("base64url") }, body: png,
    });
    expect(uploaded.status).toBe(201);
    const saved = (await uploaded.json() as any).capture;
    try {
      const response = await request(`/captures/${saved.id}/preview`, "GET", undefined, owner.cookie);
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
      db.query("UPDATE customer_captures SET file_mime='image/svg+xml' WHERE id=?").run(saved.id);
      expect((await request(`/captures/${saved.id}/preview`, "GET", undefined, owner.cookie)).status).toBe(404);
    } finally { await request(`/captures/${saved.id}`, "DELETE", undefined, owner.cookie); }
  });

  test("web previews require an owner session and return stored raster images without accepting URL input", async () => {
    const owner = await register();
    const other = await register();
    const device = await connect(owner.cookie);
    const saved = (await (await capture(owner.cookie, { type: "image", dataUrl: PNG })).json()).capture;
    const path = `/captures/${saved.id}/preview`;
    const response = await request(`${path}?url=http://127.0.0.1/`, "GET", undefined, owner.cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(PNG.split(",")[1]!, "base64"));
    expect((await request(path, "GET", undefined, other.cookie)).status).toBe(404);
    expect((await request(path)).status).toBe(401);
    expect((await request(path, "GET", undefined, device.bearer)).status).toBe(403);
    const empty = (await (await capture(owner.cookie)).json()).capture;
    expect(empty.previewUrl).toBeNull();
    expect((await request(`/captures/${empty.id}/preview?url=https://example.com/image.png`, "GET", undefined, owner.cookie)).status).toBe(404);
  });

  test("mobile image blobs require a live owner credential and preserve the image MIME allowlist", async () => {
    const owner = await register();
    const other = await register();
    const device = await connect(owner.cookie);
    const otherDevice = await connect(other.cookie);
    const saved = (await (await capture(device.bearer, { type: "image", dataUrl: PNG })).json()).capture;
    const path = `/captures/${saved.id}/blob`;
    const response = await mobile(path, "GET", undefined, device.bearer);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(PNG.split(",")[1]!, "base64"));
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect((await mobile(path, "GET", undefined, otherDevice.bearer)).status).toBe(404);
    expect((await mobile(path)).status).toBe(401);
    expect((await mobile(`${path}?token=${device.token}`)).status).toBe(401);
    expect((await request(path, "GET", undefined, device.bearer)).status).toBe(403);
    expect((await request(path, "GET", undefined, owner.cookie)).status).toBe(200);
    for (const mime of ["image/svg+xml", "text/html", "application/octet-stream"]) {
      db.query("UPDATE customer_captures SET blob_mime=? WHERE id=?").run(mime, saved.id);
      expect((await mobile(path, "GET", undefined, device.bearer)).status).toBe(404);
    }
    db.query("UPDATE customer_captures SET blob_mime='image/png',blob_data=NULL WHERE id=?").run(saved.id);
    expect((await mobile(path, "GET", undefined, device.bearer)).status).toBe(404);
    expect((await mobile("/logout", "POST", undefined, device.bearer)).status).toBe(200);
    expect((await mobile(path, "GET", undefined, device.bearer)).status).toBe(401);
  });

  test("mobile batch pages combine owner, search, type and card filters without dropping children", async () => {
    const owner = await register();
    const other = await register();
    const device = await connect(owner.cookie);
    const batchId = crypto.randomUUID();
    for (let index = 0; index < 52; index += 1) {
      expect((await capture(device.bearer, {
        clientId: `batch-${index}`, batchId, type: "bookmark", capturedAt: 1000,
        articleText: "a".repeat(600) + "needle", noteText: null,
      })).status).toBe(201);
    }
    for (const extra of [
      { batchId: crypto.randomUUID(), type: "bookmark", articleText: "needle" },
      { batchId, type: "note", articleText: "needle" },
      { batchId, type: "bookmark", articleText: "unrelated" },
      { type: "bookmark", articleText: "needle" },
    ]) expect((await capture(device.bearer, extra)).status).toBe(201);
    expect((await capture(other.cookie, { batchId, type: "bookmark", articleText: "needle" })).status).toBe(201);
    const query = `/captures?batchId=${batchId}&type=bookmark&q=needle&view=cards`;
    const first = await (await mobile(query, "GET", undefined, device.bearer)).json();
    expect(first.total).toBe(52);
    expect(first.captures).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    const second = await (await mobile(`${query}&cursor=${first.nextCursor}`, "GET", undefined, device.bearer)).json();
    expect(second.total).toBe(52);
    expect(second.captures).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const children = [...first.captures, ...second.captures];
    expect(new Set(children.map(item => item.id)).size).toBe(52);
    for (const item of children) {
      expect(item.batchId).toBe(batchId);
      expect(item.clientId).toStartWith("batch-");
      expect(item.contentView).toBe("card");
      expect(item.articleText).toHaveLength(480);
    }
    const allChildren = await (await mobile(`/captures?batchId=${batchId}`, "GET", undefined, device.bearer)).json();
    expect(allChildren.total).toBe(54);
  });

  test("mobile batch filters reject empty, oversized and unsafe identifiers", async () => {
    const owner = await register();
    const device = await connect(owner.cookie);
    for (const batchId of ["", "a".repeat(81), "has space", "../other", "batch' OR 1=1", "é"]) {
      const response = await mobile(`/captures?batchId=${encodeURIComponent(batchId)}`, "GET", undefined, device.bearer);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("invalid_batch");
    }
    const valid = await mobile(`/captures?batchId=${"a".repeat(78)}_-`, "GET", undefined, device.bearer);
    expect(valid.status).toBe(200);
    expect(await valid.json()).toMatchObject({ captures: [], total: 0, nextCursor: null });
  });

  test("mobile edits preserve original provenance and full saved content while accounting for UTF-8 byte changes", async () => {
    const owner = await register();
    const device = await connect(owner.cookie);
    const provenance = {
      schemaVersion: 1, captureMethod: "ios-share-url", pageUrl: "https://example.com/original",
      canonicalUrl: "https://example.com/original", pageTitle: "Original source title", siteName: "Example",
      description: null, authors: ["Original Author"], publishedAt: null, modifiedAt: null,
      language: "en", leadImageUrl: null, faviconUrl: null, targetUrl: null, headings: ["Original section"],
      capturedAt: 1000, extractedAt: 1000, extractorVersion: 1, contentHash: "a".repeat(43),
      extractionStatus: "complete", extractionError: null,
    };
    const saved = (await (await capture(device.bearer, {
      type: "bookmark", sourceUrl: provenance.pageUrl, sourceTitle: "Old", noteText: "é",
      articleText: "Original article. ".repeat(100), selectionText: "Original selection", dataUrl: PNG,
      batchId: crypto.randomUUID(), capturedAt: 1000, provenance,
    })).json()).capture;
    db.query("UPDATE customer_captures SET summary='summary',ocr_text='OCR',category='Reading',tags='[\"saved\"]',storage_bytes=storage_bytes+27 WHERE id=?").run(saved.id);
    const before = db.query("SELECT * FROM customer_captures WHERE id=?").get(saved.id) as any;
    const response = await mobile(`/captures/${saved.id}`, "PUT", {
      sourceTitle: "New 📚", noteText: "好", expectedUpdatedAt: saved.updatedAt,
    }, device.bearer);
    expect(response.status).toBe(200);
    const edited = (await response.json()).capture;
    expect(edited.updatedAt).toBeGreaterThan(saved.updatedAt);
    expect(edited).toEqual({
      ...saved, sourceTitle: "New 📚", noteText: "好", updatedAt: edited.updatedAt,
      summary: "summary", ocrText: "OCR", category: "Reading", tags: ["saved"],
    });
    expect(edited.articleText.length).toBeGreaterThan(480);
    const after = db.query("SELECT * FROM customer_captures WHERE id=?").get(saved.id) as any;
    expect(after).toEqual({ ...before, source_title: "New 📚", note_text: "好", storage_bytes: before.storage_bytes + 6, updated_at: edited.updatedAt });
    const cleared = await mobile(`/captures/${saved.id}`, "PUT", {
      sourceTitle: null, noteText: null, expectedUpdatedAt: edited.updatedAt,
    }, device.bearer);
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).capture).toMatchObject({ sourceTitle: null, noteText: null, provenance });
    expect((db.query("SELECT storage_bytes FROM customer_captures WHERE id=?").get(saved.id) as any).storage_bytes).toBe(before.storage_bytes - 5);
  });

  test("mobile edits use monotonic revisions and reject stale or concurrent overwrites", async () => {
    const owner = await register();
    const device = await connect(owner.cookie);
    const saved = (await (await capture(device.bearer)).json()).capture;
    const revision = Date.now() + 100_000;
    db.query("UPDATE customer_captures SET updated_at=? WHERE id=?").run(revision, saved.id);
    const update = { sourceTitle: "Updated", noteText: "Kept", expectedUpdatedAt: revision };
    const first = await mobile(`/captures/${saved.id}`, "PUT", update, device.bearer);
    expect(first.status).toBe(200);
    expect((await first.json()).capture.updatedAt).toBe(revision + 1);
    const stale = await mobile(`/captures/${saved.id}`, "PUT", { ...update, noteText: "Stale overwrite" }, device.bearer);
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe("capture_changed");
    const attempts = await Promise.all(["First device", "Second device"].map(noteText =>
      mobile(`/captures/${saved.id}`, "PUT", { ...update, noteText, expectedUpdatedAt: revision + 1 }, device.bearer)));
    expect(attempts.map(response => response.status).sort()).toEqual([200, 409]);
    const winner = (await attempts.find(response => response.status === 200)!.json()).capture;
    const current = (await (await mobile(`/captures/${saved.id}`, "GET", undefined, device.bearer)).json()).capture;
    expect(current).toEqual(winner);
    expect(current.updatedAt).toBe(revision + 2);
  });

  test.each(["done", "failed"] as const)("enrichment %s completion advances past an in-flight mobile edit and rejects its stale revision", async status => {
    const owner = await register();
    const device = await connect(owner.cookie);
    const saved = (await (await capture(device.bearer, { type: "image", dataUrl: PNG })).json()).capture;
    const path = `/captures/${saved.id}`;
    let editResponse: TestResponse | undefined;
    let edited: any;
    await processCustomerQueue(db, { batchSize: 1, now: () => saved.updatedAt, ocr: async () => {
      const processing = (await (await mobile(path, "GET", undefined, device.bearer)).json()).capture;
      editResponse = await mobile(path, "PUT", {
        sourceTitle: "Personal title", noteText: "Edited during recognition", expectedUpdatedAt: processing.updatedAt,
      }, device.bearer);
      edited = (await editResponse.json()).capture;
      if (status === "failed") throw new Error("OCR unavailable");
      return "Recognized text";
    } });
    expect(editResponse?.status).toBe(200);
    expect(edited.updatedAt).toBeGreaterThan(saved.updatedAt);
    const completed = (await (await mobile(path, "GET", undefined, device.bearer)).json()).capture;
    expect(completed.status).toBe(status);
    expect(completed.updatedAt).toBe(edited.updatedAt + 1);
    expect(completed.sourceTitle).toBe("Personal title");
    expect(completed.noteText).toBe("Edited during recognition");
    const stale = await mobile(path, "PUT", {
      sourceTitle: "Stale title", noteText: null, expectedUpdatedAt: edited.updatedAt,
    }, device.bearer);
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe("capture_changed");
  });

  test("mobile edits validate the complete personal-field payload and reject foreign ownership", async () => {
    const owner = await register();
    const other = await register();
    const device = await connect(owner.cookie);
    const otherDevice = await connect(other.cookie);
    const saved = (await (await capture(device.bearer)).json()).capture;
    const path = `/captures/${saved.id}`;
    const update = { sourceTitle: null, noteText: "New note", expectedUpdatedAt: saved.updatedAt };
    expect((await mobile(path, "PUT", update)).status).toBe(401);
    expect((await mobile(path, "PUT", update, otherDevice.bearer)).status).toBe(404);
    for (const invalid of [
      {}, { noteText: "Missing title", expectedUpdatedAt: saved.updatedAt },
      { sourceTitle: null, expectedUpdatedAt: saved.updatedAt },
      { sourceTitle: null, noteText: null }, { ...update, expectedUpdatedAt: -1 },
      { ...update, expectedUpdatedAt: 1.5 }, { ...update, expectedUpdatedAt: "1" },
      { ...update, expectedUpdatedAt: Number.MAX_SAFE_INTEGER + 1 },
      { ...update, sourceTitle: "a".repeat(1001) }, { ...update, noteText: "a".repeat(50_001) },
      { ...update, sourceTitle: 123 }, { ...update, noteText: {} },
      { ...update, sourceUrl: "https://replacement.example" }, { ...update, articleText: "Replacement article" },
      { ...update, provenance: null }, { ...update, accountId: other.account.id },
    ]) {
      const response = await mobile(path, "PUT", invalid, device.bearer);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("invalid_input");
    }
    expect((await (await mobile(path, "GET", undefined, device.bearer)).json()).capture).toEqual(saved);
    const boundary = await mobile(path, "PUT", {
      sourceTitle: "a".repeat(1000), noteText: "é".repeat(50_000), expectedUpdatedAt: saved.updatedAt,
    }, device.bearer);
    expect(boundary.status).toBe(200);
    expect((await boundary.json()).capture.noteText).toHaveLength(50_000);
  });

  test("mobile edits apply account and global byte budgets to the field delta and allow shrinking at capacity", async () => {
    const owner = await register();
    const other = await register();
    const device = await connect(owner.cookie);
    const saved = (await (await capture(device.bearer, { sourceTitle: "Old", noteText: "é" })).json()).capture;
    const otherSaved = (await (await capture(other.cookie)).json()).capture;
    const path = `/captures/${saved.id}`;
    db.query("UPDATE customer_captures SET storage_bytes=209715200 WHERE id=?").run(saved.id);
    const full = await mobile(path, "PUT", { sourceTitle: "Old", noteText: "好", expectedUpdatedAt: saved.updatedAt }, device.bearer);
    expect(full.status).toBe(409);
    expect((await full.json()).error).toBe("quota_exceeded");
    expect((db.query("SELECT note_text,storage_bytes,updated_at FROM customer_captures WHERE id=?").get(saved.id) as any))
      .toEqual({ note_text: "é", storage_bytes: 209715200, updated_at: saved.updatedAt });
    const shrunk = await mobile(path, "PUT", { sourceTitle: null, noteText: null, expectedUpdatedAt: saved.updatedAt }, device.bearer);
    expect(shrunk.status).toBe(200);
    const revision = (await shrunk.json()).capture.updatedAt;
    expect((db.query("SELECT storage_bytes FROM customer_captures WHERE id=?").get(saved.id) as any).storage_bytes).toBe(209715195);
    db.query("UPDATE customer_captures SET storage_bytes=1937768453 WHERE id=?").run(otherSaved.id);
    const globalFull = await mobile(path, "PUT", { sourceTitle: null, noteText: "a", expectedUpdatedAt: revision }, device.bearer);
    expect(globalFull.status).toBe(503);
    expect((await globalFull.json()).error).toBe("storage_unavailable");
    expect((db.query("SELECT note_text,storage_bytes,updated_at FROM customer_captures WHERE id=?").get(saved.id) as any))
      .toEqual({ note_text: null, storage_bytes: 209715195, updated_at: revision });
    const sameSize = await mobile(path, "PUT", { sourceTitle: "", noteText: null, expectedUpdatedAt: revision }, device.bearer);
    expect(sameSize.status).toBe(200);
  });

  test("an in-flight mobile edit cannot save after device logout", async () => {
    const owner = await register();
    const device = await connect(owner.cookie);
    const saved = (await (await capture(device.bearer)).json()).capture;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    const pending = app.request(`${ORIGIN}/api/mobile/captures/${saved.id}`, {
      method: "PUT", headers: { authorization: device.bearer, "content-type": "application/json" }, body: stream,
    });
    expect((await mobile("/logout", "POST", undefined, device.bearer)).status).toBe(200);
    controller.enqueue(new TextEncoder().encode(JSON.stringify({
      sourceTitle: "Revoked edit", noteText: null, expectedUpdatedAt: saved.updatedAt,
    })));
    controller.close();
    expect((await pending).status).toBe(401);
    expect((await (await request(`/captures/${saved.id}`, "GET", undefined, owner.cookie)).json()).capture).toEqual(saved);
  });

  test("mobile card pages bound text payloads while search and detail retain full saved content", async () => {
    const owner = await register();
    const device = await connect(owner.cookie);
    const fullText = 'A paragraph worth keeping. '.repeat(6000) + 'rare-tail-match';
    const saved = await (await capture(device.bearer, { type: 'bookmark', sourceUrl: 'https://example.com/story', articleText: fullText })).json();
    const fullResponse = await mobile('/captures', 'GET', undefined, device.bearer);
    const fullBody = await fullResponse.text();
    const compactResponse = await mobile('/captures?view=cards&q=rare-tail-match', 'GET', undefined, device.bearer);
    const compactBody = await compactResponse.text();
    const compact = JSON.parse(compactBody);
    expect(compact.captures).toHaveLength(1);
    expect(compact.captures[0].contentView).toBe('card');
    expect(compact.captures[0].articleText.length).toBeLessThanOrEqual(480);
    expect(compactBody.length).toBeLessThan(fullBody.length / 20);
    const detail = await (await mobile(`/captures/${saved.capture.id}`, 'GET', undefined, device.bearer)).json();
    expect(detail.capture.articleText).toBe(fullText);
    expect(JSON.parse(fullBody).captures[0].articleText).toBe(fullText);
    expect((await mobile('/captures?view=unknown', 'GET', undefined, device.bearer)).status).toBe(400);
  });

  test("mobile registration, login, recovery and logout use revocable device credentials", async () => {
    const email = `mobile-${++sequence}@example.com`;
    const registered = await mobile("/register", "POST", { email, name: "Mobile Person", password: PASSWORD, deviceName: "Pritam's iPhone" });
    expect(registered.status).toBe(201);
    const first = await registered.json();
    expect(first.account).toMatchObject({ email, name: "Mobile Person" });
    expect(first.connection.name).toBe("Foundkeep for Pritam's iPhone");
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.recoveryCode).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const firstBearer = `Bearer ${first.token}`;
    expect((await (await mobile("/me", "GET", undefined, firstBearer)).json()).account).toEqual(first.account);

    const login = await mobile("/login", "POST", { email, password: PASSWORD, deviceName: "iPhone 17" });
    expect(login.status).toBe(200);
    const second = await login.json();
    expect(second.connection.name).toBe("Foundkeep for iPhone 17");
    const secondBearer = `Bearer ${second.token}`;
    expect((await mobile("/logout", "POST", undefined, secondBearer)).status).toBe(200);
    expect((await mobile("/me", "GET", undefined, secondBearer)).status).toBe(401);
    expect((await mobile("/me", "GET", undefined, firstBearer)).status).toBe(200);

    const recovered = await mobile("/recover", "POST", { email, recoveryCode: first.recoveryCode, password: "new secure mobile password", deviceName: "Replacement iPhone" });
    expect(recovered.status).toBe(200);
    const third = await recovered.json();
    expect(third.recoveryCode).not.toBe(first.recoveryCode);
    expect((await mobile("/me", "GET", undefined, firstBearer)).status).toBe(401);
    expect((await mobile("/me", "GET", undefined, `Bearer ${third.token}`)).status).toBe(200);
    expect((db.query("SELECT COUNT(*) n FROM customer_connections WHERE account_id=?").get(first.account.id) as any).n).toBe(1);
  });

  test("mobile auth validates input and never issues browser cookies", async () => {
    const email = `mobile-validation-${++sequence}@example.com`;
    const shortPassword = await mobile("/register", "POST", { email, name: "Mobile", password: "short", deviceName: "iPhone" });
    expect(shortPassword.status).toBe(400);
    const registered = await mobile("/register", "POST", { email, name: "Mobile", password: PASSWORD, deviceName: "iPhone" });
    expect(registered.status).toBe(201);
    expect(registered.headers.get("set-cookie")).toBeNull();
    expect((await mobile("/register", "POST", { email, name: "Mobile", password: PASSWORD, deviceName: "iPhone" })).status).toBe(409);
    expect((await mobile("/login", "POST", { email, password: "incorrect password", deviceName: "iPhone" })).status).toBe(401);
    expect((await mobile("/me")).status).toBe(401);
  });

  test("mobile notification routing is opt-in, connection-scoped and revoked on logout", async () => {
    const registered = await mobile("/register", "POST", {
      email: `mobile-push-${++sequence}@example.com`, name: "Mobile", password: PASSWORD, deviceName: "iPhone",
    });
    const session = await registered.json();
    const bearer = `Bearer ${session.token}`;
    expect(await (await mobile("/notifications", "GET", undefined, bearer)).json()).toEqual({ enabled: false });
    expect((await mobile("/notifications", "POST", { expoPushToken: "not-a-token" }, bearer)).status).toBe(400);
    expect((await mobile("/notifications", "POST", { expoPushToken: "ExpoPushToken[abc_DEF-0123456789]" }, bearer)).status).toBe(200);
    expect(await (await mobile("/notifications", "GET", undefined, bearer)).json()).toEqual({ enabled: true });
    expect((db.query("SELECT account_id,connection_id FROM customer_push_devices").get() as any)).toEqual({
      account_id: session.account.id, connection_id: session.connection.id,
    });
    expect((await mobile("/logout", "POST", undefined, bearer)).status).toBe(200);
    expect((db.query("SELECT COUNT(*) n FROM customer_push_devices").get() as any).n).toBe(0);
  });

  test("mobile account deletion requires the password and revokes the device", async () => {
    const email = `mobile-delete-${++sequence}@example.com`;
    const registered = await mobile("/register", "POST", { email, name: "Delete Mobile", password: PASSWORD, deviceName: "iPhone" });
    const session = await registered.json();
    const bearer = `Bearer ${session.token}`;
    expect((await capture(bearer)).status).toBe(201);
    expect((await mobile("/account", "DELETE", { password: "wrong password" }, bearer)).status).toBe(401);
    expect((await mobile("/me", "GET", undefined, bearer)).status).toBe(200);
    expect((await mobile("/account", "DELETE", { password: PASSWORD }, bearer)).status).toBe(200);
    expect((await mobile("/me", "GET", undefined, bearer)).status).toBe(401);
    expect((db.query("SELECT COUNT(*) n FROM customer_accounts WHERE id=?").get(session.account.id) as any).n).toBe(0);
    expect((db.query("SELECT COUNT(*) n FROM customer_captures WHERE account_id=?").get(session.account.id) as any).n).toBe(0);
  });

  test("accepts both exact Foundkeep website origins and rejects lookalikes", async () => {
    for (const [index, origin] of [PRIMARY_ORIGIN, LEGACY_ORIGIN].entries()) {
      const response = await app.request(`${origin}/api/auth/register`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          email: `origin-${index}-${++sequence}@example.com`,
          name: "Origin test",
          password: PASSWORD,
        }),
      });
      expect(response.status).toBe(201);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
      expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    }

    for (const origin of [
      "https://foundkeep.app.evil.example",
      "http://foundkeep.app",
      "https://foundkeep.app:444",
    ]) {
      const response = await app.request(`${PRIMARY_ORIGIN}/api/auth/register`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          email: `blocked-${++sequence}@example.com`,
          name: "Blocked origin",
          password: PASSWORD,
        }),
      });
      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  test("register hashes secrets, sets a protected cookie and persists a private account", async () => {
    const a = await register("Case@EXAMPLE.COM");
    expect(a.account.email).toBe("case@example.com");
    expect(a.recoveryCode.length).toBeGreaterThanOrEqual(32);
    expect(a.response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(a.response.headers.get("set-cookie")).toContain("SameSite=Lax");
    if (ORIGIN.startsWith("https:")) expect(a.response.headers.get("set-cookie")).toContain("Secure");
    const stored = db.query("SELECT * FROM customer_accounts").get() as any;
    expect(stored.password_hash).toStartWith("$argon2id$");
    expect(JSON.stringify(stored)).not.toContain(a.recoveryCode);
    const me = await (await request("/me", "GET", undefined, a.cookie)).json();
    expect(me.account).toEqual(a.account);
    expect(me.usage).toEqual({ captures: 0, bytes: 0, maxCaptures: 10000, maxBytes: 209715200 });
    expect(JSON.stringify(me)).not.toContain("hash");
    expect((await request("/me")).status).toBe(401);
  });

  test("login, logout, expired sessions and recovery revoke the right credentials", async () => {
    const a = await register();
    const device = await connect(a.cookie);
    expect((await request("/auth/login", "POST", { email: a.email, password: "wrong password here" })).status).toBe(401);
    const login = await request("/auth/login", "POST", { email: a.email, password: PASSWORD });
    expect(login.status).toBe(200);
    const secondCookie = login.headers.get("set-cookie")!.split(";")[0]!;
    expect((await request("/auth/logout", "POST", {}, secondCookie)).status).toBe(200);
    expect((await request("/me", "GET", undefined, secondCookie)).status).toBe(401);
    const recovered = await request("/auth/recover", "POST", { email: a.email, recoveryCode: a.recoveryCode, password: "new secure password here" });
    expect(recovered.status).toBe(200);
    const recovery = await recovered.json();
    expect(recovery.recoveryCode).not.toBe(a.recoveryCode);
    expect((await request("/me", "GET", undefined, a.cookie)).status).toBe(401);
    expect((await request("/me", "GET", undefined, device.bearer)).status).toBe(401);
    expect((await request("/auth/recover", "POST", { email: a.email, recoveryCode: a.recoveryCode, password: PASSWORD })).status).toBe(401);
    db.query("UPDATE customer_sessions SET expires_at = 0").run();
    expect((await request("/me", "GET", undefined, recovered.headers.get("set-cookie")!.split(";")[0]!)).status).toBe(401);
  });

  test("rejects CSRF, missing origins and unsafe extension origins", async () => {
    const a = await register();
    for (const origin of ["https://evil.example", null, "null", `${ORIGIN}.evil.example`]) {
      expect((await request("/auth/login", "POST", { email: a.email, password: PASSWORD }, undefined, origin)).status).toBe(403);
      expect((await request("/captures", "POST", { type: "note", clientId: "csrf" }, a.cookie, origin)).status).toBe(403);
    }
    const device = await connect(a.cookie);
    expect((await request("/captures", "POST", { clientId: "ext", type: "note" }, device.bearer, EXTENSION)).status).toBe(201);
    expect((await request("/captures", "POST", { clientId: "evil", type: "note" }, device.bearer, "chrome-extension://other")).status).toBe(403);
    expect((await request("/captures", "OPTIONS", undefined, undefined, "https://evil.example")).headers.get("access-control-allow-origin")).toBeNull();
  });

  test("pairing is one use, expiring and cookie-only; owner can revoke devices", async () => {
    const a = await register();
    const b = await register();
    const device = await connect(a.cookie);
    expect((await request("/pairing/claim", "POST", { code: device.code, name: "Reuse" }, undefined, EXTENSION)).status).toBe(401);
    expect((await request("/pairing", "POST", {}, device.bearer)).status).toBe(403);
    expect((await request(`/connections/${device.connection.id}`, "DELETE", {}, b.cookie)).status).toBe(404);
    const pair = await (await request("/pairing", "POST", {}, a.cookie)).json();
    db.query("UPDATE customer_pairings SET expires_at = 0").run();
    expect((await request("/pairing/claim", "POST", { code: pair.code, name: "Expired" }, undefined, EXTENSION)).status).toBe(401);
    expect((await request(`/connections/${device.connection.id}`, "DELETE", {}, a.cookie)).status).toBe(200);
    expect((await request("/me", "GET", undefined, device.bearer)).status).toBe(401);
  });

  test("changing password keeps current session, revokes other access, and deleting removes all owned data", async () => {
    const a = await register();
    const b = await register();
    const device = await connect(a.cookie);
    await capture(a.cookie);
    await capture(b.cookie);
    const file = Buffer.from("Foundkeep account deletion file");
    const fileMetadata = { clientId: crypto.randomUUID(), type: "file", fileName: "delete-me.txt", capturedAt: Date.now() };
    expect((await app.request(`${ORIGIN}/api/mobile/captures/file`, {
      method: "POST",
      headers: {
        authorization: device.bearer,
        "content-type": "text/plain",
        "content-length": String(file.length),
        "x-foundkeep-capture": Buffer.from(JSON.stringify(fileMetadata)).toString("base64url"),
      },
      body: file,
    })).status).toBe(201);
    const storedFile = (db.query("SELECT file_path FROM customer_captures WHERE account_id=? AND file_path IS NOT NULL").get(a.account.id) as any).file_path;
    const absoluteFile = `${process.env.ATLAS_DATA_DIR || new URL("../data", import.meta.url).pathname}/${storedFile}`;
    expect(existsSync(absoluteFile)).toBe(true);
    const login = await request("/auth/login", "POST", { email: a.email, password: PASSWORD });
    const otherCookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const change = await request("/auth/password", "POST", { currentPassword: PASSWORD, password: "replacement password 123" }, a.cookie);
    expect(change.status).toBe(200);
    expect((await change.json()).recoveryCode).toBeTruthy();
    expect((await request("/me", "GET", undefined, a.cookie)).status).toBe(200);
    expect((await request("/me", "GET", undefined, otherCookie)).status).toBe(401);
    expect((await request("/me", "GET", undefined, device.bearer)).status).toBe(401);
    expect((await request("/account", "DELETE", { password: PASSWORD }, a.cookie)).status).toBe(401);
    expect((await request("/account", "DELETE", { password: "replacement password 123" }, a.cookie)).status).toBe(200);
    expect((await request("/me", "GET", undefined, a.cookie)).status).toBe(401);
    expect((db.query("SELECT COUNT(*) n FROM customer_captures").get() as any).n).toBe(1);
    expect(existsSync(absoluteFile)).toBe(false);
    expect((await request("/me", "GET", undefined, b.cookie)).status).toBe(200);
  });

  test("bounds public auth attempts and validates passwords", async () => {
    expect((await request("/auth/register", "POST", { email: "ok@example.com", name: "A", password: "short" })).status).toBe(400);
    let response: Response;
    for (let i = 0; i < 22; i++) response = await request("/auth/login", "POST", { email: "missing@example.com", password: PASSWORD });
    expect(response!.status).toBe(429);
    expect(response!.headers.get("retry-after")).toBeTruthy();
  });

  test("parallel recovery cannot reuse a code or restore revoked browser access", async () => {
    const a = await register();
    const device = await connect(a.cookie);
    const attempts = await Promise.all([1, 2].map(() => request("/auth/recover", "POST", { email: a.email, recoveryCode: a.recoveryCode, password: "new password for recovery" })));
    expect(attempts.map((r) => r.status).sort()).toEqual([200, 401]);
    expect((await request("/me", "GET", undefined, device.bearer)).status).toBe(401);
    expect((db.query("SELECT COUNT(*) n FROM customer_sessions WHERE account_id = ?").get(a.account.id) as any).n).toBe(1);
  });

  test("expired connection credentials and credentials in URLs cannot authenticate", async () => {
    const a = await register();
    const device = await connect(a.cookie);
    expect((await request(`/me?token=${encodeURIComponent(device.token)}`)).status).toBe(401);
    db.query("UPDATE customer_connections SET expires_at = 0").run();
    expect((await request("/me", "GET", undefined, device.bearer)).status).toBe(401);
    expect((await (await request("/me", "GET", undefined, a.cookie)).json()).connections).toEqual([]);
  });

  test("an in-flight upload cannot save after its session is revoked", async () => {
    const a = await register();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    const pending = app.request(`${ORIGIN}/api/captures`, {
      method: "POST", headers: { origin: ORIGIN, cookie: a.cookie, "content-type": "application/json" }, body: stream,
    });
    await request("/auth/logout", "POST", {}, a.cookie);
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ clientId: "late-upload", type: "note", noteText: "Saved after logout?" })));
    controller.close();
    expect((await pending).status).toBe(401);
    expect((db.query("SELECT COUNT(*) n FROM customer_captures").get() as any).n).toBe(0);
  });

  test("browser disconnect revokes only its own bearer and rejects cookie authority", async () => {
    const a = await register();
    const first = await connect(a.cookie);
    const second = await connect(a.cookie);
    expect((await request("/connections/disconnect", "POST", {}, a.cookie)).status).toBe(403);
    const response = await request("/connections/disconnect", "POST", { id: second.connection.id }, first.bearer, EXTENSION);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect((await request("/me", "GET", undefined, first.bearer)).status).toBe(401);
    expect((await request("/connections/disconnect", "POST", {}, first.bearer, EXTENSION)).status).toBe(401);
    expect((await request("/me", "GET", undefined, second.bearer)).status).toBe(403);
    expect((await request("/me", "GET", undefined, a.cookie)).status).toBe(200);
  });

  test("browser disconnect prevents an in-flight upload from committing afterwards", async () => {
    const a = await register();
    const browser = await connect(a.cookie);
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    const pending = app.request(`${ORIGIN}/api/captures`, {
      method: "POST", headers: { origin: EXTENSION, authorization: browser.bearer, "content-type": "application/json" }, body: stream,
    });
    expect((await request("/connections/disconnect", "POST", undefined, browser.bearer, EXTENSION)).status).toBe(200);
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ clientId: "late-browser-upload", type: "note" })));
    controller.close();
    expect((await pending).status).toBe(401);
    expect((db.query("SELECT COUNT(*) n FROM customer_captures").get() as any).n).toBe(0);
  });

  test("a stale dashboard account header rejects a changed cookie owner for reads, writes and logout", async () => {
    const a = await register();
    const b = await register();
    for (const [path, method, body] of [
      ["/me", "GET", undefined],
      ["/captures", "POST", JSON.stringify({ clientId: "wrong-account", type: "note", noteText: "Intended for A" })],
      ["/auth/logout", "POST", undefined],
    ] as const) {
      const response = await app.request(`${ORIGIN}/api${path}`, { method, headers: { origin: ORIGIN, cookie: b.cookie, "content-type": "application/json", "X-Atlas-Account": a.account.id }, body });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: "account_changed", message: "Your signed-in account changed. Reload Foundkeep to continue." });
    }
    expect((await request("/me", "GET", undefined, b.cookie)).status).toBe(200);
    expect((db.query("SELECT COUNT(*) n FROM customer_captures").get() as any).n).toBe(0);
    const own = await app.request(`${ORIGIN}/api/captures`, { method: "POST", headers: { origin: ORIGIN, cookie: b.cookie, "content-type": "application/json", "X-Atlas-Account": b.account.id }, body: JSON.stringify({ clientId: "correct-account", type: "note" }) });
    expect(own.status).toBe(201);
    const browser = await connect(b.cookie);
    const bearer = await app.request(`${ORIGIN}/api/me`, { headers: { authorization: browser.bearer, "X-Atlas-Account": a.account.id } });
    expect(bearer.status).toBe(403);
    db.query("UPDATE customer_sessions SET expires_at=0 WHERE account_id=?").run(b.account.id);
    const expired = await app.request(`${ORIGIN}/api/auth/logout`, { method: "POST", headers: { origin: ORIGIN, cookie: b.cookie, "X-Atlas-Account": a.account.id } });
    expect(expired.status).toBe(200);
    expect(expired.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("customer extension preferences", () => {
  const changed = {
    version: 1,
    capture: {
      region: false,
      fullPage: true,
      highlight: true,
      bookmark: true,
      image: false,
      tweet: true,
      note: true,
    },
    bookmark: { readableText: true, extendedMetadata: true, headings: false },
    notes: { attachSource: false },
    popup: {
      actionOrder: ["bookmark", "highlight", "fullPage", "region"],
      showRecent: true,
      recentCount: 5,
    },
    sync: { automatic: false },
    organization: { ocr: false, summaries: true, tags: false },
    feedback: { success: true },
    contextMenus: false,
  };

  test("preferences are customer-owned, validated, and shared with connected browsers", async () => {
    const owner = await register();
    const other = await register();
    const firstBrowser = await connect(owner.cookie);
    const secondBrowser = await connect(owner.cookie);

    const defaults = await (await request("/preferences", "GET", undefined, owner.cookie)).json();
    expect(defaults.revision).toBe(0);
    expect(defaults.preferences).toEqual({
      version: 1,
      capture: { region: true, fullPage: true, highlight: true, bookmark: true, image: true, tweet: true, note: true },
      bookmark: { readableText: true, extendedMetadata: true, headings: true },
      notes: { attachSource: true },
      popup: { actionOrder: ["bookmark", "highlight", "region", "fullPage"], showRecent: true, recentCount: 3 },
      sync: { automatic: true },
      organization: { ocr: true, summaries: true, tags: true },
      feedback: { success: true },
      contextMenus: true,
    });

    expect((await request("/preferences", "PUT", changed, firstBrowser.bearer, EXTENSION)).status).toBe(403);
    const unknown = await app.request(`${ORIGIN}/api/preferences`, {
      method: "PUT",
      headers: { origin: ORIGIN, cookie: owner.cookie, "content-type": "application/json", "X-Atlas-Account": owner.account.id },
      body: JSON.stringify({ ...changed, operatorOverride: true }),
    });
    expect(unknown.status).toBe(400);
    const invalid = await app.request(`${ORIGIN}/api/preferences`, {
      method: "PUT",
      headers: { origin: ORIGIN, cookie: owner.cookie, "content-type": "application/json", "X-Atlas-Account": owner.account.id },
      body: JSON.stringify({ ...changed, popup: { ...changed.popup, recentCount: 9 } }),
    });
    expect(invalid.status).toBe(400);

    const savedResponse = await app.request(`${ORIGIN}/api/preferences`, {
      method: "PUT",
      headers: { origin: ORIGIN, cookie: owner.cookie, "content-type": "application/json", "X-Atlas-Account": owner.account.id },
      body: JSON.stringify(changed),
    });
    expect(savedResponse.status).toBe(200);
    const saved = await savedResponse.json() as any;
    expect(saved.preferences).toEqual(changed);
    expect(saved.revision).toBe(1);
    expect(saved.updatedAt).toBeGreaterThan(0);
    const exported = await (await request("/account/export", "GET", undefined, owner.cookie)).json() as any;
    expect(exported.preferences).toEqual(changed);

    for (const browser of [firstBrowser, secondBrowser]) {
      const shared = await (await request("/preferences", "GET", undefined, browser.bearer, EXTENSION)).json();
      expect(shared.preferences).toEqual(changed);
      expect(shared.revision).toBe(1);
    }
    const isolated = await (await request("/preferences", "GET", undefined, other.cookie)).json();
    expect(isolated.preferences.capture.region).toBe(true);
    expect(isolated.revision).toBe(0);
  });

  test("an in-flight preference write cannot commit after its session is revoked", async () => {
    const owner = await register();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    const pending = app.request(`${ORIGIN}/api/preferences`, {
      method: "PUT",
      headers: { origin: ORIGIN, cookie: owner.cookie, "content-type": "application/json", "X-Atlas-Account": owner.account.id },
      body: stream,
    });
    expect((await request("/auth/logout", "POST", {}, owner.cookie)).status).toBe(200);
    controller.enqueue(new TextEncoder().encode(JSON.stringify(changed)));
    controller.close();
    expect((await pending).status).toBe(401);
    expect((db.query("SELECT COUNT(*) n FROM customer_preferences").get() as any).n).toBe(0);
  });
});

describe("private customer captures", () => {
  test("mobile clients upload, list, read and delete an owned file idempotently", async () => {
    const registered = await mobile("/register", "POST", {
      email: `file-${++sequence}@example.com`, name: "File Owner", password: PASSWORD, deviceName: "iPhone",
    });
    const session = await registered.json();
    const bearer = `Bearer ${session.token}`;
    const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
    const metadata = {
      clientId: crypto.randomUUID(), batchId: crypto.randomUUID(), type: "document",
      sourceUrl: "https://example.com/report", sourceTitle: "Report", noteText: "Keep this",
      fileName: "Quarterly Report.pdf", capturedAt: Date.now(),
    };
    const upload = () => app.request(`${ORIGIN}/api/mobile/captures/file`, {
      method: "POST",
      headers: {
        authorization: bearer,
        "content-type": "application/pdf",
        "content-length": String(pdf.length),
        "x-foundkeep-capture": Buffer.from(JSON.stringify(metadata)).toString("base64url"),
      },
      body: pdf,
    });
    const response = await upload();
    expect(response.status).toBe(201);
    const first = await response.json() as any;
    expect(first.duplicate).toBe(false);
    expect(first.capture).toMatchObject({
      type: "document", batchId: metadata.batchId, fileName: metadata.fileName,
      fileMime: "application/pdf", fileBytes: pdf.length,
    });
    expect(first.capture.fileUrl).toBe(`/api/captures/${first.capture.id}/file`);
    const duplicate = await upload();
    expect(duplicate.status).toBe(200);
    expect((await duplicate.json() as any).capture.id).toBe(first.capture.id);

    const list = await mobile("/captures", "GET", undefined, bearer);
    expect(list.status).toBe(200);
    expect((await list.json() as any).captures[0].id).toBe(first.capture.id);
    const file = await mobile(`/captures/${first.capture.id}/file`, "GET", undefined, bearer);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(file.headers.get("content-disposition")).toContain("Quarterly%20Report.pdf");
    expect(Buffer.from(await file.arrayBuffer())).toEqual(pdf);
    expect((await mobile(`/captures/${first.capture.id}`, "DELETE", undefined, bearer)).status).toBe(200);
    expect((await mobile(`/captures/${first.capture.id}/file`, "GET", undefined, bearer)).status).toBe(404);
  });

  test("mobile collection pagination returns every item once with a bounded cursor", async () => {
    const registered = await mobile("/register", "POST", {
      email: `pages-${++sequence}@example.com`, name: "Paged Owner", password: PASSWORD, deviceName: "iPhone",
    });
    const session = await registered.json();
    const bearer = `Bearer ${session.token}`;
    for (let index = 0; index < 105; index += 1) {
      expect((await capture(bearer, { clientId: `page-${index}`, noteText: `Page ${index}`, capturedAt: 2_000_000 - index })).status).toBe(201);
    }
    const first = await (await mobile("/captures", "GET", undefined, bearer)).json() as any;
    expect(first.captures).toHaveLength(50);
    expect(first.total).toBe(105);
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    const second = await (await mobile(`/captures?cursor=${first.nextCursor}`, "GET", undefined, bearer)).json() as any;
    const third = await (await mobile(`/captures?cursor=${second.nextCursor}`, "GET", undefined, bearer)).json() as any;
    expect(second.captures).toHaveLength(50);
    expect(third.captures).toHaveLength(5);
    expect(third.nextCursor).toBeNull();
    expect(new Set([...first.captures, ...second.captures, ...third.captures].map(item => item.id)).size).toBe(105);
    expect((await mobile("/captures?cursor=not-a-cursor", "GET", undefined, bearer)).status).toBe(400);
    const recentFirst = await (await mobile("/captures?sort=recent", "GET", undefined, bearer)).json();
    const recentSecond = await (await mobile(`/captures?sort=recent&cursor=${recentFirst.nextCursor}`, "GET", undefined, bearer)).json();
    const recentThird = await (await mobile(`/captures?sort=recent&cursor=${recentSecond.nextCursor}`, "GET", undefined, bearer)).json();
    const recent = [...recentFirst.captures, ...recentSecond.captures, ...recentThird.captures];
    expect(new Set(recent.map(item => item.id)).size).toBe(105);
    expect(recent.every(item => item.savedVia === "iphone")).toBe(true);
    expect(recent.map(item => item.id)).toEqual(db.query("SELECT id FROM customer_captures ORDER BY created_at DESC,id DESC").all().map((item: any) => item.id));
    expect((await mobile(`/captures?sort=recent&cursor=${first.nextCursor}`, "GET", undefined, bearer)).status).toBe(400);

  });

  test("models universal mobile items and preserves multi-share provenance", async () => {
    const registered = await mobile("/register", "POST", {
      email: `universal-${++sequence}@example.com`, name: "Universal", password: PASSWORD, deviceName: "iPhone",
    });
    const session = await registered.json();
    const bearer = `Bearer ${session.token}`;
    const batchId = crypto.randomUUID();
    const capturedAt = Date.now() - 1_000;
    const provenance = {
      schemaVersion: 1,
      captureMethod: "ios-share-document",
      pageUrl: "https://example.com/report",
      canonicalUrl: "https://example.com/report",
      pageTitle: "Quarterly report",
      siteName: "Example",
      description: "A report shared from Files.",
      authors: ["Example Team"],
      publishedAt: null,
      modifiedAt: null,
      language: "en",
      leadImageUrl: null,
      faviconUrl: "https://example.com/favicon.ico",
      targetUrl: null,
      headings: [],
      capturedAt,
      extractedAt: capturedAt,
      extractorVersion: 1,
      contentHash: "b".repeat(43),
      extractionStatus: "complete",
      extractionError: null,
      sourceApplication: "com.apple.DocumentsApp",
      originalFileName: "Quarterly Report.pdf",
      declaredMime: "application/pdf",
      byteSize: 12345,
    };
    for (const [index, type] of ["video", "audio", "document", "file"].entries()) {
      const response = await capture(bearer, {
        clientId: `mobile-item-${index}`, type, batchId, capturedAt, provenance,
      });
      expect(response.status).toBe(201);
      const item = (await response.json()).capture;
      expect(item).toMatchObject({
        clientId: `mobile-item-${index}`, type, batchId,
        fileName: null, fileMime: null, fileBytes: 0, fileUrl: null,
      });
      expect(item.provenance).toEqual(provenance);
    }
    const columns = (db.query("PRAGMA table_info(customer_captures)").all() as any[]).map((row) => row.name);
    expect(columns).toEqual(expect.arrayContaining(["batch_id", "file_name", "file_path", "file_mime", "file_bytes"]));
    expect((await capture(bearer, { type: "document", batchId: "not-a-uuid" })).status).toBe(400);
    expect((await capture(bearer, { type: "document", provenance: { ...provenance, sourceApplication: "x".repeat(301) } })).status).toBe(400);
  });

  test("preserves bounded provenance and processing choices without trusting unsafe origins", async () => {
    const owner = await register();
    const other = await register();
    const provenance = {
      schemaVersion: 1,
      captureMethod: "popup-save-page",
      pageUrl: "https://visited.example/story?from=feed",
      canonicalUrl: "https://visited.example/story",
      pageTitle: "A useful article",
      siteName: "The Example",
      description: "A precise description.",
      authors: ["Mina Rao", "Eli Stone"],
      publishedAt: "2026-08-14T09:30:00.000Z",
      modifiedAt: "2026-08-15T11:00:00.000Z",
      language: "en",
      leadImageUrl: "https://visited.example/media/lead.jpg",
      faviconUrl: "https://visited.example/favicon.ico",
      targetUrl: null,
      headings: ["The first section", "What changed"],
      capturedAt: 1_786_013_400_000,
      extractedAt: 1_786_013_400_123,
      extractorVersion: 1,
      contentHash: "a".repeat(43),
      extractionStatus: "complete",
      extractionError: null,
    };
    const processingOptions = { ocr: false, summaries: true, tags: false };
    const response = await capture(owner.cookie, {
      clientId: "rich-bookmark",
      type: "bookmark",
      sourceUrl: provenance.pageUrl,
      sourceTitle: provenance.pageTitle,
      articleText: "Readable body text from the saved article.",
      capturedAt: provenance.capturedAt,
      provenance,
      processingOptions,
    });
    expect(response.status).toBe(201);
    const saved = (await response.json()).capture;
    expect(saved.provenance).toEqual(provenance);
    expect(saved.processingOptions).toEqual(processingOptions);
    expect(saved.articleText).toContain("Readable body text");
    expect((await request(`/captures/${saved.id}`, "GET", undefined, other.cookie)).status).toBe(404);
    const exported = await (await request("/account/export", "GET", undefined, owner.cookie)).json();
    expect(exported.captures[0].provenance).toEqual(provenance);
    const stored = db.query("SELECT storage_bytes,provenance_json,processing_options_json FROM customer_captures WHERE id=?").get(saved.id) as any;
    expect(stored.provenance_json).toBe(JSON.stringify(provenance));
    expect(stored.processing_options_json).toBe(JSON.stringify(processingOptions));
    expect(stored.storage_bytes).toBeGreaterThan(Buffer.byteLength("Readable body text from the saved article.", "utf8"));

    for (const invalid of [
      { ...provenance, canonicalUrl: "javascript:alert(1)" },
      { ...provenance, pageUrl: "https://name:secret@visited.example/story" },
      { ...provenance, authors: Array(9).fill("Writer") },
      { ...provenance, headings: Array(21).fill("Heading") },
      { ...provenance, publishedAt: "last Thursday" },
      { ...provenance, contentHash: "not-a-hash" },
      { ...provenance, unexpected: "field" },
    ]) {
      expect((await capture(owner.cookie, { type: "bookmark", provenance: invalid })).status).toBe(400);
    }
    expect((await capture(owner.cookie, { processingOptions: { ocr: true, summaries: true, tags: true, execute: true } })).status).toBe(400);
  });

  test("only two uploads per account can retain request bodies, with slots released after invalid bodies", async () => {
    const a = await register();
    const held = [heldUpload(a.cookie), heldUpload(a.cookie)];
    try {
      const response = await capture(a.cookie);
      expect(response.status).toBe(429);
      expect(Number(response.headers.get("retry-after"))).toBeLessThanOrEqual(5);
    } finally { held.forEach((value) => value.close()); await Promise.all(held.map((value) => value.response)); }
    expect((await capture(a.cookie, { type: "invalid" })).status).toBe(400);
    expect((await capture(a.cookie)).status).toBe(201);
  });

  test("eight retained upload bodies exhaust the process-wide limit across app instances and accounts", async () => {
    const owners = [];
    for (let index = 0; index < 5; index++) owners.push(await register());
    const held = owners.slice(0,4).flatMap((owner) => [heldUpload(owner.cookie), heldUpload(owner.cookie)]);
    try {
      const response = await createApp(db).request(`${ORIGIN}/api/captures`, { method: "POST", headers: { origin: ORIGIN, cookie: owners[4].cookie, "content-type": "application/json" }, body: JSON.stringify({ clientId: "extra-process-upload", type: "note" }) });
      expect(response.status).toBe(503);
      expect(Number(response.headers.get("retry-after"))).toBeLessThanOrEqual(5);
      held[0]!.close();
      await held[0]!.response;
      expect((await capture(owners[4].cookie)).status).toBe(201);
    } finally { held.forEach((value) => value.close()); await Promise.all(held.map((value) => value.response)); }
  });

  test("an aborted streamed upload releases its slot without saving partial data", async () => {
    const a = await register();
    const held = [heldUpload(a.cookie), heldUpload(a.cookie)];
    try {
      held[0]!.signal.abort();
      expect((await held[0]!.response).status).toBe(400);
      expect(held[0]!.isCancelled()).toBe(true);
      expect((await capture(a.cookie)).status).toBe(201);
      expect((db.query("SELECT COUNT(*) n FROM customer_captures").get() as any).n).toBe(1);
    } finally { held.forEach((value) => value.close()); await Promise.all(held.map((value) => value.response)); }
  });

  test("a slow body has an absolute thirty-second deadline even when another chunk arrives", async () => {
    const a = await register();
    const held = heldUpload(a.cookie);
    const extra = setTimeout(() => held.controller.enqueue(new TextEncoder().encode("still sending")), 15_000);
    const started = performance.now();
    try {
      const response = await held.response;
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("3");
      expect(performance.now() - started).toBeLessThan(34_000);
      expect(held.isCancelled()).toBe(true);
      expect((await capture(a.cookie)).status).toBe(201);
    } finally { clearTimeout(extra); held.close(); await held.response; }
  }, 35_000);

  test("tenant-scopes list, search, detail, blobs, delete, exports and ignores submitted ownership/enrichment", async () => {
    const a = await register();
    const b = await register();
    const device = await connect(a.cookie);
    const saved = await capture(device.bearer, { dataUrl: PNG, accountId: b.account.id, status: "done", summary: "injected", noteText: "Secret keyword" });
    expect(saved.status).toBe(201);
    const item = (await saved.json()).capture;
    expect(item.status).toBe("pending");
    expect(item.summary).toBeNull();
    expect(item.blobUrl).toBe(`/api/captures/${item.id}/blob`);
    expect(JSON.stringify(item)).not.toContain("base64");
    for (const path of ["/captures", "/captures?q=keyword", "/account/export"]) {
      const result = await (await request(path, "GET", undefined, b.cookie)).json();
      expect(result.captures).toEqual([]);
    }
    for (const path of [`/captures/${item.id}`, `/captures/${item.id}/blob`]) expect((await request(path, "GET", undefined, b.cookie)).status).toBe(404);
    expect((await request(`/captures/${item.id}`, "DELETE", {}, b.cookie)).status).toBe(404);
    for (const [path, method] of [
      ["/me", "GET"],
      ["/captures", "GET"],
      [`/captures/${item.id}`, "GET"],
      [`/captures/${item.id}/blob`, "GET"],
      [`/captures/${item.id}`, "DELETE"],
    ] as const) {
      expect((await request(path, method, method === "DELETE" ? {} : undefined, device.bearer, EXTENSION)).status).toBe(403);
    }
    const blob = await request(`/captures/${item.id}/blob`, "GET", undefined, a.cookie);
    expect(blob.status).toBe(200);
    expect(blob.headers.get("content-type")).toBe("image/png");
    expect(blob.headers.get("cache-control")).toContain("no-store");
    expect(blob.headers.get("x-content-type-options")).toBe("nosniff");
    const exported = await (await request("/account/export", "GET", undefined, a.cookie)).json();
    expect(exported.captures[0].dataUrl).toBe(PNG);
    expect((await app.request(`${ORIGIN}/v1/captures`, { headers: { authorization: device.bearer } })).status).toBe(401);
    expect((db.query("SELECT COUNT(*) n FROM captures").get() as any).n).toBe(0);
    expect((await request(`/captures/${item.id}`, "DELETE", {}, a.cookie)).status).toBe(200);
    expect((await request(`/captures/${item.id}/blob`, "GET", undefined, a.cookie)).status).toBe(404);
  });

  test("upload idempotency is per account and pagination/search are stable", async () => {
    const a = await register();
    const b = await register();
    const first = await (await capture(a.cookie, { clientId: "same", capturedAt: 1000, noteText: "Alpha" })).json();
    const duplicate = await (await capture(a.cookie, { clientId: "same", noteText: "Overwrite" })).json();
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.capture.id).toBe(first.capture.id);
    expect(duplicate.capture.noteText).toBe("Alpha");
    const separate = await (await capture(b.cookie, { clientId: "same" })).json();
    expect(separate.capture.id).not.toBe(first.capture.id);
    await capture(a.cookie, { clientId: "second", capturedAt: 2000, noteText: "Beta" });
    const page = await (await request("/captures?limit=1", "GET", undefined, a.cookie)).json();
    expect(page.captures[0].clientId).toBe("second");
    expect(page.total).toBe(2);
    const next = await (await request(`/captures?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`, "GET", undefined, a.cookie)).json();
    expect(next.captures[0].id).toBe(first.capture.id);
    expect(next.nextCursor).toBeNull();
    const search = await (await request("/captures?q=Alpha&type=note", "GET", undefined, a.cookie)).json();
    expect(search.captures.map((x: any) => x.id)).toEqual([first.capture.id]);
    expect((await request("/captures?cursor=garbage", "GET", undefined, a.cookie)).status).toBe(400);
  });

  test("validates content and images, bounds bodies, and enforces account quotas atomically", async () => {
    const a = await register();
    for (const invalid of [
      { type: "script" }, { sourceUrl: "javascript:alert(1)" },
      { noteText: "a".repeat(50001) }, { selectionText: "a".repeat(50001) }, { articleText: "a".repeat(500001) },
      { dataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" }, { dataUrl: "data:image/png;base64,PHNjcmlwdD4=" },
      { dataUrl: PNG.replace("image/png", "image/jpeg") }, { capturedAt: "yesterday" },
    ]) expect((await capture(a.cookie, invalid)).status).toBe(400);
    expect((await capture(a.cookie, { dataUrl: "data:image/png;base64," + Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64") })).status).toBe(413);
    const large = await app.request(`${ORIGIN}/api/captures`, { method: "POST", headers: { origin: ORIGIN, cookie: a.cookie, "content-type": "application/json", "content-length": "20000000" }, body: "{}" });
    expect(large.status).toBe(413);
    const first = await (await capture(a.cookie, { clientId: "original" })).json();
    db.query("UPDATE customer_captures SET storage_bytes = 209715200 WHERE id = ?").run(first.capture.id);
    expect((await capture(a.cookie)).status).toBe(409);
    expect((await (await capture(a.cookie, { clientId: "original" })).json()).duplicate).toBe(true);
    await request(`/captures/${first.capture.id}`, "DELETE", {}, a.cookie);
    expect((await capture(a.cookie)).status).toBe(201);
  });

  test("bounds image dimensions from the encoded bytes rather than trusting caller dimensions", async () => {
    const a = await register();
    const data = Buffer.from(PNG.split(",")[1]!, "base64");
    data.writeUInt32BE(100_000, 16);
    expect((await capture(a.cookie, { dataUrl: `data:image/png;base64,${data.toString("base64")}`, width: 1, height: 1 })).status).toBe(400);
    const valid = await (await capture(a.cookie, { dataUrl: PNG, width: 200, height: 200 })).json();
    expect(valid.capture.width).toBe(1);
    expect(valid.capture.height).toBe(1);
  });

  test("a full 10000 capture export completes and concurrent last-slot uploads obey quota", async () => {
    const a = await register();
    db.transaction(() => {
      const insert = db.query("INSERT INTO customer_captures(id,account_id,client_id,type,storage_bytes,captured_at,created_at,updated_at) VALUES(?,?,?,'note',1,1,1,1)");
      for (let i = 0; i < 9999; i++) insert.run(`seed-${i}`, a.account.id, `seed-${i}`);
    })();
    const attempts = await Promise.all([capture(a.cookie), capture(a.cookie)]);
    expect(attempts.map((r) => r.status).sort()).toEqual([201, 409]);
    const exported = await (await request("/account/export", "GET", undefined, a.cookie)).json();
    expect(exported.captures.length).toBe(10000);
  });

  test("global storage ceiling rejects a new owner without blocking deletion or duplicate retries", async () => {
    const a = await register();
    const b = await register();
    const item = (await (await capture(a.cookie, { clientId: "global" })).json()).capture;
    db.query("UPDATE customer_captures SET storage_bytes = 2147483648 WHERE id = ?").run(item.id);
    expect((await capture(b.cookie)).status).toBe(503);
    expect((await (await capture(a.cookie, { clientId: "global" })).json()).duplicate).toBe(true);
    expect((await request(`/captures/${item.id}`, "DELETE", {}, a.cookie)).status).toBe(200);
    expect((await capture(b.cookie)).status).toBe(201);
  });

  test("chunked requests cannot evade the body limit and API errors remain JSON", async () => {
    const a = await register();
    const chunk = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      for (let i = 0; i < 13; i++) controller.enqueue(chunk);
      controller.close();
    } });
    const response = await app.request(`${ORIGIN}/api/captures`, {
      method: "POST", headers: { origin: ORIGIN, cookie: a.cookie, "content-type": "application/json" }, body: stream,
    });
    expect(response.status).toBe(413);
    const unknown = await request("/no-such-route");
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).message).toBeTruthy();
  });
});

test('device status comes from the issuing route and only lists live owned connections', async () => {
  const owner = await register();
  const other = await register();
  const pair = await (await request('/pairing', 'POST', {}, owner.cookie)).json();
  const browser = await (await request('/pairing/claim', 'POST', { code: pair.code, name: 'Foundkeep for iPhone' }, undefined, EXTENSION)).json();
  expect(browser.connection.clientKind).toBe('browser');
  const phone = await (await mobile('/login', 'POST', { email: owner.email, password: PASSWORD, deviceName: 'Chrome browser' })).json();
  expect(phone.connection.clientKind).toBe('mobile');
  let me = await (await request('/me', 'GET', undefined, owner.cookie)).json();
  expect(me.connections.map((c: any) => c.clientKind).sort()).toEqual(['browser', 'mobile']);
  expect(JSON.stringify(me.connections)).not.toContain(phone.token);
  expect((await (await request('/me', 'GET', undefined, other.cookie)).json()).connections).toEqual([]);
  db.query("UPDATE customer_connections SET client_kind = 'unknown' WHERE id = ?").run(phone.connection.id);
  expect((await mobile('/me', 'GET', undefined, `Bearer ${phone.token}`)).status).toBe(200);
  expect((db.query('SELECT client_kind FROM customer_connections WHERE id = ?').get(phone.connection.id) as any).client_kind).toBe('mobile');
  // A known browser credential retains its classification even on a mobile route.
  await mobile('/me', 'GET', undefined, `Bearer ${browser.token}`);
  expect((db.query('SELECT client_kind FROM customer_connections WHERE id = ?').get(browser.connection.id) as any).client_kind).toBe('browser');
  await request(`/connections/${phone.connection.id}`, 'DELETE', undefined, owner.cookie);
  expect((await mobile('/me', 'GET', undefined, `Bearer ${phone.token}`)).status).toBe(401);
  db.query('UPDATE customer_connections SET expires_at = 0 WHERE id = ?').run(browser.connection.id);
  me = await (await request('/me', 'GET', undefined, owner.cookie)).json();
  expect(me.connections).toEqual([]);
});
