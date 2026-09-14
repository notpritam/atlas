import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { openDb } from "../src/db.ts";
import { createApp } from "../src/app.ts";
import { config } from "../src/config.ts";
import {
  createPreservationService,
  preparePreservedCleanup,
} from "../src/customer-preservation.ts";
let db: ReturnType<typeof openDb>, app: ReturnType<typeof createApp>;
const password = "A temporary preservation test password";
const sourceUrl = "https://x.com/mina/status/12345";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEwoAAAAASUVORK5CYII=",
  "base64",
);
beforeEach(() => {
  db = openDb(":memory:");
  app = createApp(db);
});
afterEach(() => {
  for (const row of db.query("SELECT id FROM customer_accounts").all() as {
    id: string;
  }[])
    preparePreservedCleanup(db, config.dataDir, row.id)();
  db.close();
});
async function request(
  path: string,
  method = "GET",
  data?: unknown,
  credential?: string,
  headers: Record<string, string> = {},
) {
  return app.request(config.customerOrigin + "/api" + path, {
    method,
    headers: {
      Origin: config.customerOrigin,
      ...(credential
        ? {
            [credential.startsWith("Bearer ") ? "Authorization" : "Cookie"]:
              credential,
          }
        : {}),
      ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}
async function register() {
  const response = await request("/auth/register", "POST", {
    name: "Preservation test",
    email: crypto.randomUUID() + "@example.test",
    password,
  });
  expect(response.status).toBe(201);
  return {
    ...((await response.json()) as any),
    cookie: response.headers.get("set-cookie")!.split(";")[0]!,
  };
}
async function save(cookie: string, extra = {}) {
  const response = await request(
    "/captures",
    "POST",
    {
      clientId: crypto.randomUUID(),
      type: "tweet",
      sourceUrl,
      selectionText: "Selected tweet",
      ...extra,
    },
    cookie,
  );
  expect(response.status).toBe(201);
  return ((await response.json()) as any).capture;
}
const worker = () =>
  createPreservationService(db, {
    resolve: async () => ({
      text: "Selected tweet",
      author: "Mina",
      publishedAt: null,
      metadataAvailable: true,
      media: [{ kind: "image", url: "https://pbs.twimg.com/media/a.png" }],
      links: [],
    }),
    read: async (url) => ({ url, mime: "image/png", data: png }),
  });
test("new X saves queue once on Free and expose private ranged copies through cookie and mobile credentials", async () => {
  const owner = await register(),
    other = await register(),
    capture = await save(owner.cookie);
  expect(
    (db.query("SELECT COUNT(*) n FROM customer_preservation_jobs").get() as any)
      .n,
  ).toBe(1);
  const service = worker();
  await service.tick();
  service.close();
  const read = await request(
    `/captures/${capture.id}/preservation`,
    "GET",
    undefined,
    owner.cookie,
  );
  expect(read.status).toBe(200);
  expect(read.headers.get("cache-control")).toContain("no-store");
  const result = ((await read.json()) as any).preservation;
  expect(result.status).toBe("ready");
  const asset = result.assets.find((item: any) => item.kind === "image");
  const path = asset.url.replace(/^\/api/, "");
  expect((await request(path)).status).toBe(401);
  expect((await request(path, "GET", undefined, other.cookie)).status).toBe(
    404,
  );
  expect(
    (
      await request(
        `/captures/${capture.id}/preservation`,
        "GET",
        undefined,
        other.cookie,
      )
    ).status,
  ).toBe(404);
  const range = await request(path, "GET", undefined, owner.cookie, {
    Range: "bytes=0-7",
  });
  expect(range.status).toBe(206);
  expect(range.headers.get("Content-Range")).toBe(`bytes 0-7/${png.length}`);
  expect(Buffer.from(await range.arrayBuffer())).toEqual(png.subarray(0, 8));
  const whole = await request(
    asset.downloadUrl.replace(/^\/api/, ""),
    "GET",
    undefined,
    owner.cookie,
  );
  expect(whole.headers.get("content-disposition")).toStartWith("attachment;");
  expect(
    createHash("sha256")
      .update(Buffer.from(await whole.arrayBuffer()))
      .digest("base64url"),
  ).toBe(asset.sha256);
  const code = (
    (await (await request("/pairing", "POST", {}, owner.cookie)).json()) as any
  ).code;
  const paired = await request(
    "/pairing/claim",
    "POST",
    { code, name: "Test extension" },
    undefined,
    { Origin: "chrome-extension://" + config.customerExtensionIds[0] },
  );
  expect(paired.status).toBe(201);
  const bearer = "Bearer " + ((await paired.json()) as any).token;
  expect(
    (await request("/mobile" + path, "GET", undefined, bearer)).status,
  ).toBe(200);
  expect((await request(path, "GET", undefined, bearer)).status).toBe(403);
  expect(
    (
      await request(
        `/mobile/captures/${capture.id}/preservation`,
        "GET",
        undefined,
        bearer,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await request(
        `/captures/${capture.id}/preservation`,
        "POST",
        { url: "http://127.0.0.1" },
        owner.cookie,
      )
    ).status,
  ).toBe(400);
});
test("failed deletion proofs and foreign deletes keep files; an authorized delete removes jobs and copies", async () => {
  const owner = await register(),
    other = await register(),
    capture = await save(owner.cookie);
  const service = worker();
  await service.tick();
  service.close();
  const stored = (
    db
      .query("SELECT file_path FROM customer_media_assets WHERE kind='image'")
      .get() as any
  ).file_path;
  const file = Bun.file(config.dataDir + "/" + stored);
  expect(await file.exists()).toBe(true);
  expect(
    (
      await request(
        "/account",
        "DELETE",
        { reauthToken: "invalid-proof" },
        owner.cookie,
      )
    ).status,
  ).not.toBe(200);
  expect(await file.exists()).toBe(true);
  expect(
    (
      await request(
        `/captures/${capture.id}`,
        "DELETE",
        undefined,
        other.cookie,
      )
    ).status,
  ).toBe(404);
  expect(await file.exists()).toBe(true);
  expect(
    (
      await request(
        `/captures/${capture.id}`,
        "DELETE",
        undefined,
        owner.cookie,
      )
    ).status,
  ).toBe(200);
  expect(await Bun.file(config.dataDir + "/" + stored).exists()).toBe(false);
  expect(
    (db.query("SELECT COUNT(*) n FROM customer_preservation_jobs").get() as any)
      .n,
  ).toBe(0);
  expect(
    (db.query("SELECT COUNT(*) n FROM customer_media_assets").get() as any).n,
  ).toBe(0);
});
test("ordinary saves do not queue downloads; changing an archived post source cannot retry it against another post", async () => {
  const owner = await register();
  await save(owner.cookie, { type: "note", sourceUrl: null });
  expect(
    (db.query("SELECT COUNT(*) n FROM customer_preservation_jobs").get() as any)
      .n,
  ).toBe(0);
  const capture = await save(owner.cookie);
  db.query("UPDATE customer_captures SET source_url=? WHERE id=?").run(
    "https://x.com/other/status/999",
    capture.id,
  );
  expect(
    (
      await request(
        `/captures/${capture.id}/preservation`,
        "POST",
        {},
        owner.cookie,
      )
    ).status,
  ).toBe(409);
});
