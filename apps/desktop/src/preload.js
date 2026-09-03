"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("atlas", {
  getConfig: () => ipcRenderer.invoke("get-config"),
  setConfig: (patch) => ipcRenderer.invoke("set-config", patch),
  captureRegion: () => ipcRenderer.invoke("capture-region"),
  saveNote: (text) => ipcRenderer.invoke("capture-note", text),
  saveClipboard: () => ipcRenderer.invoke("capture-clipboard"),
  // overlay → main
  regionSelected: (rect) => ipcRenderer.send("region-selected", rect),
  regionCancelled: () => ipcRenderer.send("region-cancelled"),
  // main → dock
  onStatus: (cb) => ipcRenderer.on("status", (_e, s) => cb(s)),
  onOpenNote: (cb) => ipcRenderer.on("open-note", () => cb()),
});
