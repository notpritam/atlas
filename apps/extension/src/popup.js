import * as db from "./db.js";
import { agentHealth } from "./agent.js";
import { getSettings, setSettings } from "./storage.js";

const $ = (id) => document.getElementById(id);
const ICONS = { screenshot: "ic-shot", image: "ic-shot", highlight: "ic-highlight", bookmark: "ic-bookmark", note: "ic-page" };

function relTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

async function refreshStatus() {
  const dot = $("dot"), conn = $("conn");
  const c = await db.counts();
  const { agentUrl } = await getSettings();
  let online = false;
  try { await agentHealth(agentUrl); online = true; } catch { /* offline */ }
  const queued = (c.pending || 0) + (c.processing || 0) + (c.failed || 0);
  if (!online) { dot.className = "dot bad"; conn.textContent = queued ? `${queued} queued` : "agent offline"; }
  else if (queued) { dot.className = "dot queue"; conn.textContent = `${queued} enriching`; }
  else { dot.className = "dot ok"; conn.textContent = `${c.total} saved`; }
}

async function renderRecent() {
  const rows = await db.listCaptures({ limit: 6 });
  const list = $("recent");
  list.innerHTML = "";
  if (!rows.length) { list.innerHTML = `<li class="recent-empty">Your captures show up here.</li>`; return; }
  for (const r of rows) {
    const li = document.createElement("li");
    li.className = "r-item";
    const ic = document.createElement("span");
    ic.className = "r-ic";
    if (r.blob) {
      const img = document.createElement("img");
      img.src = URL.createObjectURL(r.blob);
      ic.appendChild(img);
    } else {
      ic.style.display = "grid"; ic.style.placeItems = "center";
      const g = document.createElement("span");
      g.className = "a-ic " + (ICONS[r.type] || "ic-page");
      g.style.width = "14px"; g.style.height = "14px";
      ic.appendChild(g);
    }
    const main = document.createElement("span");
    main.className = "r-main";
    const title = document.createElement("span");
    title.className = "r-title";
    title.textContent = r.summary || r.sourceTitle || r.noteText || r.selectionText || "(untitled)";
    const meta = document.createElement("span");
    meta.className = "r-meta";
    meta.textContent = r.type + (r.tags?.length ? " · " + r.tags.slice(0, 2).map((t) => "#" + t).join(" ") : "");
    main.append(title, meta);
    const st = document.createElement("span");
    st.className = "r-status" + (r.status === "done" ? " done" : "");
    st.textContent = r.status === "done" ? "✓" : relTime(r.createdAt);
    li.append(ic, main, st);
    list.appendChild(li);
  }
}

function showSettings(s) { $("view-main").hidden = s; $("view-settings").hidden = !s; }

function saveNote() {
  const text = $("note").value.trim();
  if (!text) return;
  chrome.runtime.sendMessage({ kind: "saveNote", text });
  $("note").value = "";
  setTimeout(() => window.close(), 250);
}

$("save").addEventListener("click", saveNote);
$("note").addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") saveNote(); });
document.querySelectorAll(".action").forEach((b) =>
  b.addEventListener("click", () => { chrome.runtime.sendMessage({ kind: "capture", action: b.dataset.act }); window.close(); }),
);
$("openLib").addEventListener("click", () => { chrome.tabs.create({ url: chrome.runtime.getURL("src/dashboard.html") }); window.close(); });
$("statusChip").addEventListener("click", () => { chrome.runtime.sendMessage({ kind: "drain" }); refreshStatus(); });
$("openSettings").addEventListener("click", () => showSettings(true));
$("backBtn").addEventListener("click", () => showSettings(false));
async function updateRelayBox() {
  const box = $("relayBox");
  if (!box) return;
  if (!$("relayUrl").value.trim()) { box.innerHTML = `<span class="a-ok">● Local mode</span> — drives over the local bridge.`; return; }
  try {
    const st = await chrome.runtime.sendMessage({ k: "relay-state" });
    box.innerHTML = st && st.connected
      ? `<span class="a-ok">● Connected to relay</span> — drivable from anywhere.`
      : `<span class="a-bad">● Not connected.</span> Check the URL + token.`;
  } catch { box.innerHTML = `<span class="a-bad">● Relay status unavailable.</span>`; }
}
$("saveSettings").addEventListener("click", async () => {
  await setSettings({
    agentUrl: $("agentUrl").value.trim() || "http://127.0.0.1:8791",
    enrichEnabled: $("enrichEnabled").checked,
    relayUrl: $("relayUrl").value.trim(),
    relayToken: $("relayToken").value.trim(),
  });
  await refreshStatus();
  chrome.runtime.sendMessage({ kind: "drain" });
  setTimeout(updateRelayBox, 1200);
  showSettings(false);
});
chrome.runtime.onMessage.addListener((m) => { if (m?.kind === "atlas-changed") { refreshStatus(); renderRecent(); } });

(async function init() {
  const s = await getSettings();
  $("agentUrl").value = s.agentUrl;
  $("enrichEnabled").checked = s.enrichEnabled;
  $("relayUrl").value = s.relayUrl;
  $("relayToken").value = s.relayToken;
  await refreshStatus();
  await updateRelayBox();
  await renderRecent();
  $("note").focus();
})();
