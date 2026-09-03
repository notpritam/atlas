"use strict";
const $ = (id) => document.getElementById(id);
const notePanel = $("notePanel");
const settingsPanel = $("settingsPanel");
const toastEl = $("toast");
let toastTimer = null;

function showToast(message, ok = true) {
  toastEl.textContent = message;
  toastEl.classList.toggle("bad", !ok);
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3200);
}
function openPanel(which) {
  notePanel.hidden = which !== "note";
  settingsPanel.hidden = which !== "settings";
  if (which === "note") $("noteText").focus();
}

// actions
$("regionBtn").onclick = () => { window.atlas.captureRegion(); };
$("clipBtn").onclick = () => { window.atlas.saveClipboard(); };
$("noteBtn").onclick = () => openPanel(notePanel.hidden ? "note" : null);
$("settingsBtn").onclick = async () => {
  if (settingsPanel.hidden) {
    const c = await window.atlas.getConfig();
    $("backendUrl").value = c.backendUrl || "";
    $("token").value = c.token || "";
    openPanel("settings");
  } else openPanel(null);
};

// note
async function saveNote() {
  const t = $("noteText").value.trim();
  if (!t) return;
  const ok = await window.atlas.saveNote(t);
  if (ok) { $("noteText").value = ""; openPanel(null); }
}
$("noteSave").onclick = saveNote;
$("noteCancel").onclick = () => openPanel(null);
$("noteText").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveNote(); }
  if (e.key === "Escape") openPanel(null);
});

// settings
$("settingsSave").onclick = async () => {
  await window.atlas.setConfig({ backendUrl: $("backendUrl").value.trim(), token: $("token").value.trim() });
  showToast("Settings saved ✓");
  openPanel(null);
};
$("settingsCancel").onclick = () => openPanel(null);

// main → dock
window.atlas.onStatus((s) => showToast(s.message, s.ok));
window.atlas.onOpenNote(() => openPanel("note"));
