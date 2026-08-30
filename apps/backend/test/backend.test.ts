import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the store at a throwaway dir BEFORE the modules that read config load.
process.env.ATLAS_DATA_DIR = mkdtempSync(join(tmpdir(), "atlas-test-"));

const { openDb } = await import("../src/db.ts");
const { createApp } = await import("../src/app.ts");
const { mintDevice } = await import("../src/devices.ts");

const db = openDb();
const app = createApp(db);
const full = mintDevice(db, {
  name: "test-all",
  kind: "test",
  scopes: ["ingest", "read", "enrich"],
}).token;
const readOnly = mintDevice(db, {
  name: "reader",
  kind: "test",
  scopes: ["read"],
}).token;

function call(
  method: string,
  path: string,
  opts: { token?: string; json?: unknown; body?: BodyInit } = {},
) {
  const headers = new Headers();
  if (opts.token) headers.set("authorization", `Bearer ${opts.token}`);
  let body = opts.body;
  if (opts.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(opts.json);
  }
  return app.fetch(new Request(`http://x${path}`, { method, headers, body }));
}

test("rejects requests with no token", async () => {
  const res = await call("GET", "/v1/health");
  expect(res.status).toBe(401);
});

test("health works with a valid token", async () => {
  const res = await call("GET", "/v1/health", { token: full });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.service).toBe("atlas");
});

test("scope is enforced — read-only token cannot ingest", async () => {
  const res = await call("POST", "/v1/captures", {
    token: readOnly,
    json: { type: "note", noteText: "nope" },
  });
  expect(res.status).toBe(403);
});

test("ingest a note, then list it back", async () => {
  const created = await call("POST", "/v1/captures", {
    token: full,
    json: { type: "note", noteText: "buy oat milk", sourceTitle: "errand" },
  });
  expect(created.status).toBe(201);
  const capture = await created.json();
  expect(capture.type).toBe("note");
  expect(capture.status).toBe("pending");

  const list = await call("GET", "/v1/captures?type=note", { token: full });
  const body = await list.json();
  expect(body.captures.some((x: { id: string }) => x.id === capture.id)).toBe(true);
});

test("FTS search finds a highlight by content", async () => {
  await call("POST", "/v1/captures", {
    token: full,
    json: {
      type: "highlight",
      selectionText: "the mitochondria is the powerhouse of the cell",
      sourceUrl: "https://bio.example/cell",
    },
  });
  const res = await call("GET", "/v1/captures?q=mitochondria", { token: full });
  const body = await res.json();
  expect(body.captures.length).toBeGreaterThan(0);
  expect(body.captures[0].selectionText).toContain("mitochondria");
});

test("multipart image capture stores and serves a blob", async () => {
  // 1x1 PNG
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQBM2nvOAAAAAElFTkSuQmCC",
    ),
    (ch) => ch.charCodeAt(0),
  );
  const fd = new FormData();
  fd.set("meta", JSON.stringify({ type: "image", sourceTitle: "dot" }));
  fd.set("blob", new File([png], "dot.png", { type: "image/png" }));
  const created = await call("POST", "/v1/captures", { token: full, body: fd });
  expect(created.status).toBe(201);
  const capture = await created.json();
  expect(capture.hasBlob).toBe(true);

  const blob = await call("GET", `/v1/captures/${capture.id}/blob`, {
    token: full,
  });
  expect(blob.status).toBe(200);
  expect(blob.headers.get("content-type")).toBe("image/png");
  expect((await blob.arrayBuffer()).byteLength).toBe(png.byteLength);
});

test("claim → enrichment queue lifecycle", async () => {
  const created = await call("POST", "/v1/captures", {
    token: full,
    json: { type: "bookmark", sourceUrl: "https://ex.com", sourceTitle: "Ex" },
  });
  const capture = await created.json();

  const claimed = await call("POST", "/v1/captures/claim", {
    token: full,
    json: { owner: "worker-1", limit: 5 },
  });
  const claimBody = await claimed.json();
  const mine = claimBody.captures.find((x: { id: string }) => x.id === capture.id);
  expect(mine).toBeDefined();
  expect(mine.status).toBe("processing");

  const enriched = await call(
    "PATCH",
    `/v1/captures/${capture.id}/enrichment`,
    {
      token: full,
      json: {
        summary: "An example site",
        category: "reference",
        tags: ["example", "web"],
        status: "done",
      },
    },
  );
  const done = await enriched.json();
  expect(done.status).toBe("done");
  expect(done.tags).toEqual(["example", "web"]);
  expect(done.category).toBe("reference");

  const byTag = await call("GET", "/v1/captures?tag=example", { token: full });
  const tagged = await byTag.json();
  expect(tagged.captures.some((x: { id: string }) => x.id === capture.id)).toBe(true);
});
