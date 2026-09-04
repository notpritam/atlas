# Chrome Web Store — Atlas submission

Everything needed to publish Atlas to the Chrome Web Store.

## Build the upload

```bash
bash deploy/pack-store.sh
# → deploy/dist/atlas-store-<version>.zip  (no key / no update_url — store manages both)
```

Upload that zip in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole)
(one-time US$5 developer registration). The store assigns its own extension id —
different from the self-hosted id `mjfcgmboaijfcaanepdipbgmipnccnpn`.

> Keep the self-hosted flow (`pack-extension.sh`, `key`, `update_url`) for the
> direct-download build on the landing page. The store build is separate.

## Listing copy

**Name:** Atlas — Capture to your second brain
**Short (≤132 chars):** Save screenshots, highlights, links and notes to a private, local library — auto-organized by your own AI. No account, no tracking.

**Category:** Productivity
**Language:** English

**Detailed description:**
> Atlas is a privacy-first "capture everything" tool. Grab a screenshot, highlight
> text, bookmark a page, save a tweet, or jot a note — and Atlas files it into a
> private library, auto-tagged and summarized by your own local Claude Code.
>
> • Region + full-page screenshots
> • Save highlighted text with its source
> • One-click bookmarks and tweet saves
> • Quick notes from the popup
> • Auto-organized: tags, summaries, categories — computed locally
>
> Local by default: your captures live in your browser, and enrichment runs on
> your own machine. No account. No analytics. No data sent to us. Optionally point
> it at your own self-hosted Atlas backend.
>
> Open source — github.com/notpritam/atlas

**Privacy policy URL:** https://atlas.notpritam.in/privacy.html
**Homepage URL:** https://atlas.notpritam.in
**Support:** github.com/notpritam/atlas/issues

## Permission justifications (the store asks for each)

- **activeTab / scripting / tabs** — take the screenshot and read the selection on the current tab, only when the user triggers a capture.
- **host permission `<all_urls>`** — the user can capture from any site they're on; the extension acts only on explicit capture, never reads pages in the background.
- **host permission `localhost` / `127.0.0.1`** — sends captures to the user's own local Claude Code companion for private, on-device organizing.
- **storage** — store captures and settings locally.
- **contextMenus** — the right-click "Save to Atlas".
- **alarms** — periodically enrich pending captures locally.

Single purpose: *capture web content into the user's personal library and organize it locally.*

## Assets to prepare

- Icon: 128×128 (already in `icons/icon128.png`).
- Screenshots: 1280×800 (or 640×400), at least 1 — recommend 3–5:
  1. The popup composer + quick-action grid
  2. A region screenshot in progress
  3. The dashboard/library with auto-tags
  4. Right-click "Save to Atlas"
- Small promo tile 440×280 (optional but recommended).

## Pre-submit checklist

- [ ] `pack-store.sh` zip has **no** `key` and **no** `update_url` (script verifies).
- [ ] No `.pem`/private keys in the zip (script strips them).
- [ ] Privacy policy live at the URL above (deploy `apps/web/privacy.html` via `deploy/sync-web.sh`).
- [ ] Description matches actual behavior; permissions all justified.
- [ ] Version bumped in `apps/extension/manifest.json`.
- [ ] Tested unpacked in Chrome (Load unpacked → `apps/extension`).

## After approval

- Update the landing page's install button to the Web Store link (in addition to the direct .zip).
- Announce (ties into the Content Engine initiative #3).
