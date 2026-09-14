# FoundKeep — Chrome Web Store 1.0.2 submission

Upload `deploy/dist/foundkeep-store-1.0.2.zip` to the existing item **`cficnecbdbiddngllpfbacabgbcjinmk`**. The enclosing submission kit is a handoff archive, not the extension upload. Keep the established Store identity and existing public listing. Neither archive contains credentials.

This release is authorized for preparation and review submission. **Defer publishing after approval** and leave the existing public version available until a separate public-release request. In the dashboard, clear automatic publication in the review confirmation. With API v2, explicitly use `publishType: "STAGED_PUBLISH"`, `skipReview: false`, and `blockOnWarnings: true`. Do not use default publication mode. [Google's deferred publishing instructions](https://developer.chrome.com/docs/webstore/publish#deferred_publishing_option), [API publication modes](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish).

## Listing copy

**Name:** FoundKeep — Save what matters

**Category:** Productivity
**Language:** English

**Short description:**

> Save readable pages, screenshots, highlights, images and notes with original source details in a private, searchable library.

**Description:**

FoundKeep gives the useful things you find on the web a place to stay.

- Open FoundKeep from the browser toolbar to keep your library in a native sidebar beside the page.
- Save readable pages, highlights, screenshots, images, X posts and quick notes with their original source.
- Review each save first: choose a destination, add a title and personal note, organize it in a folder, and choose or create tags.
- Keep personal notes, folders and tags private when submitting selected fields to a collection. Review the collection's audience before confirming.
- Sign in at foundkeep.app to connect a matching, unpaired extension automatically. Switching an existing connection to another account requires confirmation.
- Save locally first. New saves sync to your connected account when automatic sync is enabled; offline saves stay in this browser until they can upload.
- Search and edit your library in the sidebar, browse local saves, and choose system, light or dark appearance.
- Import bookmarks and nested folders from the browser or an HTML export after reviewing the import. FoundKeep never changes browser bookmarks.
- Control capture methods, page details, context menus, sync and optional organization from account settings.
- Connect your own MCP-compatible agent with optional, scoped and revocable dashboard access.

An account is optional for local capture. Older local saves stay on the device until you explicitly import them into an account. Local and cloud copies are separate.

Saved pages can retain readable text, headings, source and canonical URLs, title, description, publisher, author, dates, language, images, capture method, timestamps and a content fingerprint when available. FoundKeep does not store raw page HTML. For supported saved social posts, the service can try to retain available source photos, videos and linked article content in your private library. Availability depends on the source, access and storage limits; saving text does not guarantee every media file can be preserved.

Free accounts include up to 10,000 cloud saves and 200 MiB storage, subject to service capacity. Optional Pro access provides more storage and managed processing within account limits. During beta, accounts may receive complimentary Pro without a purchase. This grant does not create a subscription, renewal or payment history. Managed AI processing still requires account consent and an available configured provider. Capture and local saving do not require an AI provider or payment.

Password accounts receive a one-time recovery code; FoundKeep does not send password-reset email. Export and account-deletion controls are in settings.

**Homepage:** https://foundkeep.app
**Privacy policy:** https://foundkeep.app/privacy
**Support:** https://foundkeep.app/support

## Single purpose and permissions

**Single purpose:** Save web content explicitly chosen by the customer into a private local or connected library, with source details and customer-controlled organization so it can be found again. Collection sharing requires a separate destination and field review.

Use these justifications in the Privacy tab:

- `activeTab`: Temporarily access the active page after invoking FoundKeep, to read selected content/source metadata or capture visible pixels.
- `scripting`: Run bundled extraction and screenshot-selection code after an explicit capture action. Full-page capture scrolls and stitches the selected page.
- `contextMenus`: Offer explicit right-click save actions for pages, highlights, links, images and screenshots. These open the common destination review.
- `storage`: Retain the account-bound browser credential, preference/policy cache and durable upload state. Capture bytes use extension IndexedDB. Pending reviews expire in trusted session storage; credentials are not exposed to websites or content scripts.
- `sidePanel`: Keep capture controls, save review, private-library search/editing, local saves, imports and settings beside the page. The toolbar opens this panel directly and has no popup.
- `alarms`: Retry pending customer-selected uploads and refresh account preferences after temporary failures or browser restarts.
- Optional `bookmarks`: Read the bookmark tree only after the customer selects import and grants access. Preserve available titles, URLs, folders and dates without editing or deleting browser bookmarks. HTML import remains available if permission is declined.
- Required host `https://foundkeep.app/*`: Pair the browser, refresh data-only settings/policy and access the customer's library and uploads through fixed FoundKeep routes.
- Optional `<all_urls>` and HTTP(S) hosts: The visible **Allow page captures** control can request all-site access so explicit sidebar captures continue across tabs; Chrome screenshots require active-tab or all-site access. This is optional and never requested on installation. A right-click image save requests the selected image's exact origin at final confirmation. These grants support customer-triggered capture, not passive browsing collection.
- X/Twitter content script: Bundled code on `x.com` and `twitter.com` adds a per-post save button. Clicking it opens review with the selected post's text, author, permalink and available attachment/link hints, excluding neighboring posts.
- External messaging: Only `https://foundkeep.app` and exact historical origin `https://atlas.notpritam.in` can detect, connect or refresh the extension. A matching signed-in dashboard can issue a short-lived one-use connection code. Account switching requires confirmation; explicit disconnect pauses automatic connection. Websites cannot read extension credentials or replace the API origin.

There is no debugger permission, remote browser-control feature, advertising, data sale or tracking of general browsing activity.

## Privacy-tab data answers

**Remote code:** Select **No, I am not using remote code**. FoundKeep executes only code/assets included in this package. JSON preferences and operator policy cannot add executable code, permissions, hosts or capture behavior. Responses are never evaluated as JavaScript.

**User data:**

- **Personally identifiable information:** Connected account name and email.
- **Authentication information:** Scoped, revocable FoundKeep credential stored in the extension and sent only to FoundKeep over HTTPS.
- **Location:** Request IP addresses for short-lived rate limiting. No device geolocation request.
- **Web history:** URL, title and source details only when a page is explicitly saved.
- **Website content:** Selected readable text, posts, screenshots, images, highlights and notes. Optional source preservation can retain available chosen-post media and linked articles. Collections receive only explicitly reviewed shared fields and images selected for sharing.
- **Financial and payment information:** Optional account subscription status and purchase history in the connected service. Web payments use Paddle; existing Stripe subscriptions may be retained. Apple/RevenueCat handles supported native purchases. The extension has no card-entry/checkout UI and never receives raw card numbers. Complimentary beta Pro grants access without a purchase or fabricated billing records.

No separate health, communications or activity-monitoring feature is present. Saved content is chosen by the customer and may contain personal information; it is processed for the requested library, sharing and optional organization features. Certify Limited Use statements only after confirming these answers agree with the deployed [privacy policy](https://foundkeep.app/privacy).

## Distribution and assets

Keep existing visibility, regions, Store ID and public link. This preparation creates no second beta item and changes no distribution scope. The extension is free; account upgrades are optional. Submit for review with **deferred publishing**, and do not deploy a staged approval without the later public-release request.

Provide a verified dedicated reviewer account only in the private dashboard Test instructions field. Never place passwords or recovery codes in source, listing copy, this kit, screenshots or logs.

Fresh 1.0.2 kit assets under `assets/`:

- `native-sidebar.png` — native sidebar and local-save controls, 1280 × 800.
- `save-review.png` — detailed save review, 1280 × 800.
- `local-library.png` — local note reader, 1280 × 800.
- `promo-small.png` — 440 × 280 tile.
- `promo-marquee.png` — optional 1400 × 560 tile.
- `icon128.png` — packaged 128 × 128 icon.

Screenshots use the exact Store archive loaded in a fresh disposable browser profile with synthetic local content and no account credentials. `ASSET_PROVENANCE.json` records the input hash and capture method. See `STORE_RELEASE_AUDIT.md` and `STORE_REVIEWER_GUIDE.md`. The self-hosted 1.7.11 ZIP/CRX is a separate channel and must not be uploaded to the Store.
