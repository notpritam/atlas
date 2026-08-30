# Atlas Capture — browser extension (Chrome MV3)

No build step. Load it unpacked:

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
   select this `apps/extension` folder.
2. Click the Atlas toolbar icon → **Settings** → enter the backend URL
   (`https://atlas.notpritam.in`) and the **ingest** device token minted with
   `atlas devices add "Chrome — laptop" --scope ingest`. Hit **Save & test**;
   the dot turns green when connected.

## Capturing

- **Quick note** — toolbar popup, type and Save (⌘/Ctrl+Enter).
- **Right-click menu** — Save selection / link / image / page-as-bookmark,
  Screenshot region, Full-page screenshot.
- **Keyboard** — `Alt+Shift+S` region screenshot, `Alt+Shift+F` full-page,
  `Alt+Shift+H` save selected text. (Rebind at `chrome://extensions/shortcuts`.)

- **On X / Twitter** — an Atlas button is injected into every tweet's action
  bar (next to reply/like/bookmark). One click saves the tweet (author, text,
  permalink) to Atlas; the icon turns into a check when saved.

A green ✓ / red ! badge flashes on the toolbar icon after each capture.

All network calls happen in the background service worker, so the token never
enters page context.
