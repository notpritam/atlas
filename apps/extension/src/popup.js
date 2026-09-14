import {bindCollections} from './collections-ui.js';
import * as db from "./db.js";
import { $, title, domain, ago, icon, hydrateIcons, message } from "./ui.js";
import { bindConnections } from "./connections.js";
import { bindCloud } from "./cloud-ui.js";
import { CUSTOMER_ORIGIN } from "./cloud.js";
import { DEFAULT_PREFERENCES } from "./preferences.js";

hydrateIcons();

let blobUrls = [];
let saving = false;
let captureBusy = false;
let preferences = structuredClone(DEFAULT_PREFERENCES);
let cloudState = null;

const settings = bindConnections($("connections"));
const cloud = bindCloud($("cloudSummary"), {
  compact: true,
  onStatus: (state) => {
    cloudState = state;
    $("openLib").innerHTML = "Open collection" + " " + icon("arrow");
    $("openLocalLib").hidden = !state.account;
    $("storageState").dataset.state = state.status === "reconnect" ? "reconnect" : state.pending ? "waiting" : "ready";
    $("storageState").lastChild.textContent = state.status === "reconnect"
      ? "Reconnect needed"
      : state.pending
        ? `${state.pending} waiting`
        : state.account
          ? "Synced to FoundKeep"
          : "Saved locally";
  },
});

async function openLibrary(id) {
  try {
    await chrome.tabs.create({
      url: chrome.runtime.getURL("src/dashboard.html") + (id ? `#capture=${encodeURIComponent(id)}` : ""),
    });
    window.close();
  } catch (error) {
    message($("saveFeedback"), error.message || "Could not open the library.", "error");
  }
}

async function renderRecent() {
  const limit = preferences.popup.showRecent ? preferences.popup.recentCount : 0;
  const [rows, counts] = await Promise.all([
    limit ? db.recentCaptures(limit) : Promise.resolve([]),
    db.counts(),
  ]);
  blobUrls.forEach(URL.revokeObjectURL);
  blobUrls = [];
  $("savedCount").textContent = `${counts.total} saved`;
  $("recent").replaceChildren();
  for (const capture of rows) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.className = "recent-item";
    button.innerHTML = `<span class="r-icon">${icon(capture.type)}</span><span class="r-copy"><span class="r-title"></span><span class="r-meta"></span></span><span class="r-time"></span>`;
    button.querySelector(".r-title").textContent = title(capture);
    button.querySelector(".r-meta").textContent = domain(capture.sourceUrl);
    button.querySelector(".r-time").textContent = ago(capture.createdAt);
    if (capture.blob) {
      const image = document.createElement("img");
      image.alt = "";
      image.src = URL.createObjectURL(capture.blob);
      blobUrls.push(image.src);
      button.querySelector(".r-icon").replaceChildren(image);
    }
    button.onclick = () => openLibrary(capture.id);
    item.append(button);
    $("recent").append(item);
  }
  if (!rows.length && limit) {
    const empty = document.createElement("li");
    empty.className = "recent-empty";
    empty.textContent = "Your next good find starts here.";
    $("recent").append(empty);
  }
}

function applyPreferences(next) {
  if (!next?.popup || !next?.capture) return;
  preferences = structuredClone(next);
  $("savePage").hidden = !preferences.capture.bookmark;
  $("noteComposer").hidden = !preferences.capture.note;
  $("recentSection").hidden = !preferences.popup.showRecent || preferences.popup.recentCount === 0;
  const order = new Map(preferences.popup.actionOrder.map((name, index) => [name, index]));
  const actions = [...$("secondaryActions").querySelectorAll("[data-feature]")];
  actions
    .sort((a, b) => (order.get(a.dataset.feature) ?? 99) - (order.get(b.dataset.feature) ?? 99))
    .forEach((button) => {
      button.hidden = !preferences.capture[button.dataset.feature];
      $("secondaryActions").append(button);
    });
  const visibleSecondary = actions.some((button) => !button.hidden);
  $("secondaryActions").hidden = !visibleSecondary;
  if ($("savePage").hidden && !visibleSecondary) {
    message($("captureFeedback"), "Page capture is turned off in your FoundKeep settings.");
  }
  document.body.dataset.preferencesReady = "true";
}

async function loadPreferences({ refresh = false } = {}) {
  try {
    const result = await chrome.runtime.sendMessage({ kind: "preferences-status", refresh });
    if (result?.ok) applyPreferences(result.preferences);
    else applyPreferences(DEFAULT_PREFERENCES);
  } catch {
    applyPreferences(DEFAULT_PREFERENCES);
  }
  await renderRecent();
}

function updateSave() {
  $("save").disabled = saving || !$("note").value.trim();
}

async function saveNote() {
  const text = $("note").value.trim();
  if (!text || saving) return;
  const draft = $("note").value;
  saving = true;
  updateSave();
  $("save").textContent = "Saving…";
  message($("saveFeedback"), "");
  try {
    const response = await chrome.runtime.sendMessage({ kind: "saveNote", text });
    if (!response?.ok) throw new Error(response?.error || "Could not save your note. Try again.");
    if ($("note").value === draft) $("note").value = "";
    message($("saveFeedback"), "Saved in your library.", "success");
    await renderRecent();
  } catch (error) {
    message($("saveFeedback"), error.message || "Could not save. Your draft is still here.", "error");
  } finally {
    saving = false;
    $("save").innerHTML = `Save note ${icon("arrow")}`;
    updateSave();
  }
}

async function runCapture(button) {
  if (captureBusy) return;
  captureBusy = true;
  const action = button.dataset.act;
  const label = button.querySelector(".action-label");
  const original = label?.textContent;
  button.setAttribute("aria-busy", "true");
  document.querySelectorAll("[data-act]").forEach((item) => { item.disabled = true; });
  if (label) label.textContent = action === "savepage" ? "Saving page…" : "Capturing…";
  message($("captureFeedback"), action === "savepage" ? "Collecting readable text and source details…" : "Starting capture…");
  try {
    const response = await chrome.runtime.sendMessage({ kind: "capture", action });
    if (!response?.ok) throw new Error(response?.error || "Could not capture this page.");
    if (action === "region") {
      window.close();
      return;
    }
    message($("captureFeedback"), "Saved in your FoundKeep library.", "success");
    await renderRecent();
  } catch (error) {
    message($("captureFeedback"), error.message || "Could not start capture. Reload this page and try again.", "error");
  } finally {
    captureBusy = false;
    button.removeAttribute("aria-busy");
    document.querySelectorAll("[data-act]").forEach((item) => { item.disabled = false; });
    if (label && original) label.textContent = original;
  }
}

$("note").addEventListener("input", updateSave);
$("note").addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    saveNote();
  }
});
$("save").onclick = saveNote;
document.querySelectorAll("[data-act]").forEach((button) => { button.onclick = () => runCapture(button); });

let currentWindowId;
function openSidebar(){
  const fallback=()=>chrome.tabs.create({url:chrome.runtime.getURL("src/library.html")}).then(()=>window.close());
  if(chrome.sidePanel?.open && Number.isInteger(currentWindowId)){
    // Do not await storage or tabs before calling open: this must retain the click gesture.
    chrome.sidePanel.open({windowId:currentWindowId}).then(()=>window.close()).catch(fallback);
  }else void fallback();
}
$("openLib").onclick = openSidebar;
$("openLocalLib").onclick = () => openLibrary();
$("brandLibrary").onclick = (event) => { event.preventDefault(); openSidebar(); };
$("openPreferenceDashboard").onclick = () => chrome.tabs.create({ url: CUSTOMER_ORIGIN + "/dashboard#extension-settings" }).then(() => window.close());

$("openSettings").onclick = async () => {
  $("view-main").hidden = true;
  $("view-settings").hidden = false;
  $("backBtn").focus();
  await settings.load();
};
$("backBtn").onclick = () => {
  $("view-settings").hidden = true;
  $("view-main").hidden = false;
  $("openSettings").focus();
};

chrome.runtime.onMessage.addListener((messageValue) => {
  if (messageValue.kind === "atlas-changed") {
    renderRecent().catch(() => {});
    cloud.load();
    if (!$("view-settings").hidden) settings.refreshCloud();
  }
  if (messageValue.kind === "atlas-preferences-changed") loadPreferences().catch(() => {});
});

window.addEventListener("focus", () => cloud.load());
window.addEventListener("pagehide", () => blobUrls.forEach(URL.revokeObjectURL));

async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentWindowId = tab?.windowId;
    if (tab && /^https?:\/\//.test(tab.url || "")) {
      $("page-domain").textContent = domain(tab.url);
      $("page-title").textContent = tab.title || tab.url;
    } else {
      $("page-title").textContent = "Open a web page to capture it.";
      document.querySelectorAll("[data-act]").forEach((button) => { button.disabled = true; });
    }
    await Promise.all([loadPreferences(), cloud.load()]);
  } catch {
    applyPreferences(DEFAULT_PREFERENCES);
    message($("saveFeedback"), "Could not load recent captures. Try reopening FoundKeep.", "error");
  }
}

init();

const sharedCollections=bindCollections(document.getElementById('popup-collections'),{getAccountId:()=>cloudState?.account?.id,getSource:async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return {title:tab?.title||'',url:tab?.url||''};}});
