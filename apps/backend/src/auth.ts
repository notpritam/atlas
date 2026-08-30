import type { Database } from "bun:sqlite";
import type { MiddlewareHandler } from "hono";
import type { Scope } from "@atlas/shared";
import { sha256hex } from "./ids.ts";

export interface Device {
  id: string;
  name: string;
  scopes: Scope[];
}

/** Hono env: `c.get("device")` is populated by `authMiddleware`. */
export type Env = { Variables: { device: Device } };

interface DeviceRow {
  id: string;
  name: string;
  scopes: string;
  revoked_at: number | null;
}

/**
 * Validate the Bearer token (or `?token=`), attach the device, refresh
 * `last_seen_at`. 401 if missing/invalid/revoked.
 */
export function authMiddleware(db: Database): MiddlewareHandler<Env> {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.toLowerCase().startsWith("bearer ")
      ? header.slice(7).trim()
      : (c.req.query("token") ?? "");
    if (!token) return c.json({ error: "missing_token" }, 401);

    const row = db
      .query("SELECT id, name, scopes, revoked_at FROM devices WHERE token_sha256 = ?")
      .get(sha256hex(token)) as DeviceRow | undefined;
    if (!row || row.revoked_at) return c.json({ error: "invalid_token" }, 401);

    db.query("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(
      Date.now(),
      row.id,
    );
    c.set("device", {
      id: row.id,
      name: row.name,
      scopes: JSON.parse(row.scopes) as Scope[],
    });
    await next();
  };
}

/** Gate a route on a scope the token must carry. */
export function requireScope(scope: Scope): MiddlewareHandler<Env> {
  return async (c, next) => {
    const device = c.get("device");
    if (!device?.scopes.includes(scope)) {
      return c.json({ error: "forbidden", need: scope }, 403);
    }
    await next();
  };
}
