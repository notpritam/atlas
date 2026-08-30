import { postCapture, testConnection } from "./api.js";
import { getSettings, setSettings } from "./storage.js";

const $ = (id) => document.getElementById(id);
const noteEl = $("note");

const ICONS = {
  screenshot: "ic-shot",
  image: "ic-shot",
  highlight: "ic-highlight",
  bookmark: "ic-bookmark",
  note: "ic-page",
};

function toast(msg, err = false) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("err", err);
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1800);
}

function relTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

async function refreshConnection() {
  const dot = $("dot");
  const conn = $("conn");
  try {
    const h = await testConnection();
    dot.className = "dot ok";
    conn.textContent = `${h.total} saved`;
  } catch (e) {
    dot.className = "dot bad";
    conn.textContent = String(e).includes("not configured") ? "set up" : "offline";
  }
}

async function renderRecent() {
  const { recent } = await chrome.storage.local.get("recent");
  const list = $("recent");
  list.innerHTML = "";
  if (!recent?.length) {
    list.innerHTML = `<li class="recent-empty">Your captures will show up here.</li>`;
    return;
  }
  for (const r of recent.slice(0, 8)) {
    const li = document.createElement("li");
    li.className = "r-item";
    li.innerHTML = `
      <span class="r-ic"><span class="a-ic ${ICONS[r.type] || "ic-page"}"></span></span>
      <span class="r-main">
        <span class="r-title"></span>
        <span class="r-meta">${r.type}</span>
      </span>
      <span class="r-time">${relTime(r.at)}</span>`;
    li.querySelector(".r-title").textContent = r.title || "(untitled)";
    list.appendChild(li);
  }
}

// Fire a page-clip action in the background worker, then close so the in-page
// overlay/capture can run unobstructed.
function runAction(act) {
  chrome.runtime.sendMessage({ kind: "capture", action: act });
  window.close();
}

async function saveNote() {
  const noteText = noteEl.value.trim();
  if (!noteText) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await postCapture({
      type: "note",
      noteText,
      sourceUrl: tab?.url,
      sourceTitle: tab?.title,
      faviconUrl: tab?.favIconUrl,
      capturedAt: Date.now(),
    });
    // record locally so it shows in Recent immediately
    chrome.runtime.sendMessage({
      kind: "record",
      entry: { type: "note", title: noteText.slice(0, 60), at: Date.now() },
    });
    noteEl.value = "";
    toast("Saved ✓");
    refreshConnection();
    setTimeout(renderRecent, 150);
  } catch (e) {
    toast(`Failed: ${e}`.slice(0, 40), true);
  }
}

function showSettings(show) {
  $("view-main").hidden = show;
  $("view-settings").hidden = !show;
}

async function init() {
  const { baseUrl, token } = await getSettings();
  $("baseUrl").value = baseUrl;
  $("token").value = token;
  if (!baseUrl || !token) showSettings(true);
  await refreshConnection();
  await renderRecent();
  noteEl.focus();
}

// wire up
$("save").addEventListener("click", saveNote);
noteEl.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") saveNote();
});
document.querySelectorAll(".action").forEach((b) =>
  b.addEventListener("click", () => runAction(b.dataset.act)),
);
$("statusChip").addEventListener("click", refreshConnection);
$("openSettings").addEventListener("click", () => showSettings(true));
$("backBtn").addEventListener("click", () => showSettings(false));
$("saveSettings").addEventListener("click", async () => {
  await setSettings({ baseUrl: $("baseUrl").value, token: $("token").value });
  await refreshConnection();
  const ok = $("dot").classList.contains("ok");
  toast(ok ? "Connected ✓" : "Check URL/token", !ok);
  if (ok) setTimeout(() => showSettings(false), 600);
});

init();
