import { createApp } from "./app.ts";
import { config } from "./config.ts";
import { openDb } from "./db.ts";
import { RelayHub, type ConnData, type Sock } from "./relay.ts";

const db = openDb();
const app = createApp(db);
const hub = new RelayHub(db);

const server = Bun.serve<ConnData, undefined>({
  port: config.port,
  idleTimeout: 60,
  fetch(req, srv) {
    if (new URL(req.url).pathname === "/agent") {
      // Hosted browser-control relay. Upgrade unauthenticated; the hub requires
      // a valid {type:"hello", role, token} first frame within its timeout.
      if (srv.upgrade(req, { data: { authed: false } })) return undefined;
      return new Response("expected a websocket upgrade", { status: 426 });
    }
    return app.fetch(req);
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
