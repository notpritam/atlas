# Atlas Desktop — floating capture companion

A small always-on-top, draggable **dock** (an animated glass orb) that captures
into your Atlas from anywhere on screen:

- **Region** — drag a rectangle, it screenshots that area → Atlas.
- **Clipboard** — saves the current clipboard image, or selected text you've
  copied, as a highlight → Atlas. (Select → ⌘C → dock "Clipboard".)
- **Note** — a quick note straight into Atlas.

Everything is sent to the Atlas backend (`POST /v1/captures`, the same one the
browser extension and the bb **Library** use), where your bb agent enriches it.

## Run (dev)

```bash
cd ~/personal/apps/atlas/apps/desktop
npm install
npm start
```

First launch: click ⚙ on the dock → set **Backend URL** (default
`https://atlas.notpritam.in`) and paste your **ingest device token** (the one you
also paste into the Chrome extension; see `~/.local/share/atlas/tokens.txt` →
`ingest_token`). It's stored locally in `config.json` under Electron's userData.

## Shortcuts (global)

- `⌘⇧2` — capture a region
- `⌘⇧S` — save clipboard
- `⌘⇧N` — quick note

## macOS permission

Region/screen capture needs **Screen Recording** permission: System Settings →
Privacy & Security → Screen Recording → enable for the app (or your terminal /
Electron in dev). Without it, `desktopCapturer` returns black frames.

## Build

```bash
npm run dist:mac   # dmg + zip via electron-builder
```

## How it maps to the backend

- note → JSON `{ type: "note", noteText }`
- clipboard text → JSON `{ type: "highlight", selectionText }`
- region / clipboard image → multipart (`meta` = `{ type: "screenshot", … }` + `blob` PNG)

Menu-bar/tray app (no Dock icon on macOS); closing the window keeps it running in
the tray. Quit from the tray menu.
