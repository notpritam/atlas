// Background bridge for agent control. Connects to the local Atlas Browser MCP
// (ws://127.0.0.1:8792), tracks which tab you've granted control to (via the
// on-page Agent button), and routes the agent's commands to that tab.
//
// Full control: once a tab is granted, we attach the Chrome DevTools Protocol
// (chrome.debugger) to it — Chrome shows an "…is debugging this browser" banner
// — so the agent drives it with real, trusted input (CDP mouse + keyboard) and
// can screenshot it even when it isn't the frontmost tab. The content script is
// kept for page structure/reads and as a fallback when the debugger can't attach.
const PORT = Number(self.ATLAS_BRIDGE_PORT || 8792);
let ws = null;
let backoff = 1000;
let relayUrl = "";   // wss://.../agent — when set, drive this browser via the hosted relay
let relayToken = ""; // account token presented to the relay
let controllableTabId = null;
let hydrated = false;
const attached = new Set(); // tabIds we've attached the debugger to
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- persisted control (survives MV3 SW eviction + tab reloads) -------------
async function loadControlled() {
  if (!hydrated) {
    try { const s = await chrome.storage.session.get("controlledTabId"); if (typeof s.controlledTabId === "number") controllableTabId = s.controlledTabId; } catch { /* noop */ }
    hydrated = true;
  }
  return controllableTabId;
}
async function setControlled(id) {
  const prev = controllableTabId;
  controllableTabId = id; hydrated = true;
  try { if (id == null) await chrome.storage.session.remove("controlledTabId"); else await chrome.storage.session.set({ controlledTabId: id }); } catch { /* noop */ }
  if (prev != null && prev !== id) void detachDebugger(prev);
  if (id != null) void ensureAttached(id);
  void sendStatus();
}

// ---- Chrome DevTools Protocol (full, trusted control) -----------------------
function cdp(tabId, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params || {}, (res) => {
      const e = chrome.runtime.lastError;
      if (e) reject(new Error(e.message)); else resolve(res);
    });
  });
}
async function ensureAttached(tabId) {
  if (attached.has(tabId)) return true;
  try {
    await new Promise((resolve, reject) => chrome.debugger.attach({ tabId }, "1.3", () => {
      const e = chrome.runtime.lastError; if (e) reject(new Error(e.message)); else resolve();
    }));
    attached.add(tabId);
    try { await cdp(tabId, "Page.enable"); } catch { /* noop */ }
    return true;
  } catch (e) {
    // Already attached (e.g. DevTools open) counts as usable; anything else →
    // degrade to DOM mode (content-script synthetic input still works).
    if (String(e.message || e).includes("Another debugger")) { attached.add(tabId); return true; }
    return false;
  }
}
async function detachDebugger(tabId) {
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  try { await new Promise((r) => chrome.debugger.detach({ tabId }, () => { void chrome.runtime.lastError; r(); })); } catch { /* noop */ }
}
chrome.debugger.onDetach.addListener((src, reason) => {
  if (src.tabId == null) return;
  attached.delete(src.tabId);
  // User dismissed the debugging banner → release control of that tab.
  if (src.tabId === controllableTabId && reason === "canceled_by_user") void setControlled(null);
});

// Real event-driven waits: resolve navigations on the actual load event.
const loadWaiters = new Map();
chrome.debugger.onEvent.addListener((src, method) => {
  if (src.tabId != null && (method === "Page.loadEventFired" || method === "Page.frameStoppedLoading") && loadWaiters.has(src.tabId)) {
    const r = loadWaiters.get(src.tabId); loadWaiters.delete(src.tabId); r();
  }
});
function waitForLoad(tabId, timeoutMs = 9000) {
  return new Promise((resolve) => { const fin = () => { loadWaiters.delete(tabId); resolve(); }; loadWaiters.set(tabId, fin); setTimeout(fin, timeoutMs); });
}

function schedule() { backoff = Math.min(backoff * 1.5, 15000); setTimeout(connect, backoff); }

function connect() {
  const url = relayUrl || `ws://127.0.0.1:${PORT}`;
  try { ws = new WebSocket(url); }
  catch { return schedule(); }
  ws.onopen = () => {
    backoff = 1000;
    const hello = relayUrl ? { type: "hello", role: "browser", token: relayToken } : { type: "hello", role: "browser" };
    try { ws.send(JSON.stringify(hello)); } catch { /* noop */ }
    sendStatus();
  };
  ws.onclose = () => { ws = null; schedule(); };
  ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
  ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.type === "cmd") void handleCmd(m); };
}

function reply(id, ok, payload) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "result", id, ok, ...(ok ? { data: payload } : { error: payload }) }));
}

async function sendStatus() {
  await loadControlled();
  let url = null, title = null;
  if (controllableTabId != null) {
    try { const t = await chrome.tabs.get(controllableTabId); url = t.url; title = t.title; }
    catch { controllableTabId = null; try { await chrome.storage.session.remove("controlledTabId"); } catch { /* noop */ } }
  }
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "status", controllable: controllableTabId != null, url, title, cdp: controllableTabId != null && attached.has(controllableTabId) }));
}

// Ask the content script to locate a ref: scroll into view, glide the agent
// cursor there, and return the viewport-centre coords for CDP input.
async function locate(tabId, ref) {
  const res = await chrome.tabs.sendMessage(tabId, { k: "agent-cmd", action: "locate", params: { ref } }).catch((e) => ({ ok: false, error: String(e?.message || e) }));
  if (!res || !res.ok) throw new Error((res && res.error) || "Could not locate the element — call browser_snapshot again.");
  return res.data; // { x, y, name }
}
function moveCursor(tabId, x, y, opts = {}) { chrome.tabs.sendMessage(tabId, { k: "agent-cmd", action: "cursor", params: { x, y, ...opts } }).catch(() => {}); }

const KEYMAP = {
  Enter: { code: "Enter", vk: 13, text: "\r" }, Tab: { code: "Tab", vk: 9 }, Escape: { code: "Escape", vk: 27 },
  Backspace: { code: "Backspace", vk: 8 }, Delete: { code: "Delete", vk: 46 }, Home: { code: "Home", vk: 36 }, End: { code: "End", vk: 35 },
  ArrowUp: { code: "ArrowUp", vk: 38 }, ArrowDown: { code: "ArrowDown", vk: 40 }, ArrowLeft: { code: "ArrowLeft", vk: 37 }, ArrowRight: { code: "ArrowRight", vk: 39 },
};
async function cdpKey(tabId, key) {
  const m = KEYMAP[key] || { code: key.length === 1 ? "Key" + key.toUpperCase() : key, vk: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0, text: key.length === 1 ? key : undefined };
  const base = { key, code: m.code, windowsVirtualKeyCode: m.vk, nativeVirtualKeyCode: m.vk };
  await cdp(tabId, "Input.dispatchKeyEvent", { type: m.text ? "keyDown" : "rawKeyDown", ...base, text: m.text });
  await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
}
async function cdpClick(tabId, x, y) {
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}

async function handleCmd(m) {
  const { id, action, params = {} } = m;
  try {
    await loadControlled();
    if (controllableTabId == null) return reply(id, false, "No tab is under agent control. Click the floating “Agent” button on the page you want me to drive.");
    const tabId = controllableTabId;
    const useCdp = await ensureAttached(tabId);

    if (action === "screenshot") {
      if (useCdp) {
        try {
          const res = await cdp(tabId, "Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
          return reply(id, true, { base64: res.data, mime: "image/png" });
        } catch { /* fall through to visible-tab capture */ }
      }
      const t = await chrome.tabs.get(tabId);
      const dataUrl = await chrome.tabs.captureVisibleTab(t.windowId, { format: "png" });
      return reply(id, true, { base64: dataUrl.split(",")[1], mime: "image/png" });
    }

    if (action === "navigate") {
      await chrome.tabs.update(tabId, { url: params.url });
      if (useCdp) await waitForLoad(tabId); else await delay(1200);
      return reply(id, true, { navigated: params.url });
    }

    if (action === "click" && useCdp) {
      try {
        const loc = await locate(tabId, params.ref);
        moveCursor(tabId, loc.x, loc.y, { label: `clicking ${loc.name || "element"}` });
        await delay(200);              // let the agent cursor visibly arrive
        moveCursor(tabId, loc.x, loc.y, { click: true });
        await cdpClick(tabId, loc.x, loc.y);
        return reply(id, true, `clicked ${loc.name || "element"}`);
      } catch { /* fall through to DOM click */ }
    }

    if (action === "key" && useCdp) {
      try { await cdpKey(tabId, params.key); return reply(id, true, `pressed ${params.key}`); }
      catch { /* fall through to DOM key */ }
    }

    // structure/reads + fallbacks (snapshot, getText, type, fill, select, scroll, waitFor, key/click fallback) → content script
    const res = await chrome.tabs
      .sendMessage(tabId, { k: "agent-cmd", action, params })
      .catch((e) => ({ ok: false, error: String(e?.message || e) }));
    if (res && res.ok) reply(id, true, res.data);
    else reply(id, false, (res && res.error) || "The page didn't respond (is Agent still enabled on that tab?).");
  } catch (e) { reply(id, false, String(e?.message || e)); }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.k === "agent-toggle") {
    void setControlled(msg.on ? (sender.tab?.id ?? null) : null);
    return;
  }
  if (msg?.k === "agent-hello") {
    // A tab's content script (re)loaded — tell it whether it's still the granted tab.
    void loadControlled().then((cid) => { try { sendResponse({ on: sender.tab?.id != null && sender.tab.id === cid }); } catch { /* noop */ } });
    return true; // async response
  }
  // Live context + user/agent activity from the controlled tab → stream to the bridge.
  if (msg?.k === "agent-context") {
    if (sender.tab?.id === controllableTabId && ws && ws.readyState === 1) { try { ws.send(JSON.stringify({ type: "context", ctx: msg.ctx })); } catch { /* noop */ } }
    return;
  }
  if (msg?.k === "agent-activity") {
    if (sender.tab?.id === controllableTabId && ws && ws.readyState === 1) { try { ws.send(JSON.stringify({ type: "activity", ev: msg.ev })); } catch { /* noop */ } }
    return;
  }
  if (msg?.k === "relay-state") {
    sendResponse({ relay: !!relayUrl, connected: !!(ws && ws.readyState === 1) });
    return true;
  }
});
chrome.tabs.onRemoved.addListener((tid) => { attached.delete(tid); if (tid === controllableTabId) void setControlled(null); });
chrome.tabs.onUpdated.addListener((tid, info) => { if (tid === controllableTabId && info.status) void sendStatus(); });

// Reconnect (to the right endpoint) whenever the relay config changes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || (!changes.relayUrl && !changes.relayToken)) return;
  if (changes.relayUrl) relayUrl = String(changes.relayUrl.newValue || "").trim();
  if (changes.relayToken) relayToken = String(changes.relayToken.newValue || "").trim();
  try { if (ws) ws.close(); } catch { /* noop */ }
  ws = null; backoff = 1000; connect();
});

// Keep the MV3 service worker + the connection alive. The SW is evicted after
// ~30s idle, which silently drops the relay/bridge socket; a short alarm wakes
// it to reconnect if dropped, or pings to stay warm while connected.
try { chrome.alarms.create("atlas-keepalive", { periodInMinutes: 0.4 }); } catch { /* noop */ }
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name !== "atlas-keepalive") return;
  if (!ws || ws.readyState === 2 || ws.readyState === 3) { backoff = 1000; connect(); }
  else if (ws.readyState === 1) { try { ws.send(JSON.stringify({ type: "ping" })); } catch { /* noop */ } }
});

// Load relay config, then connect (relay if configured, else the local bridge).
chrome.storage.local.get(["relayUrl", "relayToken"]).then((s) => {
  relayUrl = String(s.relayUrl || "").trim();
  relayToken = String(s.relayToken || "").trim();
  connect();
}).catch(() => connect());
