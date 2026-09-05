import * as db from "./db.js";
import { agentHealth } from "./agent.js";
import { getSettings, setSettings } from "./storage.js";

const $ = (id) => document.getElementById(id);
const state = { type: "", tag: null, category: null, q: "" };
let urls = [];

const TYPE_ICONS = {
  screenshot: `<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="M14 3h7v7M10 21H3v-7"/>`,
  highlight: `<path d="M4 20h16M6 16l8-8 4 4-8 8H6z"/>`,
  bookmark: `<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>`,
  image: `<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>`,
  note: `<path d="M4 4h16v12l-4 4H4z"/><path d="M16 20v-4h4"/>`,
};
const svg = (paths) =>
  `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

const TYPES = [
  { id: "", label: "All" },
  { id: "screenshot", label: "Screenshots" },
  { id: "highlight", label: "Highlights" },
  { id: "bookmark", label: "Bookmarks" },
  { id: "image", label: "Images" },
  { id: "note", label: "Notes" },
];

function relTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(ts).toLocaleDateString();
}
const title = (c) => c.summary || c.sourceTitle || c.noteText || c.selectionText || "(untitled)";
function revokeUrls() { urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; }
function blobUrl(blob) { const u = URL.createObjectURL(blob); urls.push(u); return u; }

// ---------------------------------------------------------------- rendering
function statusBadge(c) {
  if (c.status === "done") return "";
  if (c.status === "failed") return `<span class="badge failed">retry</span>`;
  return `<span class="badge ${c.status}"><span class="spin"></span>${c.status === "processing" ? "enriching" : "queued"}</span>`;
}

function card(c) {
  const w = document.createElement("div");
  w.className = "cardw";
  const el = document.createElement("article");
  el.className = "card";
  const visual = (c.type === "screenshot" || c.type === "image") && c.blob;

  let inner = "";
  if (visual) {
    inner += `<img class="thumb" style="max-height:360px;object-fit:cover;object-position:top" src="${blobUrl(c.blob)}" alt="" />`;
  }
  inner += `<div class="body"><div class="meta"><span class="type">${svg(TYPE_ICONS[c.type] || "")}${c.type}</span>${statusBadge(c)}<span class="time">${relTime(c.createdAt)}</span></div>`;
  if (c.type === "highlight" && c.selectionText) {
    inner += `<div class="quote"></div>`;
  } else if (!visual) {
    inner += `<h3></h3>`;
  }
  if (c.summary && (visual || c.type === "bookmark")) inner += `<div class="sum"></div>`;
  if (c.tags?.length) inner += `<div class="tags">${c.tags.slice(0, 4).map(() => "<span></span>").join("")}</div>`;
  inner += `</div>`;
  el.innerHTML = inner;

  // fill text safely
  const q = el.querySelector(".quote"); if (q) q.textContent = c.selectionText;
  const h = el.querySelector("h3"); if (h) h.textContent = title(c);
  const s = el.querySelector(".sum"); if (s) s.textContent = c.summary;
  const tagEls = el.querySelectorAll(".tags span");
  (c.tags || []).slice(0, 4).forEach((t, i) => { if (tagEls[i]) tagEls[i].textContent = "#" + t; });

  el.addEventListener("click", () => openDetail(c.id));
  w.appendChild(el);
  return w;
}

async function load() {
  revokeUrls();
  const rows = await db.listCaptures(state);
  const grid = $("grid");
  const empty = $("empty");
  grid.innerHTML = "";
  if (!rows.length) {
    grid.hidden = true;
    empty.hidden = false;
    empty.innerHTML = `<img src="../assets/mark.svg" width="46" height="46" alt="" />
      <h3>${state.q || state.type || state.tag ? "Nothing matches" : "Your library is empty"}</h3>
      <p>${state.q || state.type || state.tag ? "Try a different filter." : "Capture a screenshot, highlight, bookmark, tweet or note from any page — it lands here and your Claude Code enriches it."}</p>`;
  } else {
    empty.hidden = true;
    grid.hidden = false;
    const frag = document.createDocumentFragment();
    for (const c of rows) frag.appendChild(card(c));
    grid.appendChild(frag);
  }
  renderFilters();
}

async function renderFilters() {
  const tf = $("typeFilters");
  tf.innerHTML = "";
  for (const t of TYPES) {
    const b = document.createElement("button");
    b.className = "chip" + (state.type === t.id ? " on" : "");
    b.textContent = t.label;
    b.onclick = () => { state.type = t.id; load(); };
    tf.appendChild(b);
  }
  const ff = $("facetFilters");
  ff.innerHTML = "";
  const { tags, categories } = await db.facets();
  for (const cat of categories.slice(0, 6)) {
    const b = document.createElement("button");
    b.className = "chip" + (state.category === cat.name ? " on" : "");
    b.innerHTML = `${cat.name} <span class="ct">${cat.count}</span>`;
    b.onclick = () => { state.category = state.category === cat.name ? null : cat.name; load(); };
    ff.appendChild(b);
  }
  for (const tg of tags.slice(0, 12)) {
    const b = document.createElement("button");
    b.className = "chip" + (state.tag === tg.name ? " on" : "");
    b.innerHTML = `#${tg.name} <span class="ct">${tg.count}</span>`;
    b.onclick = () => { state.tag = state.tag === tg.name ? null : tg.name; load(); };
    ff.appendChild(b);
  }
}

// ---------------------------------------------------------------- detail
async function openDetail(id) {
  const c = await db.getCapture(id);
  if (!c) return;
  const visual = (c.type === "screenshot" || c.type === "image") && c.blob;
  const sheet = $("sheet");
  sheet.innerHTML = `
    <div class="sheet-head">
      <span class="type">${c.type}</span>${statusBadge(c)}<span class="grow"></span>
      ${c.sourceUrl ? `<a class="linkbtn" href="${c.sourceUrl}" target="_blank" rel="noreferrer">Source ↗</a>` : ""}
      <button class="iconbtn sm" id="delBtn" title="Delete">🗑</button>
      <button class="iconbtn sm" id="closeBtn" aria-label="Close">✕</button>
    </div>
    <div class="sheet-body" id="sbody"></div>`;
  const body = sheet.querySelector("#sbody");

  if (visual) { const img = document.createElement("img"); img.className = "full"; img.src = blobUrl(c.blob); body.appendChild(img); }
  const h = document.createElement("h2"); h.textContent = title(c); body.appendChild(h);
  if (c.type === "highlight" && c.selectionText) { const bq = document.createElement("blockquote"); bq.textContent = c.selectionText; body.appendChild(bq); }
  if (c.type === "note" && c.noteText) { const p = document.createElement("div"); p.className = "field"; p.innerHTML = `<div class="v" style="white-space:pre-wrap"></div>`; p.querySelector(".v").textContent = c.noteText; body.appendChild(p); }

  const field = (k, v, mono) => { const d = document.createElement("div"); d.className = "field"; d.innerHTML = `<div class="k">${k}</div><div class="v ${mono ? "mono" : ""}"></div>`; d.querySelector(".v").textContent = v; return d; };
  if (c.summary && !visual && c.type !== "note") body.appendChild(field("Summary", c.summary));
  if (c.description) body.appendChild(field("Description", c.description));
  if (c.category || c.tags?.length) {
    const d = document.createElement("div"); d.className = "field";
    const row = document.createElement("div"); row.className = "tagrow";
    if (c.category) { const s = document.createElement("span"); s.className = "cat"; s.textContent = c.category; row.appendChild(s); }
    for (const t of c.tags || []) { const s = document.createElement("span"); s.className = "tag"; s.textContent = "#" + t; row.appendChild(s); }
    d.innerHTML = `<div class="k">Tags</div>`; d.appendChild(row); body.appendChild(d);
  }
  if (c.articleText) { const d = document.createElement("div"); d.className = "field"; d.innerHTML = `<div class="k">Reader</div><div class="reader"></div>`; d.querySelector(".reader").textContent = c.articleText; body.appendChild(d); }
  if (c.ocrText) { const d = field("Extracted text (OCR)", c.ocrText, true); body.appendChild(d); }
  if (c.status === "failed" && c.enrichError) body.appendChild(field("Enrichment error", c.enrichError, true));

  $("overlay").hidden = false;
  sheet.querySelector("#closeBtn").onclick = closeOverlay;
  sheet.querySelector("#delBtn").onclick = async () => { await db.deleteCapture(id); closeOverlay(); load(); };
}
function closeOverlay() { $("overlay").hidden = true; $("sheet").innerHTML = ""; }
$("overlay").addEventListener("click", (e) => { if (e.target.id === "overlay") closeOverlay(); });

// ---------------------------------------------------------------- status
async function refreshStatus() {
  const dot = $("dot"), conn = $("conn");
  const c = await db.counts();
  const { agentUrl } = await getSettings();
  let online = false;
  try { await agentHealth(agentUrl); online = true; } catch {}
  const queued = (c.pending || 0) + (c.processing || 0) + (c.failed || 0);
  if (!online) { dot.className = "dot bad"; conn.textContent = queued ? `${queued} queued` : "agent offline"; }
  else if (queued) { dot.className = "dot queue"; conn.textContent = `${queued} enriching`; }
  else { dot.className = "dot ok"; conn.textContent = `${c.total} saved`; }
}

// ---------------------------------------------------------------- settings
async function openSettings() {
  const s = await getSettings();
  $("agentUrl").value = s.agentUrl;
  $("enrichEnabled").checked = s.enrichEnabled;
  $("relayUrl").value = s.relayUrl;
  $("relayToken").value = s.relayToken;
  await testAgent();
  await updateRelayBox();
  $("settings").hidden = false;
}
async function updateRelayBox() {
  const box = $("relayBox");
  if (!box) return;
  if (!$("relayUrl").value.trim()) {
    box.innerHTML = `<span class="a-ok">● Local mode</span> — an agent drives this browser over the local bridge.`;
    return;
  }
  try {
    const st = await chrome.runtime.sendMessage({ k: "relay-state" });
    box.innerHTML = st && st.connected
      ? `<span class="a-ok">● Connected to relay</span> — your agent can drive this browser from anywhere.`
      : `<span class="a-bad">● Not connected to the relay.</span> Check the URL + token; the backend must be reachable.`;
  } catch {
    box.innerHTML = `<span class="a-bad">● Relay status unavailable.</span>`;
  }
}
async function testAgent() {
  const box = $("agentBox");
  const url = $("agentUrl").value.trim() || "http://127.0.0.1:8791";
  try {
    const h = await agentHealth(url);
    box.innerHTML = h.claude
      ? `<span class="a-ok">● Connected to Claude Code</span> — enrichment is live.`
      : `<span class="a-bad">● Agent running, Claude Code not detected.</span> Make sure Claude Code is installed and logged in.`;
  } catch {
    box.innerHTML = `<span class="a-bad">● Agent not running.</span> Start it on your machine:<br><br><code>npx @notpritam/atlas-agent</code><br><br>Captures stay safely queued until it's up.`;
  }
}
$("settingsBtn").onclick = openSettings;
$("settingsClose").onclick = () => ($("settings").hidden = true);
$("settings").addEventListener("click", (e) => { if (e.target.id === "settings") $("settings").hidden = true; });
$("saveSettings").onclick = async () => {
  await setSettings({
    agentUrl: $("agentUrl").value.trim() || "http://127.0.0.1:8791",
    enrichEnabled: $("enrichEnabled").checked,
    relayUrl: $("relayUrl").value.trim(),
    relayToken: $("relayToken").value.trim(),
  });
  await testAgent();
  chrome.runtime.sendMessage({ kind: "drain" });
  // give control-bg a moment to reconnect to the new endpoint, then show status
  setTimeout(updateRelayBox, 1200);
  refreshStatus();
};
$("drainNow").onclick = () => { chrome.runtime.sendMessage({ kind: "drain" }); testAgent(); };
$("exportBtn").onclick = async () => {
  const rows = await db.listCaptures({ limit: 100000 });
  const clean = rows.map(({ blob, ...r }) => ({ ...r, hasBlob: !!blob }));
  const url = URL.createObjectURL(new Blob([JSON.stringify(clean, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = `atlas-export-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  URL.revokeObjectURL(url);
};
$("clearBtn").onclick = async () => {
  if (!confirm("Delete ALL captures from this browser? This cannot be undone.")) return;
  await db.clearAll();
  $("settings").hidden = true;
  load(); refreshStatus();
};

// ---------------------------------------------------------------- search + live
let t;
$("q").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value.trim(); load(); }, 220); });
$("statusChip").onclick = () => { chrome.runtime.sendMessage({ kind: "drain" }); refreshStatus(); };
chrome.runtime.onMessage.addListener((m) => { if (m?.kind === "atlas-changed") { load(); refreshStatus(); } });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeOverlay(); $("settings").hidden = true; } });

load();
refreshStatus();
setInterval(refreshStatus, 15000);
