#!/usr/bin/env node
// Atlas Browser MCP — lets your agent drive the page open in your browser.
//
// Two faces:
//   • stdio MCP server  → your agent (bb / Claude Code) calls browser_* tools.
//   • WebSocket server on 127.0.0.1:<BRIDGE_PORT> → the Atlas extension connects
//     and executes those commands on the tab you've granted control to.
//
// A tool call becomes a {id, action, params} message to the extension; the
// extension replies {id, ok, data|error}. If no tab is under agent control the
// tool returns a clear "enable Agent on the page" error.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { randomUUID } from "node:crypto";

const BRIDGE_PORT = Number(process.env.ATLAS_BRIDGE_PORT ?? 8792);
const CMD_TIMEOUT = Number(process.env.ATLAS_CMD_TIMEOUT_MS ?? 20000);
// Hosted relay mode: point the agent at the shared Atlas backend instead of a
// local bridge. When both are set, we connect out to the relay as an "agent"
// (the extension connects to the same relay as a "browser" with the SAME token).
const RELAY_URL = process.env.ATLAS_RELAY_URL || "";   // e.g. wss://atlas.notpritam.in/agent
const RELAY_TOKEN = process.env.ATLAS_TOKEN || "";     // account relay token

// ---- shared bridge: the first process to grab the port OWNS the ws server
// (the extension + any number of agent MCPs connect to it); every later MCP
// process ATTACHES as a client. So multiple agents can drive without port
// conflicts or a separate always-on service, and if the owner dies a surviving
// client takes over. Live page context + user/agent activity stream in too.
let role = null;                 // "owner" | "client"
let browserSocket = null;        // owner: the extension ws
const agentClients = new Set();  // owner: attached agent-MCP client sockets
let clientWs = null;             // client: ws to the owner
let lastStatus = { controllable: false, url: null, title: null, cdp: false };
let latestContext = null;        // { url, title, elements, text, at } — streamed
const activityLog = [];          // [{ actor:"user"|"agent", type, detail, url, at }]
const pending = new Map();       // id -> { resolve, reject, timer } (this proc's own calls)
const routeMap = new Map();      // owner: internalId -> { agentWs, origId } (forwarded)

function pushActivity(ev) { if (!ev) return; activityLog.push(ev); if (activityLog.length > 300) activityLog.splice(0, activityLog.length - 300); }
function applyIncoming(msg) {
  if (msg.type === "status") lastStatus = { controllable: !!msg.controllable, url: msg.url ?? null, title: msg.title ?? null, cdp: !!msg.cdp };
  else if (msg.type === "context") latestContext = { ...(msg.ctx || {}), at: Date.now() };
  else if (msg.type === "activity") pushActivity(msg.ev);
}
function resolvePending(msg) {
  if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer); if (msg.ok) p.resolve(msg.data); else p.reject(new Error(msg.error || "command failed")); return true; }
  return false;
}
function extConnected() { return role === "owner" ? !!(browserSocket && browserSocket.readyState === 1) : !!(clientWs && clientWs.readyState === 1); }
function recentActivityLine() {
  const u = activityLog.filter((e) => e.actor === "user").slice(-3);
  return u.length ? `\nRecent user activity (they can use the page alongside you): ${u.map((e) => `${e.type}${e.detail ? " (" + e.detail + ")" : ""}`).join(", ")}` : "";
}

function send(action, params = {}) {
  return new Promise((resolve, reject) => {
    if (role === "owner" && (!browserSocket || browserSocket.readyState !== 1))
      return reject(new Error("The Atlas extension isn't connected. Install/enable it and make sure this bridge is running."));
    if (role === "client" && (!clientWs || clientWs.readyState !== 1))
      return reject(new Error("The Atlas bridge isn't reachable yet — reconnecting. Try again in a moment."));
    const id = randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out after ${CMD_TIMEOUT}ms waiting for the page.`)); }, CMD_TIMEOUT);
    pending.set(id, { resolve, reject, timer });
    const obj = JSON.stringify({ type: "cmd", id, action, params });
    try { (role === "owner" ? browserSocket : clientWs).send(obj); }
    catch (e) { pending.delete(id); clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))); }
  });
}

// ---- owner: run the ws server for the extension + agent-client MCPs ---------
function becomeOwner(wss) {
  role = "owner";
  console.error(`[atlas-browser-mcp] bridge OWNER on ws://127.0.0.1:${BRIDGE_PORT}`);
  wss.on("connection", (ws) => {
    ws._role = null;
    ws.on("message", (buf) => {
      let msg; try { msg = JSON.parse(String(buf)); } catch { return; }
      if (!ws._role) {
        if (msg.type === "hello") {
          ws._role = msg.role === "agent" ? "agent" : "browser";
          if (ws._role === "agent") { agentClients.add(ws); try { ws.send(JSON.stringify({ type: "status", ...lastStatus })); if (latestContext) ws.send(JSON.stringify({ type: "context", ctx: latestContext })); } catch { /* noop */ } }
          else browserSocket = ws;
          return;
        }
        ws._role = msg.type === "cmd" ? "agent" : "browser";
        if (ws._role === "agent") agentClients.add(ws); else browserSocket = ws;
      }
      if (ws._role === "browser") {
        if (msg.type === "result") {
          if (!resolvePending(msg) && msg.id && routeMap.has(msg.id)) { const { agentWs, origId } = routeMap.get(msg.id); routeMap.delete(msg.id); try { agentWs.send(JSON.stringify({ type: "result", id: origId, ok: msg.ok, data: msg.data, error: msg.error })); } catch { /* noop */ } }
          return;
        }
        applyIncoming(msg);
        for (const a of agentClients) { try { a.send(String(buf)); } catch { /* noop */ } } // fan out status/context/activity
        return;
      }
      // agent client → route a command to the extension
      if (msg.type === "cmd") {
        if (!browserSocket || browserSocket.readyState !== 1) { try { ws.send(JSON.stringify({ type: "result", id: msg.id, ok: false, error: "The Atlas extension isn't connected." })); } catch { /* noop */ } return; }
        const internalId = randomUUID(); routeMap.set(internalId, { agentWs: ws, origId: msg.id });
        try { browserSocket.send(JSON.stringify({ type: "cmd", id: internalId, action: msg.action, params: msg.params })); } catch { routeMap.delete(internalId); }
      }
    });
    ws.on("close", () => { if (ws === browserSocket) { browserSocket = null; lastStatus = { controllable: false, url: null, title: null, cdp: false }; } agentClients.delete(ws); });
  });
  wss.on("error", (e) => console.error("[atlas-browser-mcp] bridge error:", e.message));
}

// ---- client: attach to an existing owner -----------------------------------
let clientBackoff = 500;
function connectClient() {
  role = "client";
  try { clientWs = new WebSocket(`ws://127.0.0.1:${BRIDGE_PORT}`); } catch { return setTimeout(() => tryStart(true), clientBackoff); }
  clientWs.on("open", () => { clientBackoff = 500; try { clientWs.send(JSON.stringify({ type: "hello", role: "agent" })); } catch { /* noop */ } });
  clientWs.on("message", (buf) => { let msg; try { msg = JSON.parse(String(buf)); } catch { return; } if (msg.type === "result") { resolvePending(msg); return; } applyIncoming(msg); });
  clientWs.on("close", () => { clientWs = null; setTimeout(() => tryStart(true), clientBackoff); }); // owner may have died — try to take over
  clientWs.on("error", () => { try { clientWs.close(); } catch { /* noop */ } });
}

// ---- hosted relay: connect out to the Atlas backend as an agent ------------
let relayBackoff = 500;
function connectRelay() {
  role = "client";
  try { clientWs = new WebSocket(RELAY_URL); } catch { return setTimeout(connectRelay, relayBackoff); }
  clientWs.on("open", () => { relayBackoff = 500; try { clientWs.send(JSON.stringify({ type: "hello", role: "agent", token: RELAY_TOKEN })); } catch { /* noop */ } });
  clientWs.on("message", (buf) => { let m; try { m = JSON.parse(String(buf)); } catch { return; } if (m.type === "result") { resolvePending(m); return; } applyIncoming(m); });
  clientWs.on("close", () => { clientWs = null; relayBackoff = Math.min(relayBackoff * 1.5, 8000); setTimeout(connectRelay, relayBackoff); });
  clientWs.on("error", () => { try { clientWs.close(); } catch { /* noop */ } });
}

// ---- start: own the port if free, else attach as a client ------------------
function tryStart(fromRetry) {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: BRIDGE_PORT });
  wss.once("listening", () => becomeOwner(wss));
  wss.once("error", (e) => {
    if (e && e.code === "EADDRINUSE") { clientBackoff = Math.min((clientBackoff || 500) * 1.5, 8000); setTimeout(connectClient, fromRetry ? clientBackoff : 0); }
    else console.error("[atlas-browser-mcp] bridge bind error:", e.message);
  });
}
if (RELAY_URL && RELAY_TOKEN) { console.error(`[atlas-browser-mcp] hosted relay mode → ${RELAY_URL}`); connectRelay(); }
else tryStart(false);

const ok = (text) => ({ content: [{ type: "text", text }] });
const asText = (v) => (typeof v === "string" ? v : JSON.stringify(v, null, 2));

// ---- self-learning store: runs → versioned task playbooks ------------------
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const STORE_PATH = process.env.ATLAS_SKILLS_PATH || join(homedir(), ".atlas", "browser-skills.json");
function loadStore() {
  try { return JSON.parse(readFileSync(STORE_PATH, "utf8")); } catch { return { playbooks: [], runs: [] }; }
}
function saveStore(s) {
  try { mkdirSync(dirname(STORE_PATH), { recursive: true }); writeFileSync(STORE_PATH, JSON.stringify(s, null, 2)); } catch (e) { console.error("[atlas-browser-mcp] store save:", e.message); }
}
let store = loadStore();
let currentRun = null; // { id, goal, tags, steps[], startedAt }

const norm = (s) => String(s || "").toLowerCase();
const brief = (v) => { const t = typeof v === "string" ? v : JSON.stringify(v); return t.length > 220 ? t.slice(0, 220) + "…" : t; };
function logStep(action, params, okFlag, summary) {
  if (!currentRun) return;
  currentRun.steps.push({ n: currentRun.steps.length + 1, action, params: action === "type" ? { ...params, text: "…" } : params, ok: okFlag, summary, at: Date.now() });
}
// send + record a step (so a task run is captured for the learning loop)
async function act(action, params = {}) {
  try { const data = await send(action, params); logStep(action, params, true, brief(data)); return data; }
  catch (e) { logStep(action, params, false, String(e?.message || e)); throw e; }
}
function scoreRecipe(p, query, tags) {
  const q = norm(query);
  const qt = (tags || []).map(norm);
  let s = 0;
  for (const t of (p.tags || []).map(norm)) { if (qt.includes(t)) s += 2; if (q.includes(t)) s += 1; }
  if (q && (norm(p.title).includes(q) || norm(p.goal).includes(q))) s += 3;
  for (const w of q.split(/\W+/).filter((x) => x.length > 3)) if (norm(p.goal + " " + p.title).includes(w)) s += 0.5;
  return s;
}
function recall(query, tags, limit = 3) {
  return store.playbooks
    .map((p) => ({ p, s: scoreRecipe(p, query, tags) }))
    .filter((x) => x.s > 0.5)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.p);
}
function fmtRecipe(p) {
  return `### ${p.title}  (v${p.version} · updated ${new Date(p.updatedAt).toISOString().slice(0, 10)} · ${p.successCount || 0} successes)\n` +
    `tags: ${(p.tags || []).join(", ") || "—"}\n` +
    `goal: ${p.goal || p.title}\n` +
    `steps:\n${(p.steps || []).map((s, i) => `  ${i + 1}. ${s}`).join("\n") || "  (none)"}\n` +
    (p.learnings?.length ? `learnings (what previously bit us):\n${p.learnings.map((l) => `  - ${l}`).join("\n")}\n` : "");
}

// ---- MCP server -----------------------------------------------------------
const server = new McpServer({ name: "atlas-browser", version: "0.1.0" });

server.tool(
  "browser_status",
  "Check whether a browser tab is currently under agent control. Returns the URL/title of the controllable tab, or tells you to enable the on-page Agent button. Call this first if a command says the extension isn't connected.",
  {},
  async () => ok(
    !extConnected()
      ? "The Atlas extension isn't connected to the bridge."
      : (lastStatus.controllable
          ? `Connected${lastStatus.cdp ? " (full control — Chrome debugger attached)" : ""}. Controlling: ${lastStatus.title ?? ""} — ${lastStatus.url ?? ""}${recentActivityLine()}`
          : "Extension connected, but no tab is under agent control yet. Click the floating “Agent” button on the page you want me to drive."),
  ),
);

server.tool(
  "browser_snapshot",
  "Get a structured snapshot of the current page: the visible text plus a list of interactable elements each with a stable [ref] you pass to browser_click / browser_type / browser_select. Use this to see the page and decide what to do — cheaper and more reliable than a screenshot for acting. Returns instantly from the live stream when the page just changed.",
  {},
  async () => {
    if (latestContext && Date.now() - latestContext.at < 1200) { const { at, ...c } = latestContext; return ok(asText({ ...c, streamed: true })); }
    return ok(asText(await act("snapshot")));
  },
);

server.tool(
  "browser_recent_activity",
  "See what changed on the page recently and WHO did it — the user or the agent. Use to notice if the user touched the page while you were working (they can use the site alongside you) or to confirm your own actions landed. Attribution: actions within ~0.7s of a command are 'agent', the rest are 'user'.",
  { limit: z.number().int().optional() },
  async ({ limit }) => {
    const items = activityLog.slice(-Math.min(limit ?? 20, 100));
    if (!items.length) return ok("No tracked page activity yet.");
    return ok(items.map((e) => `${new Date(e.at).toISOString().slice(11, 19)}  [${e.actor}] ${e.type}${e.detail ? " · " + e.detail : ""}`).join("\n"));
  },
);

server.tool(
  "browser_screenshot",
  "Take a screenshot of the visible area of the controlled tab. Use when you need to SEE the page (layout, images, canvas); use browser_snapshot to ACT on it.",
  {},
  async () => {
    const data = await act("screenshot"); // { base64, mime }
    return { content: [{ type: "image", data: data.base64, mimeType: data.mime || "image/png" }] };
  },
);

server.tool(
  "browser_click",
  "Click an element by its [ref] from browser_snapshot.",
  { ref: z.number().int().describe("The element ref from browser_snapshot.") },
  async ({ ref }) => ok(asText(await act("click", { ref }))),
);

server.tool(
  "browser_type",
  "Type text into an input/textarea by its [ref]. Set submit:true to press Enter after (e.g. to submit a search).",
  {
    ref: z.number().int(),
    text: z.string(),
    submit: z.boolean().optional(),
    clear: z.boolean().optional().describe("Clear the field first (default true)."),
  },
  async ({ ref, text, submit, clear }) => ok(asText(await act("type", { ref, text, submit: !!submit, clear: clear !== false }))),
);

server.tool(
  "browser_fill_form",
  "Fill several fields at once. Each entry is { ref, value }. Use for forms — grab refs from browser_snapshot first.",
  { fields: z.array(z.object({ ref: z.number().int(), value: z.string() })) },
  async ({ fields }) => ok(asText(await act("fill", { fields }))),
);

server.tool(
  "browser_select",
  "Choose an option in a <select> by its [ref] (match by visible label or value).",
  { ref: z.number().int(), value: z.string() },
  async ({ ref, value }) => ok(asText(await act("select", { ref, value }))),
);

server.tool(
  "browser_scroll",
  "Scroll the page. direction 'down'|'up'|'top'|'bottom', or an absolute y in pixels.",
  { direction: z.enum(["down", "up", "top", "bottom"]).optional(), y: z.number().optional() },
  async ({ direction, y }) => ok(asText(await act("scroll", { direction, y }))),
);

server.tool(
  "browser_navigate",
  "Navigate the controlled tab to a URL.",
  { url: z.string().url() },
  async ({ url }) => ok(asText(await act("navigate", { url }))),
);

server.tool(
  "browser_get_text",
  "Read text from the page — the whole body, or a single element by [ref].",
  { ref: z.number().int().optional() },
  async ({ ref }) => ok(asText(await act("getText", { ref }))),
);

server.tool(
  "browser_wait",
  "Wait until a CSS selector appears (or up to timeoutMs). Use after clicks/navigations that load content.",
  { selector: z.string().optional(), timeoutMs: z.number().int().optional() },
  async ({ selector, timeoutMs }) => ok(asText(await act("waitFor", { selector, timeoutMs: timeoutMs ?? 8000 }))),
);

server.tool(
  "browser_press_key",
  "Press a key (e.g. 'Enter', 'Escape', 'Tab', 'ArrowDown') on the focused element or page.",
  { key: z.string() },
  async ({ key }) => ok(asText(await act("key", { key }))),
);

// ---- self-learning loop tools ---------------------------------------------
server.tool(
  "browser_task_start",
  "Begin a browser task. ALWAYS call this before driving the page for a real task: it (1) starts recording every step you take, and (2) returns any playbook we've built from doing this task before — an ordered recipe plus 'learnings' (what previously broke). Follow that recipe; it's fresher and more reliable than guessing. At the end call browser_task_finish and (if it worked) browser_save_playbook.",
  { goal: z.string().describe("What the user wants done, in a line (e.g. 'apply to the job on this page', 'fill the signup form')."), tags: z.array(z.string()).optional().describe("2-5 lowercase tags, e.g. site name + action ('greenhouse','job-apply').") },
  async ({ goal, tags }) => {
    currentRun = { id: randomUUID(), goal, tags: tags || [], steps: [], startedAt: Date.now() };
    const matches = recall(goal, tags);
    const head = matches.length
      ? `We've done this before — reuse this, it already accounts for past issues:\n\n${matches.map(fmtRecipe).join("\n")}`
      : "No prior playbook for this task yet — do it carefully; I'm recording every step so we can save a reusable recipe at the end.";
    return ok(`Recording task "${goal}".\n\n${head}`);
  },
);

server.tool(
  "browser_recall_task",
  "Search saved browser playbooks by query/tags without starting a run. Returns the best-matching recipes + learnings so you know how a task was done before.",
  { query: z.string(), tags: z.array(z.string()).optional() },
  async ({ query, tags }) => {
    const matches = recall(query, tags, 5);
    return ok(matches.length ? matches.map(fmtRecipe).join("\n") : "No matching playbook yet.");
  },
);

server.tool(
  "browser_save_playbook",
  "Save (or update) the reusable recipe for the current task — the self-learning step. After finishing a task, distill what actually worked into a clean ordered list of steps and any learnings (selectors that moved, dialogs to dismiss, timing waits). If a playbook for this task exists it's UPDATED and version-bumped (freshness), merging your new learnings — so stale advice gets superseded.",
  {
    title: z.string().describe("Short task title, e.g. 'Apply on Greenhouse job page'."),
    tags: z.array(z.string()).optional(),
    goal: z.string().optional(),
    steps: z.array(z.string()).describe("The distilled, ordered steps that worked (reference-independent, human-readable)."),
    learnings: z.array(z.string()).optional().describe("Gotchas future runs should know (what broke / what to watch for)."),
    success: z.boolean().optional(),
  },
  async ({ title, tags, goal, steps, learnings, success }) => {
    const now = Date.now();
    const key = norm(title);
    let p = store.playbooks.find((x) => norm(x.title) === key) ||
      store.playbooks.find((x) => scoreRecipe(x, goal || title, tags) >= 4);
    if (p) {
      p.title = title; p.goal = goal || p.goal; p.steps = steps;
      p.tags = [...new Set([...(p.tags || []), ...(tags || [])])];
      p.learnings = [...new Set([...(p.learnings || []), ...(learnings || [])])].slice(-20);
      p.version = (p.version || 1) + 1; p.updatedAt = now;
      if (success !== false) p.successCount = (p.successCount || 0) + 1;
    } else {
      p = { id: randomUUID(), title, goal: goal || title, tags: tags || [], steps, learnings: learnings || [], version: 1, createdAt: now, updatedAt: now, successCount: success === false ? 0 : 1 };
      store.playbooks.push(p);
    }
    saveStore(store);
    return ok(`Saved playbook "${p.title}" v${p.version} (${p.steps.length} steps, ${(p.learnings || []).length} learnings). Next time this task is asked, I'll start from this.`);
  },
);

server.tool(
  "browser_task_finish",
  "Close the current recorded task. Stores the raw step log. Call browser_save_playbook first (if it succeeded) to distill the reusable recipe.",
  { success: z.boolean().optional(), notes: z.string().optional() },
  async ({ success, notes }) => {
    if (!currentRun) return ok("No task is being recorded.");
    const run = { ...currentRun, finishedAt: Date.now(), success: success !== false, notes: notes || "" };
    store.runs.push(run);
    if (store.runs.length > 200) store.runs = store.runs.slice(-200);
    saveStore(store);
    const n = run.steps.length;
    currentRun = null;
    return ok(`Task recorded (${n} steps). ${success === false ? "Marked unsuccessful." : "If you haven't yet, call browser_save_playbook to bank the recipe."}`);
  },
);

// ---- go --------------------------------------------------------------------
console.error(`[atlas-browser-mcp] starting (shared bridge on 127.0.0.1:${BRIDGE_PORT}); skills at ${STORE_PATH}`);
await server.connect(new StdioServerTransport());
