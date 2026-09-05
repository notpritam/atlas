import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.ATLAS_DATA_DIR = mkdtempSync(join(tmpdir(), "atlas-relay-test-"));

const { openDb } = await import("../src/db.ts");
const { mintDevice } = await import("../src/devices.ts");
const { RelayHub, resolveRelayToken } = await import("../src/relay.ts");

const db = openDb();
const acctA = mintDevice(db, { name: "acct-a", kind: "relay", scopes: ["relay"] });
const acctB = mintDevice(db, { name: "acct-b", kind: "relay", scopes: ["relay"] });
const notRelay = mintDevice(db, { name: "reader", kind: "test", scopes: ["read"] }).token;

class FakeSock {
  data: { authed: boolean; accountId?: string; role?: string; name?: string } = { authed: false };
  sent: any[] = [];
  closed: { code?: number; reason?: string } | null = null;
  send(s: string) { this.sent.push(JSON.parse(s)); }
  close(code?: number, reason?: string) { this.closed = { code, reason }; }
  last() { return this.sent[this.sent.length - 1]; }
}
const hello = (role: string, token: string) => JSON.stringify({ type: "hello", role, token });
// hub with a huge auth timeout so its onOpen timer never fires during the test
const hub = () => new RelayHub(db, 1_000_000);

test("resolveRelayToken: only a live relay-scoped token passes", () => {
  expect(resolveRelayToken(db, acctA.token)?.accountId).toBe(acctA.id);
  expect(resolveRelayToken(db, notRelay)).toBeNull();
  expect(resolveRelayToken(db, "garbage")).toBeNull();
  expect(resolveRelayToken(db, "")).toBeNull();
});

test("auth: bad first frame or bad token closes the socket", () => {
  const h = hub();
  const s1 = new FakeSock(); s1.data = { authed: false };
  h.onMessage(s1 as any, JSON.stringify({ type: "cmd", action: "snapshot" })); // not a hello
  expect(s1.closed).not.toBeNull();

  const s2 = new FakeSock(); s2.data = { authed: false };
  h.onMessage(s2 as any, hello("agent", notRelay)); // valid token, wrong scope
  expect(s2.closed?.code).toBe(4003);
});

test("round-trip: agent cmd → browser, browser result → same agent", () => {
  const h = hub();
  const browser = new FakeSock(); browser.data = { authed: false };
  const agent = new FakeSock(); agent.data = { authed: false };
  h.onMessage(browser as any, hello("browser", acctA.token));
  h.onMessage(agent as any, hello("agent", acctA.token));
  expect(browser.data.authed).toBe(true);
  expect(agent.data.authed).toBe(true);

  h.onMessage(agent as any, JSON.stringify({ type: "cmd", id: "orig1", action: "snapshot", params: {} }));
  const fwd = browser.last();
  expect(fwd.type).toBe("cmd");
  expect(fwd.action).toBe("snapshot");
  expect(fwd.id).not.toBe("orig1"); // internal id

  h.onMessage(browser as any, JSON.stringify({ type: "result", id: fwd.id, ok: true, data: { url: "x" } }));
  const res = agent.last();
  expect(res.type).toBe("result");
  expect(res.id).toBe("orig1"); // mapped back
  expect(res.ok).toBe(true);
  expect(res.data.url).toBe("x");
});

test("status fans out to the account's agents", () => {
  const h = hub();
  const browser = new FakeSock(); browser.data = { authed: false };
  const agent = new FakeSock(); agent.data = { authed: false };
  h.onMessage(browser as any, hello("browser", acctA.token));
  h.onMessage(agent as any, hello("agent", acctA.token));
  h.onMessage(browser as any, JSON.stringify({ type: "status", controllable: true, url: "u", title: "t", cdp: true }));
  const st = agent.sent.find((m) => m.type === "status" && m.controllable);
  expect(st?.url).toBe("u");
  expect(st?.cdp).toBe(true);
});

test("isolation: an agent never reaches another account's browser", () => {
  const h = hub();
  const browserB = new FakeSock(); browserB.data = { authed: false };
  const agentA = new FakeSock(); agentA.data = { authed: false };
  h.onMessage(browserB as any, hello("browser", acctB.token));
  h.onMessage(agentA as any, hello("agent", acctA.token));
  // agent A has no browser in its room → cmd is refused, and B's browser sees nothing
  h.onMessage(agentA as any, JSON.stringify({ type: "cmd", id: "z", action: "snapshot", params: {} }));
  expect(agentA.last().type).toBe("result");
  expect(agentA.last().ok).toBe(false);
  expect(browserB.sent.length).toBe(0);
});
