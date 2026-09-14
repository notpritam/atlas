# FoundKeep Store 1.0.2 release audit

Prepared 14 September 2026 for existing item `cficnecbdbiddngllpfbacabgbcjinmk`. This kit is ready for publisher review; no Store upload, submission, approval or public publication is claimed.

## Package

- Upload: `foundkeep-store-1.0.2.zip`, SHA-256 `da552d953f07d38101c469915b71e9088abd57b7786e5bc45406e09753e4144d`.
- One patch step from checked-in Store 1.0.1. Manual/dev history independently advances from 1.7.10 to 1.7.11.
- Manifest at ZIP root; Google supplies Store signing/identity/updates. No self-hosting `key` or `update_url`, private key, credential, development origin or agent-control module is packaged.
- Every Store runtime file equals the production manual build; only the manifest version/signing fields and manual README differ. Production API origin remains `https://foundkeep.app`.
- Required permissions: `activeTab`, `scripting`, `contextMenus`, `storage`, `alarms`, `sidePanel`. Optional `bookmarks`, all-site capture access and selected-image host access remain explicit customer actions. See current permission justifications in `STORE_LISTING.md`.

## Current behavior

Toolbar opens the native sidebar directly. Pages, highlights, screenshots, X posts and notes use a destination review with optional title, personal note, folder and tags. Collection submissions review audience and separate shared fields, preserving private annotations. Drafts survive a panel reload; cancellation writes nothing and account changes cannot take over a pending save.

The signed-in matching dashboard automatically connects an unpaired extension; account switching requires confirmation and explicit disconnect pauses automatic connection. Historical local captures are not automatically imported. Account-bound outbox retries and environment identities remain intact. System/light/dark appearance is shared across packaged screens.

Core saving requires no payment or AI provider. Production beta can enable complimentary Pro without a purchase, renewal or synthetic billing record; confirm live configuration before promising it to reviewers. Managed processing still requires consent, configured provider and credits. Social media preservation remains subject to source accessibility and storage/network limits.

## Evidence

- Full extension suite using full Chromium: **82 passed**, zero failures/cancellations/skips.
- Final dev and production unpacked builds: **2 native sidebar/destination checks passed each** in headed Chromium/Xvfb. Covered review/cancel/save, detailed fields, draft restoration, themes, stale tabs and account-change rejection.
- Exact final dev ZIP, with manifest/runtime unchanged, passed live dev automatic connection, titled/tagged folder delivery, private/shared collection field separation, route/focus deduplication, account-switch confirmation and explicit-disconnect pause. Temporary accounts were removed.
- Production CRX signature and runtime allowlist verified. Store package verifies deterministic bytes, version, allowed files/permissions, absence of remote executable code and correct production host.
- Exact Store 1.0.2 ZIP loaded in a disposable Chromium profile for fresh native-sidebar, detailed-review and local-reader screenshots. Local synthetic content only; no account credential or production write. `ASSET_PROVENANCE.json` identifies the input hash. Images were visually inspected and dimensions checked.

The default headless-shell browser timed out in a native panel case. Full Chromium passed the case and complete suite; no runtime change was needed. Two-backend isolation tests redirect disposable test-build destinations to loopback. Live exact-ZIP account testing used dev; the Google-assigned Store 1.0.2 binary must be checked after upload through the publisher's testing workflow.

## Review submission and access

Keep the established public item and use deferred/staged review. Do not automatically publish on approval. API v2 must explicitly send `publishType: "STAGED_PUBLISH"`, `skipReview: false` and `blockOnWarnings: true` when submitting for review. [Official publication modes](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish).

The local Linux host exposes no authenticated browser automation/session capability. It has no configured browser/CDP environment, desktop display or normal Chrome/Chromium profile metadata, and `orca-ide` is unavailable. The enrolled Mac has Chrome and Safari installed but no Orca CLI on PATH; no publisher session was established or inspected. No persisted profile, cookie database, token store or browser credential was read. These findings do not establish whether the user's own browser is signed in.

No local Store OAuth credential names were identified in normal FoundKeep/deploy configuration or the current environment. Repository secret-name inspection returned HTTP 403. Submission therefore needs an authenticated publisher browser through an available control surface, or securely supplied publisher ID plus OAuth client ID/client secret/refresh token for the Chrome Web Store scope. Google passwords should not be requested in chat. [Official API setup](https://developer.chrome.com/docs/webstore/using-api).

Before review submission, verify the dedicated reviewer credential privately and confirm production's final API/complimentary-Pro configuration and public privacy wording match this kit. The extension upload and kit are complete independently of publisher authentication.
