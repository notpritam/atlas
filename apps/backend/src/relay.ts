// Hosted browser-control relay. The extension (role=browser) and the agent's
// atlas-browser MCP (role=agent) both connect over WSS and are grouped into a
// per-account "room" by their invite token. The hub routes an agent's command
// to that account's browser and the browser's result back to the originating
// agent, and fans out status/context/activity to the account's agents. It never
// executes anything — pure, tenant-isolated message routing.
//
// Auth is first-message: a fresh socket must send {type:"hello", role, token}
// within authTimeoutMs, else it's closed. The token maps to a `devices` row that
// carries the `relay` scope; accountId = that device id. Keeps tokens out of URLs.
import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { sha256hex } from "./ids.ts";

export type Role = "browser" | "agent";

export interface ConnData {
  authed: boolean;
  accountId?: string;
  role?: Role;
  name?: string;
}

/** Minimal socket surface (Bun's ServerWebSocket satisfies it; tests fake it). */
export interface Sock {
  data: ConnData;
  send(s: string): unknown;
  close(code?: number, reason?: string): void;
}

interface Room {
  browsers: Set<Sock>;
  agents: Set<Sock>;
  routeMap: Map<string, { agent: Sock; origId: string }>;
  lastStatus: { controllable: boolean; url: string | null; title: string | null; cdp: boolean };
  latestContext: unknown | null;
}

export interface RelayTokenInfo { accountId: string; name: string; }

const freshStatus = () => ({ controllable: false, url: null, title: null, cdp: false });

/** Validate a relay token → its account, or null. Only a `relay`-scoped, live device passes. */
export function resolveRelayToken(db: Database, token: string): RelayTokenInfo | null {
  if (!token) return null;
  const row = db
    .query("SELECT id, name, scopes, revoked_at FROM devices WHERE token_sha256 = ?")
    .get(sha256hex(token)) as
    | { id: string; name: string; scopes: string; revoked_at: number | null }
    | undefined;
  if (!row || row.revoked_at) return null;
  let scopes: string[]; try { scopes = JSON.parse(row.scopes) as string[]; } catch { scopes = []; }
  if (!scopes.includes("relay")) return null;
  db.query("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(Date.now(), row.id);
  return { accountId: row.id, name: row.name };
}

export class RelayHub {
  private rooms = new Map<string, Room>();
  constructor(private db: Database, private authTimeoutMs = 5000) {}

  private room(accountId: string): Room {
    let r = this.rooms.get(accountId);
    if (!r) {
      r = { browsers: new Set(), agents: new Set(), routeMap: new Map(), lastStatus: freshStatus(), latestContext: null };
      this.rooms.set(accountId, r);
    }
    return r;
  }

  onOpen(ws: Sock): void {
    ws.data = { authed: false };
    setTimeout(() => { if (!ws.data.authed) { try { ws.close(4001, "auth timeout"); } catch { /* noop */ } } }, this.authTimeoutMs);
  }

  onMessage(ws: Sock, raw: string): void {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw); } catch { return; }

    if (!ws.data.authed) {
      if (msg.type !== "hello") { try { ws.close(4001, "expected hello"); } catch { /* noop */ } return; }
      const role: Role = msg.role === "agent" ? "agent" : "browser";
      const info = resolveRelayToken(this.db, String(msg.token ?? ""));
      if (!info) { try { ws.close(4003, "invalid token"); } catch { /* noop */ } return; }
      ws.data = { authed: true, accountId: info.accountId, role, name: info.name };
      const r = this.room(info.accountId);
      (role === "agent" ? r.agents : r.browsers).add(ws);
      if (role === "agent") {
        try { ws.send(JSON.stringify({ type: "status", ...r.lastStatus })); if (r.latestContext) ws.send(JSON.stringify({ type: "context", ctx: r.latestContext })); } catch { /* noop */ }
      }
      return;
    }

    if (msg.type === "ping") { try { ws.send(JSON.stringify({ type: "pong" })); } catch { /* noop */ } return; }
    const r = this.room(ws.data.accountId!);
    if (ws.data.role === "browser") this.fromBrowser(r, msg, raw);
    else this.fromAgent(r, ws, msg);
  }

  onClose(ws: Sock): void {
    if (!ws.data.authed || !ws.data.accountId) return;
    const r = this.rooms.get(ws.data.accountId);
    if (!r) return;
    r.browsers.delete(ws);
    r.agents.delete(ws);
    for (const [k, v] of r.routeMap) if (v.agent === ws) r.routeMap.delete(k);
    if (ws.data.role === "browser" && r.browsers.size === 0) { r.lastStatus = freshStatus(); this.toAgents(r, JSON.stringify({ type: "status", ...r.lastStatus })); }
    if (r.browsers.size === 0 && r.agents.size === 0) this.rooms.delete(ws.data.accountId);
  }

  private fromBrowser(r: Room, msg: Record<string, unknown>, raw: string): void {
    if (msg.type === "result") {
      const e = r.routeMap.get(String(msg.id));
      if (!e) return;
      r.routeMap.delete(String(msg.id));
      try { e.agent.send(JSON.stringify({ type: "result", id: e.origId, ok: msg.ok, data: msg.data, error: msg.error })); } catch { /* noop */ }
      return;
    }
    if (msg.type === "status") r.lastStatus = { controllable: !!msg.controllable, url: (msg.url as string) ?? null, title: (msg.title as string) ?? null, cdp: !!msg.cdp };
    else if (msg.type === "context") r.latestContext = { ...(msg.ctx as object || {}), at: Date.now() };
    this.toAgents(r, raw); // status / context / activity → the account's agents
  }

  private fromAgent(r: Room, ws: Sock, msg: Record<string, unknown>): void {
    if (msg.type !== "cmd") return;
    const browser = firstOf(r.browsers);
    if (!browser) { try { ws.send(JSON.stringify({ type: "result", id: msg.id, ok: false, error: "No browser is connected for this account. Open the Atlas extension and enable Agent on a tab." })); } catch { /* noop */ } return; }
    const internalId = randomUUID();
    r.routeMap.set(internalId, { agent: ws, origId: String(msg.id) });
    try { browser.send(JSON.stringify({ type: "cmd", id: internalId, action: msg.action, params: msg.params })); } catch { r.routeMap.delete(internalId); }
  }

  private toAgents(r: Room, raw: string): void { for (const a of r.agents) { try { a.send(raw); } catch { /* noop */ } } }

  /** For tests/inspection. */
  roomCount(): number { return this.rooms.size; }
}

function firstOf<T>(s: Set<T>): T | undefined { for (const x of s) return x; return undefined; }
