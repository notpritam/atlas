# FoundKeep — browser extension (Chromium MV3)

Keep readable page copies, screenshots, highlights, links, images, and notes with a record of where they came from. Connect your FoundKeep account to sync new captures to a private dashboard, with a local library available offline.

## One sidebar for everything

Click the pinned FoundKeep toolbar icon to open the native sidebar directly. Save the current page, selected text, a region or a full-page screenshot; use **+** for a note. Search and edit your account library, import bookmarks, open **Local saves**, and manage your connection from **Settings** without leaving the sidebar. The panel stays open as you browse.

The initial toolbar click grants access to that page. To keep capturing after switching tabs, choose **Allow page captures** once and accept Chrome’s optional page-access prompt. Declining leaves notes and the library available. Browser-internal pages cannot be captured. Region selection happens on the page; Escape or switching tabs cancels it. A page change during a screenshot aborts the capture instead of saving the wrong tab.

## Check the environment and version

The sidebar and local library show **DEV / Production**, the installed manifest version, and the fixed cloud destination. For dev testing, use **DEV · v1.7.5 · dev.foundkeep.app**, then sign in to the same account at [your dev dashboard](https://dev.foundkeep.app/dashboard). The extension connects automatically; no Connect button is needed. That page also shows the detected extension version and destination.

Save a note named **Dev sync test**. Confirm it appears in My library at `dev.foundkeep.app` under the same account. A local save or a pending upload is not yet a cloud save. The production library at `foundkeep.app` is separate.

To update an unpacked installation, replace the files in its existing folder and click **Reload** for **FoundKeep Dev** at `chrome://extensions`. Keep the existing extension installed to preserve its local saves and queue. The dev ID is `fngoidplpdpoamenhgpabbheghpkdkcb`.

## Install or update

There are separate development and production builds. Both can be installed in the same browser:

| Build | Destination | Local data |
| --- | --- | --- |
| **FoundKeep Dev** | https://dev.foundkeep.app | Separate extension identity, credentials, queue, and `atlas-dev` IndexedDB |
| **FoundKeep** | https://foundkeep.app | Existing production identity and `atlas` IndexedDB retained |

Download [FoundKeep Dev](https://dev.foundkeep.app/ext/foundkeep-extension-dev.zip) for dev testing, or use the production Chrome Web Store installation. Each website connects only its corresponding extension. The dev build has no production auto-update feed. Keyboard shortcuts may need separate assignments when both are installed; choose the extension by name at `chrome://extensions/shortcuts`.

1. Extract the extension ZIP into a folder you can keep, or use this `apps/extension` directory.
2. Open the extensions page in Chrome, Edge, Brave, Opera, or Vivaldi, enable **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`. Chrome and Brave accept `chrome://extensions`; Edge uses `edge://extensions`.
3. Pin FoundKeep from the browser’s extensions menu.

To update an existing unpacked installation, replace its files in the existing folder and click **Reload**. Keep the existing installation to retain the local library. Uninstalling removes extension data. Managed installations can receive signed updates.

## Connect your account

Open [FoundKeep](https://foundkeep.app/dashboard), then create an account or sign in. The matching installed extension connects automatically from any dashboard page. Returning to the dashboard after installation checks again. A browser already connected to another account requires confirmation in Apps & devices; an explicit disconnect pauses automatic pairing until you choose to connect again. The website hands the extension a short-lived, one-use connection code. No developer token or separate software is required.

New captures made while an account is selected are saved locally and queued for that account. FoundKeep retries automatically after network failures when automatic sync is enabled. **Try sync again** requests an immediate retry; **Reconnect** appears if the browser credential expires or is revoked. Captures remain available locally throughout.

Existing local captures are never uploaded automatically. To include them, open **Settings → Import local captures**, review the destination account, then confirm. Switching accounts never moves captures or pending uploads between accounts. Reconnecting the original account resumes its pending captures.

## Capture

- **Popup:** save a readable copy of the current page, select a region, capture a full page, save selected text, or write a note. Notes also save with ⌘/Ctrl + Enter.
- **Right-click:** save a selection, link, image, or page; capture a region or full-page screenshot.
- **Keyboard:** `Alt+Shift+S` captures a region, `Alt+Shift+F` a full page, and `Alt+Shift+H` selected text. Change assignments at `chrome://extensions/shortcuts`.
- **X / Twitter:** the FoundKeep button in a tweet’s action bar saves the author, text, and permalink.

Page capture requires a normal web page. Chrome restricts capture on internal browser pages and certain protected pages. Notes can still be saved there. Saved images are limited to 8 MiB. A larger generated screenshot remains local with an actionable sync error.

Saving a page keeps the useful article or main text, available headings and structured page details. Its provenance record can include the exact visited URL, canonical URL, title, description, site, authors, publication and modification dates, language, lead image, favicon, capture method and timestamps, extractor version, extraction status, and a SHA-256 content fingerprint. Saved links and images also keep the containing page separately from the target. FoundKeep does not store raw page HTML.

## Capture settings

Open **Account & settings → Browser capture** in the FoundKeep dashboard to control capture methods, readable bookmark content, note source attachment, popup action order and recent items, right-click actions, automatic sync, OCR, summaries, tags, and success feedback. The policy belongs to the customer account and is shared by its connected Chromium browsers. Saving it asks the installed extension to refresh immediately; the extension also refreshes on startup and keeps a brief account-bound cache for offline use.

FoundKeep also reads a validated data-only operator policy. It can globally disable an existing capture or sync feature and lower packaged size limits without downloading executable code. A cached or bundled safe policy is applied immediately so an offline capture never waits for the network. JavaScript, UI, permissions, origins, schemas, and capture algorithms still require a reviewed extension update.

Changing these settings does not require an extension update. Manifest permissions, capture engine changes, security fixes, or new extension code still require an updated extension build.

## Your libraries

**Your library** in the sidebar searches and edits your synced account saves. **Local saves** opens an in-panel browser of local captures: search, read text, view or download images, and delete browser copies. **+** creates a note through the same durable account-bound queue as page captures. **Open dashboard** remains available for full account administration.

Local copies remain in IndexedDB. Deleting a local copy does not delete a synced account copy; use the account dashboard to manage that copy. Local **Export metadata** includes text and metadata but not image files, so it is not a complete backup. The account dashboard has its own export and account-deletion controls.

You can also use FoundKeep without an account. Disconnected captures stay local until you explicitly import them. Disconnecting keeps existing pending captures assigned to their original account. Manage and revoke connected browsers in your account dashboard.

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

Run `node scripts/preview-server.mjs`; the website is at `/apps/web/` and the sample library at `/apps/extension/src/dashboard.html` on port 9048. Preview fixtures stay outside the packaged extension. Customer pairing is available only from the exact FoundKeep and legacy migration origins; integration tests rewrite a temporary extension copy for a loopback backend.
