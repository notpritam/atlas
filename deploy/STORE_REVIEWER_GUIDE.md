# FoundKeep 1.0.2 — Chrome Web Store reviewer guide

Update existing item **`cficnecbdbiddngllpfbacabgbcjinmk`** and preserve its ID. This Store build uses production `https://foundkeep.app`. The separate FoundKeep Dev build must not be uploaded here.

## Operator preparation

1. Verify `foundkeep-store-1.0.2.zip`: root manifest, correct version, no self-hosting `key` or `update_url`, and matching kit SHA-256 checksums. Upload only this extension ZIP, not the enclosing kit.
2. Verify production config/backend still authorize Store ID `cficnecbdbiddngllpfbacabgbcjinmk` and manual ID `mjfcgmboaijfcaanepdipbgmipnccnpn`. Both already exist; preserve their allowlists. Check `https://foundkeep.app/customer-config.json`.
3. Confirm the reviewed production automatic-connection/detailed-save APIs and final privacy policy are deployed before reviewer testing. Beta access and managed processing are backend configuration, not executable extension code fetched remotely.
4. Verify the dedicated reviewer account still signs in. Supply its URL, email and password only in the private dashboard **Test instructions** field. Use existing private reviewer credentials if available; do not assume an old account/file still works. Never put credentials or recovery codes in source, listing copy, this kit, screenshots or logs.
5. Replace obsolete popup screenshots/copy with this kit's native-sidebar assets and current permission disclosures. Inspect the draft before review submission.
6. Submit with **deferred publishing**: clear automatic publication in the dashboard. API v2 requires explicit `publishType: "STAGED_PUBLISH"`, `skipReview: false`, and `blockOnWarnings: true`. Record returned review state. Do not publish a staged approval without a later public-release request. [Deferred publishing](https://developer.chrome.com/docs/webstore/publish#deferred_publishing_option), [API modes](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish).

No submitted/approved Store 1.0.2 build was available during preparation. The checked Store archive and identical manual runtime were tested unpacked. Once the uploaded package is available through the publisher's testing workflow, verify its assigned Store ID and repeat the connection/save checks below.

## Reviewer path

1. Install and pin FoundKeep. Its toolbar button opens Chrome's **native side panel**, with no toolbar popup.
2. Open an ordinary public HTTP(S) article. Choose **Save page**, review the destination, add an optional title/personal note/tags and confirm. Cancel a separate review to verify it writes nothing.
3. Without signing in, choose the local destination. Use **Local saves** in the sidebar to open the copy. Local capture needs no account, AI provider or payment.
4. Sign in at `https://foundkeep.app/login` with the privately supplied reviewer account. Opening My library automatically connects a compatible unpaired extension for that same account. If connection was explicitly paused, use the browser connection control in Apps & devices. Another connected account requires switch confirmation.
5. Create a sidebar note and review it. Select **My library**, add a title/tags, choose a folder or create one, and save. Verify delivery to the selected dashboard folder. New cloud saves commit locally first and enter an account-bound retry queue.
6. If a reviewer-owned collection is available, choose it in a new review. Read visibility/submission rules. Personal note, folder and tags stay private; only separately reviewed collection title, source link, text, shared tags and an explicitly selected image are submitted. Cancel if the audience is unintended.
7. Click the injected button on a public X post. Review its selected post text, add a note/tags, cancel once, then reopen and save. The original author/permalink/text are retained. Media preservation may complete later or report unavailable without discarding text. Private media is not automatically shared with a collection.
8. Try highlights, region/full-page screenshots and a PNG/JPEG/WebP image from the right-click menu. Visible capture paths use review. **Allow page captures** optionally requests all-site access for explicit cross-tab captures; selected-image host access is requested at final confirmation. Declining optional access leaves notes/library usable.
9. Try bookmark import. Current-browser import requests optional `bookmarks` permission; declining leaves HTML import available. Review before confirming. Browser bookmarks are never edited or deleted.
10. Try System, Light and Dark in sidebar Settings; the choice persists. Search/edit a save, open its source or local copy and inspect available preserved content.
11. Change a capture/sync preference in account settings. Detected extensions refresh immediately; otherwise cached settings refresh within five minutes. Disconnect, then refocus the dashboard: it stays disconnected until an explicit connection action.

Leave the dedicated account password/recovery code unchanged. Delete only newly created review captures when cleaning up. Use a separate disposable account for deletion/export tests.

## Complimentary Pro and optional processing

Core capture and local/private library access require no purchase. During production beta the operator can grant **complimentary Pro**. The website distinguishes this grant from a subscription: it creates no renewal or billing transaction and does not replace real paid entitlement. Once active, the account reports Pro limits (currently 2 GiB storage and 500 monthly managed-processing credits). Verify the live account response before describing the grant as active.

Managed processing still needs explicit account consent, available credits and a configured provider. A beta grant alone does not prove live AI or media resolution works. Source preservation also depends on public-source availability, network validation and storage limits. There is no purchase or developer API-key entry inside the extension.

## Data flow and boundaries

- Local captures: extension IndexedDB. Pending reviews expire in trusted session storage.
- Connection/preferences: extension-local storage; only trusted packaged UI can proxy account API calls.
- Dashboard session: HttpOnly cookie. Extension connection: separate revocable scoped bearer credential.
- Cloud copies: owner-scoped FoundKeep data. Content/media remains private unless reviewed fields are explicitly shared.
- API origin: fixed `https://foundkeep.app`; callers cannot replace it. X/Twitter bundled code stages only the selected post after a save action. Explicit image fetching uses the selected origin under optional permission.
- Remote configuration: validated JSON preferences and restrictive operator policy; no downloaded JavaScript or executable updates.
- Updates: Google signs the Store item and distributes reviewed releases. Manual/dev builds have separate identities/storage. Store installation never automatically imports their local-only data.

The reviewed target is Chrome desktop with MV3 side-panel support. Other Chromium browsers can differ in API/permission behavior and are not claimed as Store-certified. Firefox and Safari extension binaries are not included.

## Submission access

Publisher browser access or publisher-authorized API credentials are required. For API v2, securely supply the publisher ID, OAuth client ID, client secret and a refresh token authorized for `https://www.googleapis.com/auth/chromewebstore`. The publisher ID is metadata; client secrets/tokens must stay private and out of logs. A Google account password is not an API credential. [Official API setup](https://developer.chrome.com/docs/webstore/using-api).
