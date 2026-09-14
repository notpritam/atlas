import { PRODUCT_NAME } from "./product.js";
import { trustedLibrarySender } from "./library-api.js";
import { startBookmarkImport, resumeBookmarkImport, cancelBookmarkImport, importProgress } from "./import-queue.js";
import { drainQueue, saveCapture } from "./capture.js";
import { extractPageDocument } from "./page-extractor.js";
import {
  libraryRequest,
  protectCloudStorage,
  handleExternalMessage,
  getCloudStatus,
  importLocalCaptures,
  retryCloudSync,
  disconnectCloud,
  trustedPairingSender,
} from "./cloud.js";
import {
  capturePreferenceKey,
  getEffectivePreferences,
  refreshPreferences,
} from "./preferences.js";
import { cloudImageMime } from "./image-formats.js";

protectCloudStorage().catch(() => {});
chrome.runtime.onMessageExternal.addListener((msg, sender, respond) => {
  if (msg?.kind === "atlas-refresh-preferences") {
    if (!trustedPairingSender(sender)) {
      respond({ ok: false, error: "This page cannot update FoundKeep." });
      return;
    }
    refreshPreferences()
      .then(async (state) => {
        const requestedRevision = Number.isSafeInteger(msg.revision) && msg.revision >= 0 ? msg.revision : 0;
        if (state.revision < requestedRevision) throw new Error("FoundKeep did not receive the saved preference revision.");
        await reconcileContextMenus(state.preferences);
        announcePreferenceChange();
        drainQueue().catch(() => {});
        respond({ ok: true, revision: state.revision });
      })
      .catch(() => respond({ ok: false, error: "FoundKeep kept the last saved preferences." }));
    return true;
  }
  handleExternalMessage(msg, sender)
    .then((result) => {
      respond(result);
      if (result.ok && ["atlas-connect", "atlas-auto-connect"].includes(msg.kind)) {
        refreshPreferences()
          .then(async (state) => {
            await reconcileContextMenus(state.preferences);
            announcePreferenceChange();
          })
          .catch(() => {});
        retryCloudSync().catch(() => {});
      }
    })
    .catch(() =>
      respond({
        ok: false,
        error: "FoundKeep could not complete this connection. Please try again.",
      }),
    );
  return true;
});

// ---------------------------------------------------------------------------
// Feedback: a short badge flash (no notifications permission needed).
// ---------------------------------------------------------------------------
async function flash(ok, label) {
  await chrome.action.setBadgeBackgroundColor({
    color: ok ? "#c63b23" : "#d03b3b",
  });
  await chrome.action.setBadgeText({ text: ok ? "✓" : "!" });
  if (!ok && label) console.error("[atlas]", label);
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1500);
}

async function configuredFlash(ok, label) {
  if (!ok || (await getEffectivePreferences()).preferences.feedback.success)
    await flash(ok, label);
}

function announcePreferenceChange() {
  try { chrome.runtime.sendMessage({ kind: "atlas-preferences-changed" }).catch(() => {}); }
  catch { /* no extension view is open */ }
  chrome.tabs.query({ url: ["*://x.com/*", "*://twitter.com/*"] })
    .then((tabs) => Promise.allSettled(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { kind: "atlas-preferences-changed" }))))
    .catch(() => {});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pageMeta(tab, extra) {
  return {
    sourceUrl: tab?.url,
    sourceTitle: tab?.title,
    faviconUrl: tab?.favIconUrl,
    capturedAt: Date.now(),
    ...extra,
  };
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function obviousPrivateHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.includes(":")) {
    return host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd") ||
      /^fe[89ab]/.test(host) || host.startsWith("ff") || host.startsWith("::ffff:127.") ||
      host.startsWith("::ffff:10.") || host.startsWith("::ffff:192.168.");
  }
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function publicHttpUrl(value) {
  const safe = safeHttpUrl(value);
  if (!safe) return null;
  return obviousPrivateHost(new URL(safe).hostname) ? null : safe;
}

async function requestImageHostAccess(value) {
  const source = publicHttpUrl(value);
  if (!source) throw new Error("FoundKeep can only save images from public web addresses outside private networks.");
  const origin = new URL(source).origin + "/*";
  if (await chrome.permissions.contains({ origins: [origin] })) return;
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) throw new Error("Allow access to this image's site to save its original file.");
}

async function contentHash(text) {
  if (!text) return null;
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    let binary = "";
    for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  } catch {
    return null;
  }
}

function boundedText(value, maximum, label) {
  if (typeof value !== "string") return value;
  if (value.length > maximum) throw new Error(`${label} must be ${maximum.toLocaleString("en-US")} characters or fewer.`);
  return value;
}

function fallbackProvenance(tab, captureMethod, capturedAt, targetUrl = null, error = null) {
  return {
    schemaVersion: 1,
    captureMethod,
    pageUrl: safeHttpUrl(tab?.url),
    canonicalUrl: null,
    pageTitle: tab?.title || null,
    siteName: null,
    description: null,
    authors: [],
    publishedAt: null,
    modifiedAt: null,
    language: null,
    leadImageUrl: null,
    faviconUrl: safeHttpUrl(tab?.favIconUrl),
    targetUrl: safeHttpUrl(targetUrl),
    headings: [],
    capturedAt,
    extractedAt: Date.now(),
    extractorVersion: 1,
    contentHash: null,
    extractionStatus: error ? "partial" : "complete",
    extractionError: error,
  };
}

async function capturePageContext(tab, {
  captureMethod,
  readableText = false,
  extendedMetadata = true,
  headings = false,
  maxArticleCharacters = 500_000,
  targetUrl = null,
} = {}) {
  const capturedAt = Date.now();
  if (!tab?.id || !safeHttpUrl(tab.url)) {
    return { articleText: null, provenance: fallbackProvenance(tab, captureMethod, capturedAt, targetUrl, "Page details were unavailable.") };
  }
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageDocument,
      args: [{ captureMethod, capturedAt, readableText, extendedMetadata, headings, maxArticleCharacters }],
    });
    if (!result?.provenance) throw new Error("No page context returned");
    result.provenance.contentHash = await contentHash(result.articleText);
    result.provenance.targetUrl = safeHttpUrl(targetUrl);
    if (!readableText) {
      result.provenance.extractionStatus = "complete";
      result.provenance.extractionError = null;
    }
    return result;
  } catch {
    return { articleText: null, provenance: fallbackProvenance(tab, captureMethod, capturedAt, targetUrl, "FoundKeep saved the source, but some page details were unavailable.") };
  }
}

function methodFor(action, trigger) {
  if (action === "save-selection") return "context-selection";
  if (action === "save-link") return "context-link";
  if (action === "save-image") return "context-image";
  const suffix = {
    savepage: "save-page",
    highlight: "highlight",
    region: "region",
    fullpage: "full-page",
  }[action];
  return `${trigger || "popup"}-${suffix}`;
}

// ---------------------------------------------------------------------------
// Queue drain — periodic cloud retry + on demand.
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  getEffectivePreferences({ refresh: true })
    .then((state) => reconcileContextMenus(state.preferences))
    .catch(() => reconcileContextMenus());
  chrome.alarms.create("atlas-drain", { periodInMinutes: 1 });
  drainQueue().catch(() => {});
  resumeBookmarkImport().catch(() => {});
});
chrome.runtime.onStartup?.addListener(() => {
  getEffectivePreferences()
    .then((state) => reconcileContextMenus(state.preferences))
    .catch(() => reconcileContextMenus());
  chrome.alarms.create("atlas-drain", { periodInMinutes: 1 });
  drainQueue().catch(() => {});
  resumeBookmarkImport().catch(() => {});
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "atlas-drain") {
    getEffectivePreferences()
      .then((state) => reconcileContextMenus(state.preferences))
      .catch(() => {});
    drainQueue().catch(() => {});
    resumeBookmarkImport().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Context menus
// ---------------------------------------------------------------------------
const MENUS = [
  {
    id: "save-selection",
    title: "Save selection to FoundKeep",
    contexts: ["selection"],
  },
  { id: "save-link", title: "Save link to FoundKeep", contexts: ["link"] },
  { id: "save-image", title: "Save image to FoundKeep", contexts: ["image"] },
  { id: "savepage", title: "Save page as bookmark", contexts: ["page"] },
  { id: "region", title: "Screenshot region → FoundKeep", contexts: ["page"] },
  { id: "fullpage", title: "Full-page screenshot → FoundKeep", contexts: ["page"] },
];

async function reconcileContextMenus(preferences) {
  const state = preferences || (await getEffectivePreferences()).preferences;
  await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));
  if (!state.contextMenus) return;
  for (const menu of MENUS) {
    const key = capturePreferenceKey(menu.id);
    if (state.capture[key]) chrome.contextMenus.create({ ...menu, title: menu.title.replaceAll("FoundKeep", PRODUCT_NAME) });
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === "save-image") await requestImageHostAccess(info.srcUrl);
    await performCapture(info.menuItemId, { tab, info, trigger: "context" });
    configuredFlash(true);
  } catch (e) {
    configuredFlash(false, String(e));
  }
});

// ---------------------------------------------------------------------------
// Keyboard commands
// ---------------------------------------------------------------------------
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const action = {
    "region-screenshot": "region",
    "full-page-screenshot": "fullpage",
    "save-highlight": "highlight",
  }[command];
  if (!action) return;
  try {
    await performCapture(action, { tab, trigger: "keyboard" });
    configuredFlash(true);
  } catch (e) {
    configuredFlash(false, String(e));
  }
});

// ---------------------------------------------------------------------------
// Messages from popup / content scripts
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.kind === "library-request" || msg?.kind?.startsWith("bookmark-import-")) {
    if (!trustedLibrarySender(sender, chrome.runtime)) { sendResponse({ok:false,error:"Open your FoundKeep library to continue."}); return; }
    (async()=>{
      try {
        let data;
        if(msg.kind==="library-request") data=await libraryRequest(msg.operation,msg.args,msg.accountId);
        else if(msg.kind==="bookmark-import-start") data=await startBookmarkImport(msg);
        else if(msg.kind==="bookmark-import-status") data=await importProgress(msg.accountId);
        else if(msg.kind==="bookmark-import-retry") { void resumeBookmarkImport(); data=await importProgress(msg.accountId); }
        else if(msg.kind==="bookmark-import-cancel") { await cancelBookmarkImport(); data=null; }
        else throw new Error("Unknown import action.");
        sendResponse({ok:true,data});
      }catch(error){sendResponse({ok:false,error:error.message||"Please try again."});}
    })();return true;
  }

  if (msg?.kind === "feature-status") {
    getEffectivePreferences()
      .then((state) => sendResponse({ ok: true, enabled: !!state.preferences.capture[msg.feature] }))
      .catch(() => sendResponse({ ok: true, enabled: true }));
    return true;
  }
  if (msg?.kind === "preferences-status") {
    if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL("src/"))) {
      sendResponse({ ok: false, error: "Open FoundKeep to view preferences." });
      return;
    }
    getEffectivePreferences({ refresh: msg.refresh === true })
      .then((state) => sendResponse({ ok: true, ...state }))
      .catch(() => sendResponse({ ok: false, error: "FoundKeep could not load preferences." }));
    return true;
  }
  if (msg?.kind?.startsWith("cloud-")) {
    // Content scripts and websites cannot read credentials, disconnect an
    // account, or authorize a historical import through the internal channel.
    if (
      sender.id !== chrome.runtime.id ||
      !sender.url?.startsWith(chrome.runtime.getURL("src/"))
    ) {
      sendResponse({
        ok: false,
        error: "Open FoundKeep to manage this connection.",
      });
      return;
    }
    (async () => {
      try {
        if (msg.kind === "cloud-status")
          return sendResponse({ ok: true, ...(await getCloudStatus()) });
        if (msg.kind === "cloud-import") {
          const result = await importLocalCaptures({
            confirmed: msg.confirmed,
            accountId: msg.accountId,
          });
          sendResponse({ ok: true, ...result });
          drainQueue().catch(() => {});
          return;
        }
        if (msg.kind === "cloud-retry") {
          retryCloudSync().catch(() => {});
          return sendResponse({ ok: true });
        }
        if (msg.kind === "cloud-disconnect") {
          return sendResponse({ ok: true, ...(await disconnectCloud()) });
        }
        sendResponse({ ok: false, error: "Unknown FoundKeep request." });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error.message || "Please try again.",
        });
      }
    })();
    return true;
  }
  if (msg?.kind === "capture") {
    (async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab) return sendResponse({ ok: false, error: "Open a web page to capture it." });
      const acknowledgeStart = msg.action === "region";
      if (acknowledgeStart) sendResponse({ ok: true, started: true });
      try {
        const capture = await performCapture(msg.action, { tab, trigger: "popup" });
        configuredFlash(true);
        if (!acknowledgeStart)
          sendResponse({ ok: true, capture: capture ? { id: capture.id, type: capture.type, cloudStatus: capture.cloudStatus } : null });
      } catch (e) {
        configuredFlash(false, String(e));
        if (!acknowledgeStart) sendResponse({ ok: false, error: e.message || String(e) });
      }
    })();
    return true;
  }
  if (msg?.kind === "saveTweet") {
    (async () => {
      try {
        const preferenceState = await getEffectivePreferences();
        if (!preferenceState.preferences.capture.tweet) throw new Error("Tweet capture is disabled in your FoundKeep preferences.");
        const p = msg.payload;
        boundedText(p.text, preferenceState.policy.limits.selectionCharacters, "Post text");
        const capturedAt = Date.now();
        await saveCapture({
          type: "highlight",
          cloudType: "tweet",
          sourceUrl: p.url,
          sourceTitle: p.title,
          selectionText: p.text,
          faviconUrl: p.favicon,
          capturedAt,
          provenance: fallbackProvenance({ url: p.url, title: p.title, favIconUrl: p.favicon }, "twitter-action", capturedAt),
        });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
  if (msg?.kind === "saveNote") {
    (async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      try {
        const preferenceState = await getEffectivePreferences();
        if (!preferenceState.preferences.capture.note) throw new Error("Notes are disabled in your FoundKeep preferences.");
        const local = msg.source === "library";
        const attachSource = !local && preferenceState.preferences.notes.attachSource;
        const context = !attachSource
          ? { articleText: null, provenance: fallbackProvenance(null, local ? "library-note" : "extension-note", Date.now()) }
          : await capturePageContext(tab, { captureMethod: "extension-note" });
        await saveCapture({
          type: "note",
          noteText: msg.text,
          sourceUrl: local ? null : context.provenance.pageUrl,
          sourceTitle: local ? null : context.provenance.pageTitle,
          faviconUrl: local ? null : context.provenance.faviconUrl,
          capturedAt: context.provenance.capturedAt,
          provenance: context.provenance,
        });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
  if (msg?.kind === "drain") {
    drainQueue().catch(() => {});
    return;
  }
});

// ---------------------------------------------------------------------------
// The one place every capture action is defined.
// ---------------------------------------------------------------------------
async function performCapture(action, { tab, info, trigger = "popup" }) {
  const captureMethod = methodFor(action, trigger);
  const preferenceState = await getEffectivePreferences();
  const preferences = preferenceState.preferences;
  const limits = preferenceState.policy.limits;
  const feature = capturePreferenceKey(action);
  if (!preferences.capture[feature]) throw new Error(`${feature === "fullPage" ? "Full-page screenshot" : feature[0].toUpperCase() + feature.slice(1)} capture is disabled in your FoundKeep preferences.`);
  switch (action) {
    case "region":
      return regionScreenshot(tab, captureMethod, limits);
    case "fullpage":
      return fullPageScreenshot(tab, captureMethod, limits);
    case "highlight":
      return saveHighlight(tab, captureMethod, limits);
    case "savepage": {
      const context = await capturePageContext(tab, {
        captureMethod,
        readableText: preferences.bookmark.readableText,
        extendedMetadata: preferences.bookmark.extendedMetadata,
        headings: preferences.bookmark.headings,
        maxArticleCharacters: limits.articleCharacters,
      });
      return saveCapture({
        type: "bookmark",
        sourceUrl: context.provenance.pageUrl,
        sourceTitle: context.provenance.pageTitle,
        faviconUrl: context.provenance.faviconUrl,
        articleText: context.articleText,
        capturedAt: context.provenance.capturedAt,
        provenance: context.provenance,
      });
    }
    case "save-selection": {
      const context = await capturePageContext(tab, { captureMethod });
      return saveCapture({
        type: "highlight",
        sourceUrl: context.provenance.pageUrl,
        sourceTitle: context.provenance.pageTitle,
        faviconUrl: context.provenance.faviconUrl,
        selectionText: boundedText(info.selectionText, limits.selectionCharacters, "Selected text"),
        capturedAt: context.provenance.capturedAt,
        provenance: context.provenance,
      });
    }
    case "save-link": {
      const context = await capturePageContext(tab, { captureMethod, targetUrl: info.linkUrl });
      return saveCapture({
        type: "bookmark",
        sourceUrl: info.linkUrl,
        sourceTitle: (info.linkText || info.linkUrl || "").slice(0, 1000),
        faviconUrl: context.provenance.faviconUrl,
        capturedAt: context.provenance.capturedAt,
        provenance: context.provenance,
      });
    }
    case "save-image":
      return saveImage(info.srcUrl, tab, captureMethod, limits);
    default:
      return null;
  }
}

async function saveImage(srcUrl, tab, captureMethod, limits) {
  const context = await capturePageContext(tab, { captureMethod, targetUrl: srcUrl });
  const source = publicHttpUrl(srcUrl);
  if (!source) throw new Error("FoundKeep can only save images from public web addresses outside private networks.");
  const response = await fetch(source, {
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`The image could not be downloaded (${response.status}).`);
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > limits.imageBytes)
    throw new Error(`This image exceeds FoundKeep's ${Math.floor(limits.imageBytes / 1048576)} MiB capture limit.`);
  const mime = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (!mime.startsWith("image/"))
    throw new Error("The selected address did not return an image.");
  cloudImageMime(new Blob([], { type: mime }));
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The selected image returned no data.");
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limits.imageBytes) {
        await reader.cancel();
        throw new Error(`This image exceeds FoundKeep's ${Math.floor(limits.imageBytes / 1048576)} MiB capture limit.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const blob = new Blob(chunks, { type: mime });
  cloudImageMime(blob);
  return saveCapture({
    type: "image",
    blob,
    sourceUrl: context.provenance.pageUrl,
    sourceTitle: context.provenance.pageTitle,
    faviconUrl: context.provenance.faviconUrl,
    capturedAt: context.provenance.capturedAt,
    provenance: context.provenance,
  });
}

async function saveHighlight(tab, captureMethod, limits) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const sel = window.getSelection();
      const text = sel ? sel.toString() : "";
      let paragraph = "";
      if (sel && sel.rangeCount) {
        const node = sel.getRangeAt(0).commonAncestorContainer;
        const el = node.nodeType === 1 ? node : node.parentElement;
        paragraph = (
          el?.closest("p,li,article,section,div")?.innerText || ""
        ).slice(0, 1000);
      }
      return { text, paragraph };
    },
  });
  if (!result?.text) throw new Error("no text selected");
  boundedText(result.text, limits.selectionCharacters, "Selected text");
  const context = await capturePageContext(tab, { captureMethod });
  return saveCapture(
    {
      type: "highlight",
      sourceUrl: context.provenance.pageUrl,
      sourceTitle: context.provenance.pageTitle,
      faviconUrl: context.provenance.faviconUrl,
      selectionText: result.text,
      selectionContext: { paragraph: result.paragraph },
      capturedAt: context.provenance.capturedAt,
      provenance: context.provenance,
    },
  );
}

// ---------------------------------------------------------------------------
// Region screenshot
// ---------------------------------------------------------------------------
async function regionScreenshot(tab, captureMethod, limits) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: regionSelectInPage,
  });
  if (!result) return;
  const { rect, dpr } = result;
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: "png",
  });
  const encoded = await cropDataUrl(dataUrl, rect, dpr, limits.imageBytes);
  const context = await capturePageContext(tab, { captureMethod });
  return saveCapture(
    {
      type: "screenshot",
      sourceUrl: context.provenance.pageUrl,
      sourceTitle: context.provenance.pageTitle,
      faviconUrl: context.provenance.faviconUrl,
      width: encoded.width,
      height: encoded.height,
      blob: encoded.blob,
      capturedAt: context.provenance.capturedAt,
      provenance: context.provenance,
    },
  );
}

function regionSelectInPage() {
  return new Promise((resolve) => {
    const dpr = window.devicePixelRatio || 1;
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,0.15)";
    const box = document.createElement("div");
    box.style.cssText =
      "position:fixed;border:2px solid #c63b23;background:rgba(198,59,35,0.15);pointer-events:none;left:0;top:0;width:0;height:0";
    const hint = document.createElement("div");
    hint.textContent = "Drag to capture · Esc to cancel";
    hint.style.cssText =
      "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;font:600 13px -apple-system,system-ui,sans-serif;color:#fff;background:rgba(17,16,22,0.82);padding:7px 14px;border-radius:999px;pointer-events:none";
    overlay.appendChild(box);
    document.body.append(overlay, hint);
    let sx = 0,
      sy = 0,
      dragging = false;
    const cleanup = () => {
      overlay.remove();
      hint.remove();
    };
    overlay.addEventListener("mousedown", (e) => {
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
    });
    overlay.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const x = Math.min(sx, e.clientX),
        y = Math.min(sy, e.clientY);
      box.style.left = x + "px";
      box.style.top = y + "px";
      box.style.width = Math.abs(e.clientX - sx) + "px";
      box.style.height = Math.abs(e.clientY - sy) + "px";
    });
    overlay.addEventListener("mouseup", (e) => {
      dragging = false;
      const x = Math.min(sx, e.clientX),
        y = Math.min(sy, e.clientY);
      const w = Math.abs(e.clientX - sx),
        h = Math.abs(e.clientY - sy);
      cleanup();
      if (w < 5 || h < 5) return resolve(null);
      resolve({ rect: { x, y, w, h }, dpr });
    });
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") {
          cleanup();
          resolve(null);
        }
      },
      { once: true },
    );
  });
}

async function cropDataUrl(dataUrl, rect, dpr, maxBytes) {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const w = Math.round(rect.w * dpr),
    h = Math.round(rect.h * dpr);
  const canvas = new OffscreenCanvas(w, h);
  canvas
    .getContext("2d")
    .drawImage(
      bmp,
      Math.round(rect.x * dpr),
      Math.round(rect.y * dpr),
      w,
      h,
      0,
      0,
      w,
      h,
    );
  return encodeCanvas(canvas, [0.92, 0.8, 0.65, 0.5], maxBytes);
}

// ---------------------------------------------------------------------------
// Full-page screenshot
// ---------------------------------------------------------------------------
const MAX_PAGE_PX = 15000;
const MAX_PAGE_PIXELS = 32_000_000;
const MAX_IMAGE_DIMENSION = 32_768;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

async function fullPageScreenshot(tab, captureMethod, limits) {
  const [{ result: dims }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: prepFullPage,
  });
  const dpr = Math.max(1, Number(dims.dpr) || 1);
  const pixelWidth = Math.round(dims.viewW * dpr);
  if (!pixelWidth || pixelWidth > MAX_IMAGE_DIMENSION) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: restoreFullPage }).catch(() => {});
    throw new Error("This page is too wide to capture safely at the current display scale.");
  }
  const pagePixels = Math.min(MAX_PAGE_PIXELS, limits.fullPagePixels);
  const pageHeight = Math.min(MAX_PAGE_PX, limits.fullPageCssHeight);
  const heightByArea = Math.floor(pagePixels / (dims.viewW * dpr * dpr));
  const heightByDimension = Math.floor(MAX_IMAGE_DIMENSION / dpr);
  const totalH = Math.max(1, Math.min(dims.totalHeight, pageHeight, heightByArea, heightByDimension));
  const shots = [];
  try {
    for (let y = 0; y < totalH; y += dims.viewH) {
      const [{ result: actualY }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (yy) => {
          window.scrollTo(0, yy);
          return window.scrollY;
        },
        args: [y],
      });
      await sleep(500);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "png",
      });
      shots.push({ y: actualY, dataUrl });
      if (actualY + dims.viewH >= totalH) break;
    }
  } finally {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: restoreFullPage,
    });
  }
  const encoded = await stitch(shots, dims, totalH, limits.imageBytes);
  const context = await capturePageContext(tab, { captureMethod });
  return saveCapture(
    {
      type: "screenshot",
      sourceUrl: context.provenance.pageUrl,
      sourceTitle: context.provenance.pageTitle,
      faviconUrl: context.provenance.faviconUrl,
      width: encoded.width,
      height: encoded.height,
      blob: encoded.blob,
      capturedAt: context.provenance.capturedAt,
      provenance: context.provenance,
    },
  );
}

function prepFullPage() {
  window.__atlasHidden = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let scanned = 0;
  while (scanned++ < 50_000) {
    const el = walker.nextNode();
    if (!el) break;
    const pos = getComputedStyle(el).position;
    if (pos === "fixed" || pos === "sticky") {
      window.__atlasHidden.push([el, el.style.visibility]);
      el.style.visibility = "hidden";
    }
  }
  window.__atlasScrollY = window.scrollY;
  window.__atlasScrollBehavior = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = "auto";
  return {
    totalHeight: document.documentElement.scrollHeight,
    viewH: window.innerHeight,
    viewW: window.innerWidth,
    dpr: window.devicePixelRatio || 1,
  };
}

function restoreFullPage() {
  for (const [el, vis] of window.__atlasHidden || []) el.style.visibility = vis;
  document.documentElement.style.scrollBehavior = window.__atlasScrollBehavior || "";
  window.scrollTo(0, window.__atlasScrollY || 0);
  delete window.__atlasHidden;
  delete window.__atlasScrollY;
  delete window.__atlasScrollBehavior;
}

async function encodeCanvas(canvas, qualities = [0.9, 0.75, 0.6, 0.45], maxBytes = MAX_IMAGE_BYTES) {
  for (const quality of qualities) {
    const blob = await canvas.convertToBlob({ type: "image/webp", quality });
    if (blob.size <= Math.min(MAX_IMAGE_BYTES, maxBytes))
      return { blob, width: canvas.width, height: canvas.height };
  }
  throw new Error(`This screenshot is too detailed for FoundKeep's ${Math.floor(Math.min(MAX_IMAGE_BYTES, maxBytes) / 1048576)} MiB capture limit. Capture a smaller region or reduce the page zoom.`);
}

async function stitch(shots, dims, totalH, maxBytes) {
  const canvas = new OffscreenCanvas(
    Math.round(dims.viewW * dims.dpr),
    Math.round(totalH * dims.dpr),
  );
  const ctx = canvas.getContext("2d");
  for (const shot of shots) {
    const bmp = await createImageBitmap(
      await (await fetch(shot.dataUrl)).blob(),
    );
    ctx.drawImage(bmp, 0, Math.round(shot.y * dims.dpr));
  }
  return encodeCanvas(canvas, undefined, maxBytes);
}
