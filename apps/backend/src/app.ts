import type { Database } from "bun:sqlite";
import { relative } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { config } from "./config.ts";
import { authMiddleware, type Env } from "./auth.ts";
import {
  captureRoutes,
  listCategoryFacets,
  listTagFacets,
} from "./captures.ts";
import { deviceRoutes } from "./devices.ts";
import { inviteRoutes } from "./invites.ts";
import { buildCaptureGraph } from "./graph.ts";

function count(db: Database, sql: string): number {
  return (db.query(sql).get() as { n: number }).n;
}

export function createApp(db: Database): Hono<Env> {
  const app = new Hono<Env>();

  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin) return null; // non-CORS / same-origin request — no ACAO needed
        if (origin.startsWith("chrome-extension://")) return origin;
        if (config.allowedOrigins.includes(origin)) return origin;
        return null;
      },
      allowHeaders: ["authorization", "content-type"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 86400,
    }),
  );

  // Baseline security headers on every response (safe for the API + static site).
  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("X-Frame-Options", "SAMEORIGIN");
  });

  // Public liveness — no token — for uptime checks and status pages.
  app.get("/healthz", (c) =>
    c.json({ ok: true, service: "atlas" as const, version: config.version }),
  );

  // Admin token minting — own guard, outside the Bearer group.
  app.route("/admin/devices", deviceRoutes(db));

  // Self-serve onboarding: POST /invite/redeem is public; /invite/admin is guarded.
  app.route("/invite", inviteRoutes(db));
  app.get("/redeem", (c) => c.redirect("/redeem.html", 302));

  // Everything under /v1 requires a valid device token.
  const v1 = new Hono<Env>();
  v1.use("*", authMiddleware(db));

  v1.get("/health", (c) =>
    c.json({
      ok: true,
      service: "atlas" as const,
      device: c.get("device").id,
      pending: count(
        db,
        "SELECT COUNT(*) n FROM captures WHERE status IN ('pending','processing')",
      ),
      total: count(db, "SELECT COUNT(*) n FROM captures"),
      diskBytes: count(
        db,
        "SELECT COALESCE(SUM(blob_bytes),0) n FROM captures WHERE blob_path IS NOT NULL",
      ),
    }),
  );

  v1.get("/tags", (c) => c.json({ tags: listTagFacets(db) }));
  v1.get("/categories", (c) => c.json({ categories: listCategoryFacets(db) }));
  v1.get("/graph", (c) => c.json(buildCaptureGraph(db)));

  v1.route("/captures", captureRoutes(db));

  app.route("/v1", v1);

  // Static landing site for everything that isn't the API. hono/bun's
  // serveStatic resolves `root` from cwd, so pass it relative to where the
  // service runs. Serves /, /styles.css, /assets/*, /atlas-extension.zip, etc.
  const webRoot = relative(process.cwd(), config.webDir) || ".";
  app.use("*", serveStatic({ root: webRoot }));

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  return app;
}
