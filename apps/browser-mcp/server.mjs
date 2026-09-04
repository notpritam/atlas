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
import { WebSocketServer } from "ws";
import { z } from "zod";
import { randomUUID } from "node:crypto";

const BRIDGE_PORT = Number(process.env.ATLAS_BRIDGE_PORT ?? 8792);
const CMD_TIMEOUT = Number(process.env.ATLAS_CMD_TIMEOUT_MS ?? 20000);

// ---- WebSocket bridge to the extension ------------------------------------
let socket = null; // the (single) connected extension
let lastStatus = { controllable: false, url: null, title: null };
const pending = new Map(); // id -> { resolve, reject, timer }

const wss = new WebSocketServer({ host: "127.0.0.1", port: BRIDGE_PORT });
wss.on("connection", (ws) => {
  socket = ws;
  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(String(buf)); } catch { return; }
    if (msg.type === "status") { lastStatus = { controllable: !!msg.controllable, url: msg.url ?? null, title: msg.title ?? null }; return; }
    if (msg.type === "result" && msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new Error(msg.error || "command failed"));
    }
  });
  ws.on("close", () => { if (socket === ws) { socket = null; lastStatus = { controllable: false, url: null, title: null }; } });
});
wss.on("error", (e) => console.error("[atlas-browser-mcp] bridge error:", e.message));

function send(action, params = {}) {
  return new Promise((resolve, reject) => {
    if (!socket || socket.readyState !== socket.OPEN) {
      return reject(new Error("The Atlas extension isn't connected. Install/enable it and make sure this bridge is running."));
    }
    const id = randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out after ${CMD_TIMEOUT}ms waiting for the page.`)); }, CMD_TIMEOUT);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ type: "cmd", id, action, params }));
  });
}

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
    socket
      ? (lastStatus.controllable
          ? `Connected. Controlling: ${lastStatus.title ?? ""} — ${lastStatus.url ?? ""}`
          : "Extension connected, but no tab is under agent control yet. Click the floating “Agent” button on the page you want me to drive.")
      : "The Atlas extension isn't connected to the bridge.",
  ),
);

server.tool(
  "browser_snapshot",
  "Get a structured snapshot of the current page: the visible text plus a list of interactable elements each with a stable [ref] you pass to browser_click / browser_type / browser_select. Use this to see the page and decide what to do — cheaper and more reliable than a screenshot for acting.",
  {},
  async () => ok(asText(await act("snapshot"))),
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
console.error(`[atlas-browser-mcp] bridge on ws://127.0.0.1:${BRIDGE_PORT} — waiting for the extension; skills at ${STORE_PATH}`);
await server.connect(new StdioServerTransport());
