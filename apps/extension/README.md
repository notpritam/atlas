# Foundkeep — browser extension (Chromium MV3)

Keep readable page copies, screenshots, highlights, links, images, and notes with a record of where they came from. Connect your Foundkeep account to sync new captures to a private dashboard, with a local library available offline.

## Install or update

There are separate development and production builds. Both can be installed in the same browser:

| Build | Destination | Local data |
| --- | --- | --- |
| **Foundkeep Dev** | https://dev.foundkeep.app | Separate extension identity, credentials, queue, and `atlas-dev` IndexedDB |
| **Foundkeep** | https://foundkeep.app | Existing production identity and `atlas` IndexedDB retained |

Download [Foundkeep Dev](https://dev.foundkeep.app/ext/foundkeep-extension-dev.zip) for dev testing, or use the production Chrome Web Store installation. Each website connects only its corresponding extension. The dev build has no production auto-update feed. Keyboard shortcuts may need separate assignments when both are installed; choose the extension by name at `chrome://extensions/shortcuts`.

1. Extract the extension ZIP into a folder you can keep, or use this `apps/extension` directory.
2. Open the extensions page in Chrome, Edge, Brave, Opera, or Vivaldi, enable **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`. Chrome and Brave accept `chrome://extensions`; Edge uses `edge://extensions`.
3. Pin Foundkeep from the browser’s extensions menu.

To update an existing unpacked installation, replace its files in the existing folder and click **Reload**. Keep the existing installation to retain the local library. Uninstalling removes extension data. Managed installations can receive signed updates.

## Connect your account

Choose **Connect Foundkeep** in the popup, create an account or sign in at [Foundkeep](https://foundkeep.app/dashboard.html), then connect this browser from the dashboard. The website hands the extension a short-lived, one-use connection code. No developer token or separate software is required.

New captures made while an account is selected are saved locally and queued for that account. Foundkeep retries automatically after network failures when automatic sync is enabled. **Try sync again** requests an immediate retry; **Reconnect** appears if the browser credential expires or is revoked. Captures remain available locally throughout.

Existing local captures are never uploaded automatically. To include them, open **Settings → Import local captures**, review the destination account, then confirm. Switching accounts never moves captures or pending uploads between accounts. Reconnecting the original account resumes its pending captures.

## Capture

- **Popup:** save a readable copy of the current page, select a region, capture a full page, save selected text, or write a note. Notes also save with ⌘/Ctrl + Enter.
- **Right-click:** save a selection, link, image, or page; capture a region or full-page screenshot.
- **Keyboard:** `Alt+Shift+S` captures a region, `Alt+Shift+F` a full page, and `Alt+Shift+H` selected text. Change assignments at `chrome://extensions/shortcuts`.
- **X / Twitter:** the Foundkeep button in a tweet’s action bar saves the author, text, and permalink.

Page capture requires a normal web page. Chrome restricts capture on internal browser pages and certain protected pages. Notes can still be saved there. Saved images are limited to 8 MiB. A larger generated screenshot remains local with an actionable sync error.

Saving a page keeps the useful article or main text, available headings and structured page details. Its provenance record can include the exact visited URL, canonical URL, title, description, site, authors, publication and modification dates, language, lead image, favicon, capture method and timestamps, extractor version, extraction status, and a SHA-256 content fingerprint. Saved links and images also keep the containing page separately from the target. Foundkeep does not store raw page HTML.

## Capture settings

Open **Account & settings → Browser capture** in the Foundkeep dashboard to control capture methods, readable bookmark content, note source attachment, popup action order and recent items, right-click actions, automatic sync, OCR, summaries, tags, and success feedback. The policy belongs to the customer account and is shared by its connected Chromium browsers. Saving it asks the installed extension to refresh immediately; the extension also refreshes on startup and keeps a brief account-bound cache for offline use.

Foundkeep also reads a validated data-only operator policy. It can globally disable an existing capture or sync feature and lower packaged size limits without downloading executable code. A cached or bundled safe policy is applied immediately so an offline capture never waits for the network. JavaScript, UI, permissions, origins, schemas, and capture algorithms still require a reviewed extension update.

Changing these settings does not require an extension update. Manifest permissions, capture engine changes, security fixes, or new extension code still require an updated extension build.

## Your libraries

**Open dashboard** opens the private account library, including organized text, screenshots, capture settings, and a source record for traceable captures. **Local library** opens captures stored in this browser: browse, filter, sort, search by keyword, open details, or create a note. Local library notes follow the same account binding and sync queue as popup captures.

Local copies remain in IndexedDB. Deleting a local copy does not delete a synced account copy; use the account dashboard to manage that copy. Local **Export metadata** includes text and metadata but not image files, so it is not a complete backup. The account dashboard has its own export and account-deletion controls.

You can also use Foundkeep without an account. Disconnected captures stay local until you explicitly import them. Disconnecting keeps existing pending captures assigned to their original account. Manage and revoke connected browsers in your account dashboard.

The customer extension has no browser-control integration and does not request the debugger permission. This package supports Chromium browsers. Firefox and Safari builds are not currently shipped.

## Development checks

Run `bun run extension:build:dev` or `bun run extension:build:prod` from the repository root. Each command writes an unpacked folder, a ZIP, and its matching `customer-config.json` under `deploy/dist/extensions/dev` or `deploy/dist/extensions/prod`. Neither command edits the source identity or publishes a release. `apps/extension` remains the production source. See [environment deployment](../../docs/extension-configuration-and-updates.md#separate-development-and-production) for server configuration.

From the repository root:

```sh
bun install --frozen-lockfile --ignore-scripts
bunx playwright-core install chromium
bun run test:extension
```

Tests use temporary browser profiles and synthetic captures. Queue tests use real IndexedDB with controlled storage and API transport. The real MV3 smoke test uses Playwright’s Chromium channel. `CHROMIUM_PATH` can select an existing Chromium executable.

Run `node scripts/preview-server.mjs`; the website is at `/apps/web/` and the sample library at `/apps/extension/src/dashboard.html` on port 9048. Preview fixtures stay outside the packaged extension. Customer pairing is available only from the exact Foundkeep and legacy migration origins; integration tests rewrite a temporary extension copy for a loopback backend.
