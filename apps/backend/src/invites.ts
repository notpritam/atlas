// Self-serve onboarding. An admin mints an invite code (N uses, a set of
// scopes); a new user redeems it to receive a fresh device token — no CLI, no
// account approval loop. Only code/token hashes are stored.
import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import type { Scope } from "@atlas/shared";
import { config } from "./config.ts";
import { mintDevice } from "./devices.ts";
import { randomToken, sha256hex, ulid } from "./ids.ts";

export interface InviteInput { scopes: Scope[]; uses: number; note?: string }

/** Create an invite code; the plaintext is returned ONCE (only its hash is stored). */
export function mintInvite(db: Database, input: InviteInput): { id: string; code: string } {
  const code = randomToken().slice(0, 24); // short, shareable
  const id = ulid("inv");
  db.query(
    `INSERT INTO invite_codes (id, code_sha256, scopes, uses_left, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, sha256hex(code), JSON.stringify(input.scopes), Math.max(1, input.uses | 0), input.note ?? null, Date.now());
  return { id, code };
}

export interface RedeemResult { token: string; scopes: Scope[]; accountId: string }

/** Redeem a code → a new device token, atomically decrementing a use. Null if invalid/spent. */
export function redeemInvite(db: Database, code: string, name?: string): RedeemResult | null {
  const row = db
    .query("SELECT id, scopes, uses_left, revoked_at FROM invite_codes WHERE code_sha256 = ?")
    .get(sha256hex(String(code || "").trim())) as
    | { id: string; scopes: string; uses_left: number; revoked_at: number | null }
    | undefined;
  if (!row || row.revoked_at || row.uses_left <= 0) return null;

  const scopes = JSON.parse(row.scopes) as Scope[];
  const redeem = db.transaction(() => {
    const dec = db
      .query("UPDATE invite_codes SET uses_left = uses_left - 1, redeemed_count = redeemed_count + 1 WHERE id = ? AND uses_left > 0 AND revoked_at IS NULL")
      .run(row.id);
    if (dec.changes === 0) return null; // raced to zero
    const { id, token } = mintDevice(db, { name: name?.trim() || "invited", kind: "invite", scopes });
    return { token, scopes, accountId: id } as RedeemResult;
  });
  return redeem();
}

export function listInvites(db: Database) {
  return db
    .query("SELECT id, scopes, uses_left, redeemed_count, note, created_at, revoked_at FROM invite_codes ORDER BY created_at DESC")
    .all() as { id: string; scopes: string; uses_left: number; redeemed_count: number; note: string | null; created_at: number; revoked_at: number | null }[];
}

/**
 * Routes:
 *   POST /invite/redeem            (PUBLIC)  { code, name? } → { token, scopes }
 *   POST /invite/admin  add/list             admin-guarded (x-atlas-admin)
 */
export function inviteRoutes(db: Database): Hono {
  const app = new Hono();

  app.post("/redeem", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { code?: string; name?: string };
    const res = redeemInvite(db, body.code ?? "", body.name);
    if (!res) return c.json({ error: "invalid_or_spent_code" }, 400);
    return c.json({ token: res.token, scopes: res.scopes, relay: "wss://atlas.notpritam.in/agent" }, 201);
  });

  const admin = new Hono();
  admin.use("*", async (c, next) => {
    if (!config.adminToken) return c.json({ error: "admin_disabled" }, 403);
    if (c.req.header("x-atlas-admin") !== config.adminToken) return c.json({ error: "forbidden" }, 403);
    await next();
  });
  admin.post("/", async (c) => {
    const b = (await c.req.json()) as InviteInput;
    return c.json(mintInvite(db, b), 201);
  });
  admin.get("/", (c) => c.json({ invites: listInvites(db) }));
  app.route("/admin", admin);

  return app;
}
