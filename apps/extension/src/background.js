import { postCapture } from "./api.js";

// ---------------------------------------------------------------------------
// UX feedback: a short badge flash (no icon assets / notifications needed).
// ---------------------------------------------------------------------------
async function flash(ok, label) {
  await chrome.action.setBadgeBackgroundColor({ color: ok ? "#16a34a" : "#dc2626" });
  await chrome.action.setBadgeText({ text: ok ? "✓" : "!" });
  if (!ok && label) console.error("[atlas]", label);
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1600);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pageMeta(tab, extra) {
  return {
    sourceUrl: tab.url,
    sourceTitle: tab.title,
    faviconUrl: tab.favIconUrl,
    capturedAt: Date.now(),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Context menus
// ---------------------------------------------------------------------------
const MENUS = [
  { id: "atlas-save-selection", title: "Save selection to Atlas", contexts: ["selection"] },
  { id: "atlas-save-link", title: "Save link to Atlas", contexts: ["link"] },
  { id: "atlas-save-image", title: "Save image to Atlas", contexts: ["image"] },
  { id: "atlas-save-page", title: "Save page as bookmark", contexts: ["page"] },
  { id: "atlas-region", title: "Screenshot region → Atlas", contexts: ["page"] },
  { id: "atlas-fullpage", title: "Full-page screenshot → Atlas", contexts: ["page"] },
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const m of MENUS) chrome.contextMenus.create(m);
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    switch (info.menuItemId) {
      case "atlas-save-selection":
        await postCapture(pageMeta(tab, { type: "highlight", selectionText: info.selectionText }));
        break;
      case "atlas-save-link":
        await postCapture({
          type: "bookmark",
          sourceUrl: info.linkUrl,
          sourceTitle: info.linkText || info.linkUrl,
          faviconUrl: tab.favIconUrl,
          capturedAt: Date.now(),
        });
        break;
      case "atlas-save-image":
        await saveImage(info.srcUrl, tab);
        break;
      case "atlas-save-page":
        await postCapture(pageMeta(tab, { type: "bookmark" }));
        break;
      case "atlas-region":
        await regionScreenshot(tab);
        break;
      case "atlas-fullpage":
        await fullPageScreenshot(tab);
        break;
      default:
        return;
    }
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
  try {
    if (command === "region-screenshot") await regionScreenshot(tab);
    else if (command === "full-page-screenshot") await fullPageScreenshot(tab);
    else if (command === "save-highlight") await saveHighlight(tab);
    flash(true);
  } catch (e) {
    flash(false, String(e));
  }
});

// ---------------------------------------------------------------------------
// Simple captures
// ---------------------------------------------------------------------------
async function saveImage(srcUrl, tab) {
  const resp = await fetch(srcUrl);
  const blob = await resp.blob();
  await postCapture(pageMeta(tab, { type: "image" }), blob);
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
  await postCapture(
    pageMeta(tab, {
      type: "highlight",
      selectionText: result.text,
      selectionContext: { paragraph: result.paragraph },
    }),
  );
}

// ---------------------------------------------------------------------------
// Region screenshot: inject an overlay that resolves with the chosen rect.
// ---------------------------------------------------------------------------
async function regionScreenshot(tab) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: regionSelectInPage,
  });
  if (!result) return; // cancelled
  const { rect, dpr } = result;
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const blob = await cropDataUrl(dataUrl, rect, dpr);
  await postCapture(
    pageMeta(tab, {
      type: "screenshot",
      width: Math.round(rect.w * dpr),
      height: Math.round(rect.h * dpr),
    }),
    blob,
  );
}

// Runs IN the page. Returns {rect,dpr} in CSS px or null if cancelled.
function regionSelectInPage() {
  return new Promise((resolve) => {
    const dpr = window.devicePixelRatio || 1;
    const overlay = document.createElement("div");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,0.15)";
    const box = document.createElement("div");
    box.style.cssText =
      "position:fixed;border:2px solid #3b82f6;background:rgba(59,130,246,0.15);pointer-events:none;left:0;top:0;width:0;height:0";
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    let sx = 0, sy = 0, dragging = false;
    const cleanup = () => overlay.remove();
    overlay.addEventListener("mousedown", (e) => {
      dragging = true;
      sx = e.clientX;
      sy = e.clientY;
    });
    overlay.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY);
      const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
      box.style.left = x + "px";
      box.style.top = y + "px";
      box.style.width = w + "px";
      box.style.height = h + "px";
    });
    overlay.addEventListener("mouseup", (e) => {
      dragging = false;
      const x = Math.min(sx, e.clientX), y = Math.min(sy, e.clientY);
      const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
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

async function cropDataUrl(dataUrl, rect, dpr) {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const w = Math.round(rect.w * dpr), h = Math.round(rect.h * dpr);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, Math.round(rect.x * dpr), Math.round(rect.y * dpr), w, h, 0, 0, w, h);
  return canvas.convertToBlob({ type: "image/webp", quality: 0.92 });
}

// ---------------------------------------------------------------------------
// Full-page screenshot: auto-scroll + stitch. Hides fixed/sticky elements to
// avoid header duplication; reads back the real scrollY per step to align.
// ---------------------------------------------------------------------------
const MAX_PAGE_PX = 15000; // guard against the OffscreenCanvas area cap

async function fullPageScreenshot(tab) {
  const [{ result: dims }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: prepFullPage,
  });
  const totalH = Math.min(dims.totalHeight, MAX_PAGE_PX);
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
      await sleep(500); // render + captureVisibleTab rate limit (~2/s)
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      shots.push({ y: actualY, dataUrl });
      if (actualY + dims.viewH >= totalH) break;
    }
  } finally {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: restoreFullPage });
  }
  const blob = await stitch(shots, dims, totalH);
  await postCapture(
    pageMeta(tab, {
      type: "screenshot",
      width: Math.round(dims.viewW * dims.dpr),
      height: Math.round(totalH * dims.dpr),
    }),
    blob,
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
  const w = Math.round(dims.viewW * dims.dpr);
  const h = Math.round(totalH * dims.dpr);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  for (const shot of shots) {
    const bmp = await createImageBitmap(await (await fetch(shot.dataUrl)).blob());
    ctx.drawImage(bmp, 0, Math.round(shot.y * dims.dpr));
  }
  return canvas.convertToBlob({ type: "image/webp", quality: 0.9 });
}
