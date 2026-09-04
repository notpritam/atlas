// Background bridge for agent control. Connects to the local Atlas Browser MCP
// (ws://127.0.0.1:8792), tracks which tab you've granted control to (via the
// on-page Agent button), and routes the agent's commands to that tab.
const PORT = Number(self.ATLAS_BRIDGE_PORT || 8792);
let ws = null;
let backoff = 1000;
let controllableTabId = null;
let hydrated = false;

// MV3 evicts this service worker after ~30s idle, wiping in-memory state — and a
// tab reload/navigation re-injects the content script fresh. So the granted tab
// is persisted in chrome.storage.session (cleared when the browser closes) and
// rehydrated here, keeping agent control "sticky" across both.
async function loadControlled() {
  if (!hydrated) {
    try { const s = await chrome.storage.session.get("controlledTabId"); if (typeof s.controlledTabId === "number") controllableTabId = s.controlledTabId; } catch { /* noop */ }
    hydrated = true;
  }
  return controllableTabId;
}
async function setControlled(id) {
  controllableTabId = id; hydrated = true;
  try { if (id == null) await chrome.storage.session.remove("controlledTabId"); else await chrome.storage.session.set({ controlledTabId: id }); } catch { /* noop */ }
  void sendStatus();
}

function schedule() { backoff = Math.min(backoff * 1.5, 15000); setTimeout(connect, backoff); }

function connect() {
  try { ws = new WebSocket(`ws://127.0.0.1:${PORT}`); }
  catch { return schedule(); }
  ws.onopen = () => { backoff = 1000; sendStatus(); };
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
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "status", controllable: controllableTabId != null, url, title }));
}

async function handleCmd(m) {
  const { id, action, params = {} } = m;
  try {
    await loadControlled();
    if (controllableTabId == null) return reply(id, false, "No tab is under agent control. Click the floating “Agent” button on the page you want me to drive.");
    if (action === "screenshot") {
      const t = await chrome.tabs.get(controllableTabId);
      const dataUrl = await chrome.tabs.captureVisibleTab(t.windowId, { format: "png" });
      return reply(id, true, { base64: dataUrl.split(",")[1], mime: "image/png" });
    }
    if (action === "navigate") {
      await chrome.tabs.update(controllableTabId, { url: params.url });
      await new Promise((r) => setTimeout(r, 1200));
      return reply(id, true, { navigated: params.url });
    }
    const res = await chrome.tabs
      .sendMessage(controllableTabId, { k: "agent-cmd", action, params })
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
    void loadControlled().then((id) => { try { sendResponse({ on: sender.tab?.id != null && sender.tab.id === id }); } catch { /* noop */ } });
    return true; // async response
  }
});
chrome.tabs.onRemoved.addListener((tid) => { if (tid === controllableTabId) void setControlled(null); });
chrome.tabs.onUpdated.addListener((tid, info) => { if (tid === controllableTabId && info.status) void sendStatus(); });

connect();
