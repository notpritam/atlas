import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import type { Scope } from "@atlas/shared";
import { config } from "./config.ts";
import { randomToken, sha256hex, ulid } from "./ids.ts";

export interface MintInput {
  name: string;
  kind: string; // extension | bb-worker | web
  scopes: Scope[];
}

/** Create a device and return the plaintext token ONCE (only the hash is stored). */
export function mintDevice(
  db: Database,
  input: MintInput,
): { id: string; token: string } {
  const token = randomToken();
  const id = ulid("dev");
  db.query(
    `INSERT INTO devices (id, name, kind, token_sha256, scopes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    input.kind,
    sha256hex(token),
    JSON.stringify(input.scopes),
    Date.now(),
  );
  return { id, token };
}

export interface DeviceSummary {
  id: string;
  name: string;
  kind: string;
  scopes: Scope[];
  createdAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
}

export function listDevices(db: Database): DeviceSummary[] {
  const rows = db
    .query(
      "SELECT id, name, kind, scopes, created_at, last_seen_at, revoked_at FROM devices ORDER BY created_at DESC",
    )
    .all() as {
    id: string;
    name: string;
    kind: string;
    scopes: string;
    created_at: number;
    last_seen_at: number | null;
    revoked_at: number | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    scopes: JSON.parse(r.scopes) as Scope[],
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    revokedAt: r.revoked_at,
  }));
}

export function revokeDevice(db: Database, id: string): boolean {
  return (
    db
      .query("UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(Date.now(), id).changes > 0
  );
}

/**
 * HTTP admin routes, guarded by the `x-atlas-admin` header matching
 * ATLAS_ADMIN_TOKEN. Disabled entirely when that env var is empty (bootstrap
 * with the `atlas devices` CLI instead). Mounted OUTSIDE the Bearer auth.
 */
export function deviceRoutes(db: Database): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    if (!config.adminToken) return c.json({ error: "admin_disabled" }, 403);
    if (c.req.header("x-atlas-admin") !== config.adminToken)
      return c.json({ error: "forbidden" }, 403);
    await next();
  });
  app.post("/", async (c) => {
    const body = (await c.req.json()) as MintInput;
    return c.json(mintDevice(db, body), 201);
  });
  app.get("/", (c) => c.json({ devices: listDevices(db) }));
  app.delete("/:id", (c) =>
    revokeDevice(db, c.req.param("id"))
      ? c.json({ ok: true })
      : c.json({ error: "not_found" }, 404),
  );
  return app;
}
