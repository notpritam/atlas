// Atlas desktop companion — a floating, draggable dock that captures a region
// screenshot, the current selection/clipboard, or a quick note, and sends it to
// the Atlas backend (/v1/captures) where your bb agent enriches it.
"use strict";
const {
  app, BrowserWindow, ipcMain, globalShortcut, desktopCapturer, screen,
  nativeImage, clipboard, Tray, Menu, nativeTheme,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const CONFIG_PATH = () => path.join(app.getPath("userData"), "config.json");
const DEFAULT_CONFIG = {
  backendUrl: "https://atlas.notpritam.in",
  token: "",
  shortcutRegion: "CommandOrControl+Shift+2",
  shortcutNote: "CommandOrControl+Shift+N",
  shortcutClip: "CommandOrControl+Shift+S",
};

function loadConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH(), "utf8")) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
function saveConfig(patch) {
  cfg = { ...cfg, ...patch };
  try { fs.writeFileSync(CONFIG_PATH(), JSON.stringify(cfg, null, 2)); } catch (e) { console.error("config save", e); }
  return cfg;
}

let cfg = { ...DEFAULT_CONFIG };
let dock = null;
let overlay = null;
let tray = null;

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

function createDock() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  dock = new BrowserWindow({
    width: 220,
    height: 320,
    x: width - 240,
    y: 120,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  dock.setAlwaysOnTop(true, "floating");
  dock.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  dock.loadFile(path.join(__dirname, "dock.html"));
  dock.on("closed", () => { dock = null; });
}

function toast(message, ok = true) {
  if (dock && !dock.isDestroyed()) dock.webContents.send("status", { message, ok });
}

// Fullscreen transparent overlay to drag-select a region.
function openOverlay() {
  if (overlay) { overlay.focus(); return; }
  const disp = screen.getPrimaryDisplay();
  overlay = new BrowserWindow({
    x: disp.bounds.x, y: disp.bounds.y,
    width: disp.size.width, height: disp.size.height,
    frame: false, transparent: true, resizable: false, movable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, enableLargerThanScreen: true,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.loadFile(path.join(__dirname, "overlay.html"));
  overlay.on("closed", () => { overlay = null; });
}

// ---------------------------------------------------------------------------
// Capture + upload
// ---------------------------------------------------------------------------

async function uploadJson(payload) {
  if (!cfg.token) { toast("Set your Atlas token in Settings", false); return false; }
  try {
    const res = await fetch(`${cfg.backendUrl.replace(/\/+$/, "")}/v1/captures`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.token}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    toast(`Saved ${payload.type} to Atlas ✓`);
    return true;
  } catch (e) {
    toast(`Couldn't save (${String(e.message || e)})`, false);
    return false;
  }
}

async function uploadScreenshot(pngBuffer, meta) {
  if (!cfg.token) { toast("Set your Atlas token in Settings", false); return false; }
  try {
    const form = new FormData();
    form.append("meta", JSON.stringify({ type: "screenshot", sourceTitle: "Desktop capture", ...meta }));
    form.append("blob", new Blob([pngBuffer], { type: "image/png" }), "capture.png");
    const res = await fetch(`${cfg.backendUrl.replace(/\/+$/, "")}/v1/captures`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.token}` },
      body: form,
    });
    if (!res.ok) throw new Error(`${res.status}`);
    toast("Saved screenshot to Atlas ✓");
    return true;
  } catch (e) {
    toast(`Couldn't save screenshot (${String(e.message || e)})`, false);
    return false;
  }
}

// Grab the primary screen at full device resolution and crop to rect (CSS px).
async function captureRegion(rect) {
  const disp = screen.getPrimaryDisplay();
  const scale = disp.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: Math.round(disp.size.width * scale), height: Math.round(disp.size.height * scale) },
  });
  const src = sources.find((s) => String(s.display_id) === String(disp.id)) ?? sources[0];
  if (!src) { toast("No screen source (grant Screen Recording permission)", false); return; }
  const full = src.thumbnail;
  const crop = {
    x: Math.max(0, Math.round(rect.x * scale)),
    y: Math.max(0, Math.round(rect.y * scale)),
    width: Math.max(1, Math.round(rect.w * scale)),
    height: Math.max(1, Math.round(rect.h * scale)),
  };
  const cropped = full.crop(crop);
  await uploadScreenshot(cropped.toPNG(), { width: Math.round(rect.w), height: Math.round(rect.h) });
}

async function captureClipboard() {
  const img = clipboard.readImage();
  if (!img.isEmpty()) {
    const size = img.getSize();
    return uploadScreenshot(img.toPNG(), { width: size.width, height: size.height, sourceTitle: "Clipboard image" });
  }
  const text = clipboard.readText().trim();
  if (text) return uploadJson({ type: "highlight", selectionText: text, sourceTitle: "Clipboard" });
  toast("Clipboard is empty — copy something first", false);
  return false;
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

function trayIcon() {
  // A tiny monochrome dot; template image so macOS tints it for the menu bar.
  const img = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAP0lEQVR4nGNgGAWjgP7/HzOMYmBg+M9AJcAwyoBhFAyjYBQMo2AUDKNgFAyjYBQMo2AUDKNgFAyjYBQMLQAAxWkH+8m1nq0AAAAASUVORK5CYII=",
  );
  img.setTemplateImage(true);
  return img;
}
function buildTray() {
  try { tray = new Tray(trayIcon()); } catch { return; }
  tray.setToolTip("Atlas — capture to your second brain");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Capture region", click: () => openOverlay() },
    { label: "Save clipboard", click: () => void captureClipboard() },
    { label: "Show dock", click: () => { if (dock) dock.show(); else createDock(); } },
    { type: "separator" },
    { label: "Quit Atlas", click: () => app.quit() },
  ]));
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

ipcMain.handle("get-config", () => cfg);
ipcMain.handle("set-config", (_e, patch) => { const c = saveConfig(patch || {}); registerShortcuts(); return c; });
ipcMain.handle("capture-region", () => { openOverlay(); return true; });
ipcMain.handle("capture-note", (_e, text) => uploadJson({ type: "note", noteText: String(text || "").trim(), sourceTitle: "Quick note" }));
ipcMain.handle("capture-clipboard", () => captureClipboard());
ipcMain.on("region-selected", async (_e, rect) => {
  if (overlay) overlay.close();
  if (rect && rect.w > 3 && rect.h > 3) await captureRegion(rect);
});
ipcMain.on("region-cancelled", () => { if (overlay) overlay.close(); });

// ---------------------------------------------------------------------------
// Shortcuts + lifecycle
// ---------------------------------------------------------------------------

function registerShortcuts() {
  globalShortcut.unregisterAll();
  const reg = (accel, fn) => { if (accel) { try { globalShortcut.register(accel, fn); } catch { /* ignore */ } } };
  reg(cfg.shortcutRegion, () => openOverlay());
  reg(cfg.shortcutClip, () => void captureClipboard());
  reg(cfg.shortcutNote, () => { if (dock) { dock.show(); dock.webContents.send("open-note"); } });
}

app.whenReady().then(() => {
  cfg = loadConfig();
  nativeTheme.themeSource = "dark";
  createDock();
  buildTray();
  registerShortcuts();
  app.on("activate", () => { if (!dock) createDock(); });
});
app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => { /* keep running in the tray */ });
if (process.platform === "darwin" && app.dock) app.dock.hide(); // menu-bar app, no Dock icon
