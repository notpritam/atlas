import { join } from "node:path";

/** Runtime configuration, all overridable via env for the systemd unit on omni. */
export const config = {
  port: Number(process.env.ATLAS_PORT ?? 8787),
  /** Where the SQLite db + blobs live. Defaults to apps/backend/data. */
  dataDir:
    process.env.ATLAS_DATA_DIR ??
    join(new URL("..", import.meta.url).pathname, "data"),
  /** Static landing site served for non-API paths. Defaults to apps/web, so the
   *  backend serves atlas.notpritam.in regardless of how caddy is configured. */
  webDir:
    process.env.ATLAS_WEB_DIR ??
    new URL("../../web", import.meta.url).pathname,
  /** Guards the HTTP device-admin routes. Empty => those routes are disabled
   *  (mint tokens with the `atlas devices add` CLI instead). */
  adminToken: process.env.ATLAS_ADMIN_TOKEN ?? "",
  /** Extra web origins allowed via CORS (the future website). chrome-extension
   *  origins are always allowed. Comma-separated. */
  allowedOrigins: (process.env.ATLAS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

/** How long a `processing` lease can be held before the queue reclaims it. */
export const LEASE_STALE_MS = 10 * 60 * 1000;
/** Max enrichment attempts before a capture is left `failed` for good. */
export const MAX_ENRICH_ATTEMPTS = 4;
/** A `failed` capture becomes claimable again after this cool-off. */
export const RETRY_BACKOFF_MS = 30 * 1000;
