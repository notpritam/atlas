import { join } from "node:path";

function customerOrigins() {
  const configured =
    process.env.ATLAS_CUSTOMER_ORIGINS ??
    process.env.ATLAS_CUSTOMER_ORIGIN ??
    "https://foundkeep.app,https://atlas.notpritam.in";
  const origins = [...new Set(configured.split(",").map((value) => value.trim()).filter(Boolean))];
  if (!origins.length) throw new Error("At least one customer website origin is required.");
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`Invalid customer website origin: ${origin}`);
    }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin)
      throw new Error(`Customer website origins must be exact HTTP(S) origins: ${origin}`);
  }
  return origins;
}

const configuredCustomerOrigins = customerOrigins();

function customerExtensionIds() {
  // An explicit environment allowlist replaces the production defaults. Adding
  // the defaults here would let production extensions claim dev credentials.
  const value = process.env.ATLAS_CUSTOMER_EXTENSION_IDS;
  if (value === undefined) return ['cficnecbdbiddngllpfbacabgbcjinmk', 'mjfcgmboaijfcaanepdipbgmipnccnpn'];
  const ids = [...new Set(value.split(',').map(id => id.trim()).filter(Boolean))];
  if (!ids.length || ids.some(id => !/^[a-p]{32}$/.test(id))) throw new Error('ATLAS_CUSTOMER_EXTENSION_IDS must contain valid extension IDs.');
  return ids;
}

/** Runtime configuration, all overridable via env for the systemd unit on omni. */
export const config = {
  port: Number(process.env.ATLAS_PORT ?? 8787),
  /** Service version, surfaced by the public /healthz probe. */
  version: process.env.ATLAS_VERSION ?? "1.0.0",
  /** Ordered exact origins used for customer cookie/CSRF checks and extension pairing. */
  customerOrigins: configuredCustomerOrigins,
  /** Primary origin retained as a compatibility accessor for URLs and secure-cookie mode. */
  customerOrigin: configuredCustomerOrigins[0]!,
  customerExtensionIds: customerExtensionIds(),
  /** Reverse proxy owns public TLS; bind the backend to loopback by default. */
  hostname: process.env.ATLAS_HOST ?? "127.0.0.1",
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
