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
import { customerRoutes } from "./customer.ts";

function count(db: Database, sql: string): number {
  return (db.query(sql).get() as { n: number }).n;
}

export function createApp(db: Database): Hono<Env> {
  const app = new Hono<Env>();

  const legacyCors = cors({
    origin: (origin) => {
      if (!origin) return null; // non-CORS / same-origin request — no ACAO needed
      if (origin.startsWith("chrome-extension://")) return origin;
      if (config.allowedOrigins.includes(origin)) return origin;
      return null;
    },
    allowHeaders: ["authorization", "content-type"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86400,
  });
  // Customer routes enforce their own exact website/extension origin allowlist.
  app.use("*", (c, next) => c.req.path === "/api" || c.req.path.startsWith("/api/") ? next() : legacyCors(c, next));

  // Baseline security headers on every response (safe for the API + static site).
  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", c.req.path.startsWith("/api/auth/oauth/") || c.req.path === "/auth.html" ? "no-referrer" : "strict-origin-when-cross-origin");
    c.header("X-Frame-Options", "SAMEORIGIN");
    c.header("Strict-Transport-Security", "max-age=31536000");
    if (["/customer-config.json", "/extension-policy.json", "/foundkeep-extension.zip", "/atlas-extension.zip"].includes(c.req.path) || /^\/ext\/[^/]+\.zip$/.test(c.req.path)) {
      c.header("Cache-Control", "no-store");
    }
    if (["/auth.html", "/dashboard.html", "/open.html"].includes(c.req.path)) {
      c.header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
      c.header("Cache-Control", "no-store");
    }
  });

  // Public liveness — no token — for uptime checks and status pages.
  app.get("/healthz", (c) =>
    c.json({ ok: true, service: "atlas" as const, version: config.version }),
  );

  app.get("/.well-known/apple-app-site-association", (c) => {
    const teamId = (process.env.ATLAS_APPLE_TEAM_ID || "").trim();
    if (!/^[A-Z0-9]{10}$/.test(teamId)) return c.notFound();
    c.header("Cache-Control", "public, max-age=3600");
    return c.json({
      applinks: {
        apps: [],
        details: [{
          appIDs: [`${teamId}.app.foundkeep.ios`],
          components: [{ "/": "/open", comment: "Open an allowlisted destination in Foundkeep for iPhone." }],
        }],
      },
    });
  });

  app.get("/open", (c) => {
    const raw = c.req.query("path") || "collection";
    const uuid = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";
    const path = new RegExp(`^(?:login|register|recover|collection|settings|new-note|capture/${uuid})$`).test(raw) ? raw : "collection";
    return c.redirect(`/open.html?path=${encodeURIComponent(path)}`, 302);
  });

  app.route("/api", customerRoutes(db));
  app.get("/signup", (c) => c.redirect("/auth.html?mode=signup", 302));
  app.get("/login", (c) => c.redirect("/auth.html?mode=login", 302));
  app.get("/dashboard", (c) => c.redirect("/dashboard.html", 302));

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
