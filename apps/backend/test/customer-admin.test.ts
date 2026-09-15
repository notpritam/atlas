import { afterEach, beforeEach, expect, test } from "bun:test";
import { openDb } from "../src/db.ts";
import { createApp } from "../src/app.ts";
import { config } from "../src/config.ts";

let db: ReturnType<typeof openDb>, app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = openDb(":memory:");
  app = createApp(db);
});
afterEach(() => {
  db.close();
  delete process.env.FOUNDKEEP_ADMIN_EMAILS;
});

async function request(path: string, method = "GET", data?: unknown, cookie?: string) {
  return app.request(config.customerOrigin + "/api" + path, {
    method,
    headers: {
      Origin: config.customerOrigin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}
async function register() {
  const r = await request("/auth/register", "POST", {
    name: "Test User",
    email: crypto.randomUUID() + "@example.test",
    password: "A sufficiently long test password",
  });
  expect(r.status).toBe(201);
  return { ...((await r.json()) as any), cookie: r.headers.get("set-cookie")!.split(";")[0]! };
}
async function save(cookie: string, extra: Record<string, unknown> = {}) {
  const r = await request("/captures", "POST", { clientId: crypto.randomUUID(), type: "bookmark", sourceUrl: "https://example.com/x", ...extra }, cookie);
  expect(r.status).toBe(201);
  return ((await r.json()) as any).capture;
}

test("admin gate blocks non-admins and allows an allowlisted email", async () => {
  const user = await register();
  expect((await request("/admin/overview", "GET", undefined, user.cookie)).status).toBe(403);
  expect((await request("/admin/me", "GET", undefined, user.cookie)).status).toBe(403);
  process.env.FOUNDKEEP_ADMIN_EMAILS = user.account.email;
  expect((await request("/admin/overview", "GET", undefined, user.cookie)).status).toBe(200);
  const me = (await (await request("/admin/me", "GET", undefined, user.cookie)).json()) as any;
  expect(me.admin).toBe(true);
  expect(me.email).toBe(user.account.email);
});

test("overview and usage reflect seeded users and saves", async () => {
  const admin = await register();
  process.env.FOUNDKEEP_ADMIN_EMAILS = admin.account.email;
  const other = await register();
  await save(admin.cookie, { type: "bookmark", sourceUrl: "https://a.com" });
  await save(other.cookie, { type: "note", noteText: "a thought", sourceUrl: undefined });
  const ov = (await (await request("/admin/overview", "GET", undefined, admin.cookie)).json()) as any;
  expect(ov.totalUsers).toBe(2);
  expect(ov.totalSaves).toBe(2);
  expect(ov.newUsers7).toBe(2);
  const us = (await (await request("/admin/usage", "GET", undefined, admin.cookie)).json()) as any;
  const types = Object.fromEntries(us.savesByType.map((x: any) => [x.type, x.n]));
  expect(types.bookmark).toBe(1);
  expect(types.note).toBe(1);
});

test("users list and per-user deep dive", async () => {
  const admin = await register();
  process.env.FOUNDKEEP_ADMIN_EMAILS = admin.account.email;
  const other = await register();
  await save(other.cookie, { type: "bookmark", sourceUrl: "https://b.com" });
  await save(other.cookie, { type: "bookmark", sourceUrl: "https://c.com" });
  const list = (await (await request("/admin/users", "GET", undefined, admin.cookie)).json()) as any;
  const row = list.users.find((u: any) => u.id === other.account.id);
  expect(row.saves).toBe(2);
  expect(row.email).toBe(other.account.email);
  const detail = (await (await request(`/admin/users/${other.account.id}`, "GET", undefined, admin.cookie)).json()) as any;
  expect(detail.saves).toBe(2);
  expect(detail.savesByType.find((t: any) => t.type === "bookmark").n).toBe(2);
  expect(detail.user.email).toBe(other.account.email);
});

test("support intake, admin triage, and access control", async () => {
  const admin = await register();
  process.env.FOUNDKEEP_ADMIN_EMAILS = admin.account.email;
  const user = await register();
  const created = await request("/support", "POST", { kind: "bug", subject: "It broke", body: "The app crashed on save" }, user.cookie);
  expect(created.status).toBe(201);
  const ticketId = ((await created.json()) as any).ticket.id;

  const mine = (await (await request("/support/mine", "GET", undefined, user.cookie)).json()) as any;
  expect(mine.tickets.some((t: any) => t.id === ticketId)).toBe(true);

  // Non-admin cannot triage.
  expect((await request("/admin/support", "GET", undefined, user.cookie)).status).toBe(403);

  const listed = (await (await request("/admin/support", "GET", undefined, admin.cookie)).json()) as any;
  expect(listed.tickets.some((t: any) => t.id === ticketId && t.kind === "bug" && t.status === "open")).toBe(true);

  const updated = await request(`/admin/support/${ticketId}`, "POST", { status: "in_progress", note: "Investigating" }, admin.cookie);
  expect(updated.status).toBe(200);
  const uj = (await updated.json()) as any;
  expect(uj.ticket.status).toBe("in_progress");
  expect(uj.notes.length).toBe(1);
  expect(uj.notes[0].body).toBe("Investigating");

  // Invalid status rejected.
  expect((await request(`/admin/support/${ticketId}`, "POST", { status: "nope" }, admin.cookie)).status).toBe(400);
});

test("monitoring and cost endpoints return shapes", async () => {
  const admin = await register();
  process.env.FOUNDKEEP_ADMIN_EMAILS = admin.account.email;
  const mon = (await (await request("/admin/monitoring", "GET", undefined, admin.cookie)).json()) as any;
  expect(mon.services.backend).toBe("up");
  expect(typeof mon.dbBytes).toBe("number");
  expect(mon).toHaveProperty("queueDepth");
  expect(Array.isArray(mon.processingByStatus)).toBe(true);
  const cost = (await (await request("/admin/cost", "GET", undefined, admin.cookie)).json()) as any;
  expect(cost.assumptions.aiCentsPerCredit).toBeGreaterThan(0);
  expect(cost).toHaveProperty("estTotalMonthlyUsd");
  expect(cost).toHaveProperty("estNetMonthlyUsd");
});

test("server-to-server admin token grants access without a session", async () => {
  const TOKEN = "test-admin-token-abcdefghijklmnopqrstuvwx";
  process.env.FOUNDKEEP_ADMIN_API_TOKEN = TOKEN;
  const ok = await app.request(config.customerOrigin + "/api/admin/overview", { method: "GET", headers: { Origin: config.customerOrigin, "x-admin-token": TOKEN } });
  expect(ok.status).toBe(200);
  const bad = await app.request(config.customerOrigin + "/api/admin/overview", { method: "GET", headers: { Origin: config.customerOrigin, "x-admin-token": "wrong" } });
  expect(bad.status).toBe(401);
  delete process.env.FOUNDKEEP_ADMIN_API_TOKEN;
});
