import {createPreservationService} from './customer-preservation.ts';
import {createProcessingService} from './customer-processing.ts';
import {pruneCustomerChanges} from './customer-changes.ts';
import { processBillingCleanup, reconcileBilling } from "./customer-billing.ts";
import { createApp } from "./app.ts";
import { config } from "./config.ts";
import { openDb } from "./db.ts";
import { RelayHub, type ConnData, type Sock } from "./relay.ts";
import { startCustomerWorker } from "./customer-enrichment.ts";
import { processAuthCleanup } from "./customer-oauth.ts";
import { createSupabaseGateway } from "./supabase-auth.ts";

const db = openDb();
const app = createApp(db);
const hub = new RelayHub(db);
const stopCustomerWorker = startCustomerWorker(db);
const managedProcessing = createProcessingService(db);
const preservation = createPreservationService(db);
const preservationTimer = setInterval(() => { void preservation.tick().catch(() => {}); }, 3000);
preservationTimer.unref();
const processingTimer = setInterval(() => { void managedProcessing.tick().catch(() => {}); }, 10_000);
processingTimer.unref();
const changesTimer = setInterval(() => pruneCustomerChanges(db), 3600_000);
changesTimer.unref();
const authGateway = createSupabaseGateway();
let cleaningAuth = false;
const cleanAuth = async () => {
  if (cleaningAuth) return;
  cleaningAuth = true;
  try { await processAuthCleanup(db, authGateway); await processBillingCleanup(db); await reconcileBilling(db); } catch { /* Durable outbox retries without logging identities or tokens. */ }
  finally { cleaningAuth = false; }
};
void cleanAuth();
const authCleanupTimer = setInterval(cleanAuth, 30_000);
authCleanupTimer.unref();

const server = Bun.serve<ConnData>({
  port: config.port,
  hostname: config.hostname,
  maxRequestBodySize: 50 * 1024 * 1024,
  idleTimeout: 60,
  fetch(req, srv) {
    if (new URL(req.url).pathname === "/agent") {
      // Hosted browser-control relay. Upgrade unauthenticated; the hub requires
      // a valid {type:"hello", role, token} first frame within its timeout.
      if (srv.upgrade(req, { data: { authed: false } })) return undefined;
      return new Response("expected a websocket upgrade", { status: 426 });
    }
    const peer = srv.requestIP(req)?.address ?? "unknown";
    // Caddy appends the client address. Trust that header only from loopback.
    const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer);
    const clientIp = loopback
      ? req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || peer
      : peer;
    return app.fetch(req, { clientIp });
  },
  websocket: {
    idleTimeout: 120,
    open(ws) { hub.onOpen(ws as unknown as Sock); },
    message(ws, message) { hub.onMessage(ws as unknown as Sock, typeof message === "string" ? message : message.toString()); },
    close(ws) { hub.onClose(ws as unknown as Sock); },
  },
});

console.log(`atlas backend listening on http://localhost:${server.port}`);
console.log(`  data dir: ${config.dataDir}`);
console.log(`  relay:    wss://<host>/agent`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopCustomerWorker();
    clearInterval(preservationTimer);
    preservation.close();
    clearInterval(processingTimer);
    clearInterval(changesTimer);
    clearInterval(authCleanupTimer);
    server.stop(true);
    process.exit(0);
  });
}
