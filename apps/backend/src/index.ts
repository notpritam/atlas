import { createApp } from "./app.ts";
import { config } from "./config.ts";
import { openDb } from "./db.ts";

const db = openDb();
const app = createApp(db);

const server = Bun.serve({
  port: config.port,
  idleTimeout: 60,
  fetch: app.fetch,
});

console.log(`atlas backend listening on http://localhost:${server.port}`);
console.log(`  data dir: ${config.dataDir}`);
