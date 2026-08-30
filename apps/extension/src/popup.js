import { postCapture, testConnection } from "./api.js";
import { getSettings, setSettings } from "./storage.js";

const $ = (id) => document.getElementById(id);
const noteEl = $("note");
const statusEl = $("status");
const dotEl = $("dot");
const connEl = $("conn");

function setStatus(msg) {
  statusEl.textContent = msg;
}

async function refreshConnection() {
  try {
    const health = await testConnection();
    dotEl.className = "dot ok";
    connEl.textContent = `${health.pending} pending`;
    return true;
  } catch (e) {
    dotEl.className = "dot bad";
    connEl.textContent = String(e).includes("not configured") ? "set up →" : "offline";
    return false;
  }
}

async function init() {
  const { baseUrl, token } = await getSettings();
  $("baseUrl").value = baseUrl;
  $("token").value = token;
  if (!baseUrl || !token) $("settings").open = true;
  await refreshConnection();
  noteEl.focus();
}

$("save").addEventListener("click", async () => {
  const noteText = noteEl.value.trim();
  if (!noteText) return;
  setStatus("Saving…");
  try {
    // Attach the current tab as source context if there is one.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await postCapture({
      type: "note",
      noteText,
      sourceUrl: tab?.url,
      sourceTitle: tab?.title,
      faviconUrl: tab?.favIconUrl,
      capturedAt: Date.now(),
    });
    noteEl.value = "";
    setStatus("Saved ✓");
    refreshConnection();
    setTimeout(() => window.close(), 500);
  } catch (e) {
    setStatus(`Failed: ${e}`);
  }
});

// Cmd/Ctrl+Enter to save.
noteEl.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") $("save").click();
});

$("saveSettings").addEventListener("click", async () => {
  await setSettings({ baseUrl: $("baseUrl").value, token: $("token").value });
  setStatus("Testing…");
  const ok = await refreshConnection();
  setStatus(ok ? "Connected ✓" : "Could not reach Atlas");
});

init();
