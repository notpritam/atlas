import { drainQueue, saveCapture } from "./capture.js";
import "./control-bg.js"; // agent-control bridge (WebSocket → Atlas Browser MCP)

// ---------------------------------------------------------------------------
// Feedback: a short badge flash (no notifications permission needed).
// ---------------------------------------------------------------------------
async function flash(ok, label) {
  await chrome.action.setBadgeBackgroundColor({ color: ok ? "#6e56cf" : "#d03b3b" });
  await chrome.action.setBadgeText({ text: ok ? "✓" : "!" });
  if (!ok && label) console.error("[atlas]", label);
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1500);
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

// ---------------------------------------------------------------------------
// Queue drain — periodic (in case the agent was offline) + on demand.
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const m of MENUS) chrome.contextMenus.create(m);
  });
  chrome.alarms.create("atlas-drain", { periodInMinutes: 1 });
});
chrome.runtime.onStartup?.addListener(() => drainQueue().catch(() => {}));
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "atlas-drain") drainQueue().catch(() => {});
});

// ---------------------------------------------------------------------------
// Context menus
// ---------------------------------------------------------------------------
const MENUS = [
  { id: "save-selection", title: "Save selection to Atlas", contexts: ["selection"] },
  { id: "save-link", title: "Save link to Atlas", contexts: ["link"] },
  { id: "save-image", title: "Save image to Atlas", contexts: ["image"] },
  { id: "savepage", title: "Save page as bookmark", contexts: ["page"] },
  { id: "region", title: "Screenshot region → Atlas", contexts: ["page"] },
  { id: "fullpage", title: "Full-page screenshot → Atlas", contexts: ["page"] },
];

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    await performCapture(info.menuItemId, { tab, info });
    flash(true);
  } catch (e) {
    flash(false, String(e));
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
    await performCapture(action, { tab });
    flash(true);
  } catch (e) {
    flash(false, String(e));
  }
});

// ---------------------------------------------------------------------------
// Messages from popup / content scripts
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.kind === "capture") {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      try {
        await performCapture(msg.action, { tab });
        flash(true);
      } catch (e) {
        flash(false, String(e));
      }
    })();
    return;
  }
  if (msg?.kind === "saveTweet") {
    (async () => {
      try {
        const p = msg.payload;
        await saveCapture({
          type: "highlight",
          sourceUrl: p.url,
          sourceTitle: p.title,
          selectionText: p.text,
          faviconUrl: p.favicon,
          capturedAt: Date.now(),
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
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      try {
        await saveCapture({
          type: "note",
          noteText: msg.text,
          sourceUrl: tab?.url,
          sourceTitle: tab?.title,
          faviconUrl: tab?.favIconUrl,
          capturedAt: Date.now(),
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
async function performCapture(action, { tab, info }) {
  switch (action) {
    case "region":
      return regionScreenshot(tab);
    case "fullpage":
      return fullPageScreenshot(tab);
    case "highlight":
      return saveHighlight(tab);
    case "savepage":
      return saveCapture(pageMeta(tab, { type: "bookmark" }));
    case "save-selection":
      return saveCapture(pageMeta(tab, { type: "highlight", selectionText: info.selectionText }));
    case "save-link":
      return saveCapture({
        type: "bookmark",
        sourceUrl: info.linkUrl,
        sourceTitle: info.linkText || info.linkUrl,
        faviconUrl: tab.favIconUrl,
        capturedAt: Date.now(),
      });
    case "save-image":
      return saveImage(info.srcUrl, tab);
    default:
      return null;
  }
}

async function saveImage(srcUrl, tab) {
  const blob = await (await fetch(srcUrl)).blob();
  return saveCapture(pageMeta(tab, { type: "image", blob }));
}

async function saveHighlight(tab) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const sel = window.getSelection();
      const text = sel ? sel.toString() : "";
      let paragraph = "";
      if (sel && sel.rangeCount) {
        const node = sel.getRangeAt(0).commonAncestorContainer;
        const el = node.nodeType === 1 ? node : node.parentElement;
        paragraph = (el?.closest("p,li,article,section,div")?.innerText || "").slice(0, 1000);
      }
      return { text, paragraph };
    },
  });
  if (!result?.text) throw new Error("no text selected");
  return saveCapture(
    pageMeta(tab, {
      type: "highlight",
      selectionText: result.text,
      selectionContext: { paragraph: result.paragraph },
    }),
  );
}

// ---------------------------------------------------------------------------
// Region screenshot
// ---------------------------------------------------------------------------
async function regionScreenshot(tab) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: regionSelectInPage,
  });
  if (!result) return;
  const { rect, dpr } = result;
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const blob = await cropDataUrl(dataUrl, rect, dpr);
  return saveCapture(
    pageMeta(tab, {
      type: "screenshot",
      width: Math.round(rect.w * dpr),
      height: Math.round(rect.h * dpr),
      blob,
    }),
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
      "position:fixed;border:2px solid #6e56cf;background:rgba(110,86,207,0.15);pointer-events:none;left:0;top:0;width:0;height:0";
    const hint = document.createElement("div");
    hint.textContent = "Drag to capture · Esc to cancel";
    hint.style.cssText =
      "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;font:600 13px -apple-system,system-ui,sans-serif;color:#fff;background:rgba(17,16,22,0.82);padding:7px 14px;border-radius:999px;pointer-events:none";
    overlay.appendChild(box);
    document.body.append(overlay, hint);
    let sx = 0, sy = 0, dragging = false;
    const cleanup = () => { overlay.remove(); hint.remove(); };
    overlay.addEventListener("mousedown", (e) => { dragging = true; sx = e.clientX; sy = e.clientY; });
    overlay.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY);
      box.style.left = x + "px"; box.style.top = y + "px";
      box.style.width = Math.abs(e.clientX - sx) + "px";
      box.style.height = Math.abs(e.clientY - sy) + "px";
    });
    overlay.addEventListener("mouseup", (e) => {
      dragging = false;
      const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY);
      const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
      cleanup();
      if (w < 5 || h < 5) return resolve(null);
      resolve({ rect: { x, y, w, h }, dpr });
    });
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") { cleanup(); resolve(null); } }, { once: true });
  });
}

async function cropDataUrl(dataUrl, rect, dpr) {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const w = Math.round(rect.w * dpr), h = Math.round(rect.h * dpr);
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d").drawImage(bmp, Math.round(rect.x * dpr), Math.round(rect.y * dpr), w, h, 0, 0, w, h);
  return canvas.convertToBlob({ type: "image/webp", quality: 0.92 });
}

// ---------------------------------------------------------------------------
// Full-page screenshot
// ---------------------------------------------------------------------------
const MAX_PAGE_PX = 15000;

async function fullPageScreenshot(tab) {
  const [{ result: dims }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: prepFullPage });
  const totalH = Math.min(dims.totalHeight, MAX_PAGE_PX);
  const shots = [];
  try {
    for (let y = 0; y < totalH; y += dims.viewH) {
      const [{ result: actualY }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (yy) => { window.scrollTo(0, yy); return window.scrollY; },
        args: [y],
      });
      await sleep(500);
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      shots.push({ y: actualY, dataUrl });
      if (actualY + dims.viewH >= totalH) break;
    }
  } finally {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: restoreFullPage });
  }
  const blob = await stitch(shots, dims, totalH);
  return saveCapture(
    pageMeta(tab, {
      type: "screenshot",
      width: Math.round(dims.viewW * dims.dpr),
      height: Math.round(totalH * dims.dpr),
      blob,
    }),
  );
}

function prepFullPage() {
  window.__atlasHidden = [];
  for (const el of document.querySelectorAll("body *")) {
    const pos = getComputedStyle(el).position;
    if (pos === "fixed" || pos === "sticky") {
      window.__atlasHidden.push([el, el.style.visibility]);
      el.style.visibility = "hidden";
    }
  }
  window.__atlasScrollY = window.scrollY;
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
  window.scrollTo(0, window.__atlasScrollY || 0);
  delete window.__atlasHidden;
  delete window.__atlasScrollY;
}

async function stitch(shots, dims, totalH) {
  const canvas = new OffscreenCanvas(Math.round(dims.viewW * dims.dpr), Math.round(totalH * dims.dpr));
  const ctx = canvas.getContext("2d");
  for (const shot of shots) {
    const bmp = await createImageBitmap(await (await fetch(shot.dataUrl)).blob());
    ctx.drawImage(bmp, 0, Math.round(shot.y * dims.dpr));
  }
  return canvas.convertToBlob({ type: "image/webp", quality: 0.9 });
}
