# Final extension beta artifacts — 14 September 2026

Prepared from the final friends-beta checkout, with one patch increment per existing version stream. This preparation pass did not deploy static assets, publish a GitHub release, upload to Chrome Web Store, or alter customer data.

## Versions and identities

| Build | Previous checked-in version | Final version | Extension ID | API origin | Local database |
| --- | --- | --- | --- | --- | --- |
| Production manual / signed | 1.7.10 | **1.7.11** | `mjfcgmboaijfcaanepdipbgmipnccnpn` | `https://foundkeep.app` | `atlas` |
| FoundKeep Dev | 1.7.10 | **1.7.11** | `fngoidplpdpoamenhgpabbheghpkdkcb` | `https://dev.foundkeep.app` | `atlas-dev` |
| Chrome Web Store | 1.0.1 | **1.0.2** | Existing Store item `cficnecbdbiddngllpfbacabgbcjinmk` | `https://foundkeep.app` | Store-isolated `atlas` |

The current published manual channel was 1.7.2 when inspected. The shared source and issued dev history had already reached 1.7.10; advancing that history once avoids a downgrade or a second per-environment version scheme. The independent Store version remains low. Rebuilding these artifacts did not increment either version again.

Production preserves its existing public key and GitHub signed update URL. Its historical trusted dashboard origin `https://atlas.notpritam.in` remains alongside `https://foundkeep.app`; its packaged API origin and required host permission are production FoundKeep. Dev permits only `https://dev.foundkeep.app` for dashboard connection and API access and has no signed update feed. The different IDs preserve separate extension storage, credentials, local databases and queues. No identity or data migration was performed.

## Artifacts

All final artifacts are under `deploy/dist/final-extension-beta-20260914/`. `artifacts.json` records file sizes and digests; `SHA256SUMS` verifies the complete distribution set.

| File relative to that directory | SHA-256 |
| --- | --- |
| `dev/foundkeep-extension-dev.zip` | `f5944a5a2659f5749fcfc49efe5a370a69e76fdfd7fbc0a633c677557ee4a842` |
| `prod/foundkeep-extension-prod.zip` | `9e4f8388c1d03715b455e2def980765a828b1507b3c4cb2dcb749c330e47dac1` |
| `signed/foundkeep-extension.zip` | `d3d8bbbe68d0cb6fd6e92fa154dfa3aa4036588fc586e45dc8a2ae6e8e660194` |
| `signed/atlas-extension.zip` | `2f42729415d096148fda1a382823b7873aabb892dc6f62a21786812382c6a11a` |
| `signed/foundkeep-extension.crx` and `signed/atlas-extension.crx` | `c03515031b7550cca50ff1ee968e1e42f36950d821e37062445200ea6ca41a42` |
| `signed/updates.xml` | `80de401e6f9463e0112a9c2f02a3743b24fea23cf66c491cae8cd0cba9e8c9a5` |
| `foundkeep-store-1.0.2.zip` | `da552d953f07d38101c469915b71e9088abd57b7786e5bc45406e09753e4144d` |

`dev/customer-config.json` and `prod/customer-config.json` accompany the builds. Both unpacked build directories are retained beside their ZIPs. The existing secure production key was used only for signing; no private key or credential is present in any archive. The signed CRX has exactly the runtime allowlist from `deploy/extension-files.json`, and every unpacked CRX runtime byte equals the tested production build. The Store ZIP has the same production runtime, a root manifest at version 1.0.2, and no `key` or `update_url` fields.

## Promotion mapping

Stage a new immutable release and retain its predecessor before switching any live symlink.

For production static downloads:

- Copy `signed/foundkeep-extension.zip` to `foundkeep-extension.zip` and `ext/foundkeep-extension.zip`.
- Copy `signed/atlas-extension.zip` to `atlas-extension.zip` and `ext/atlas-extension.zip`.
- Copy each signed CRX into `ext/` using its existing filename.
- Copy `signed/updates.xml` to `updates.xml`.
- Preserve the existing Store ID and manual ID in customer config. `prod/customer-config.json` is the generated reference.
- Publish GitHub release `ext-v1.7.11` only as part of the approved rollout, with both ZIPs, both CRXs, and `updates.xml`. The packaged update URL points at GitHub Releases; copying a CRX to the website alone does not update that feed.

For dev static downloads:

- Copy the dev ZIP to `ext/foundkeep-extension-dev.zip` and optional versioned `ext/foundkeep-extension-dev-1.7.11.zip`.
- Replace **all four generic aliases**, `foundkeep-extension.zip`, `atlas-extension.zip`, `ext/foundkeep-extension.zip`, and `ext/atlas-extension.zip`, with the same dev ZIP.
- Copy `dev/customer-config.json` to `customer-config.json`.
- Remove copied production CRXs and update manifests from the new dev release. Keep the dev backend extension allowlist restricted to the dev ID.

The inspected dev static release contained a stale generic 1.7.7 ZIP even though newer versioned dev packages existed. Verify every alias after promotion; a versioned URL check alone is insufficient. Website/backend/mobile promotion belongs to the coordinating release task.

## Verification

- `CHROMIUM_PATH=/home/pritam/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome bun run test:extension`: **82 passed**, zero failures, cancellations or skips. Includes actual capture engines, detailed review, account-bound durable queues, separate dev/prod browser storage and cloud databases, cross-environment token rejection, offline dev capture while production syncs, themes, image permission timing, and deterministic package checks.
- Headed Chromium/Xvfb with `FOUNDKEEP_TEST_EXTENSION` set to each final unpacked build: **2 native sidebar/destination tests passed for dev and 2 for production**. These verify toolbar configuration, in-panel note save/local reader/settings, no horizontal overflow, X review/cancel/confirmation, exact post metadata, persisted title/note/tags across reload, stale-tab rejection, and account-change rejection. The ZIP entries were compared byte-for-byte with these tested directories.
- The **exact final dev ZIP**, extracted without changing its manifest or runtime, passed `tests/next-extension-autoconnect.mjs` against `https://dev.foundkeep.app` through a temporary harness that substituted ZIP extraction for the normal build step. Covered automatic pairing, a titled/tagged note reaching its selected folder, collection-only reviewed text/tags, preservation of the separate private note/tags, route/focus deduplication, account-switch confirmation, and explicit-disconnect pause. The test deleted its temporary accounts; existing dev accounts were preserved.
- The initial suite without `CHROMIUM_PATH` used the default headless-shell path and timed out in the native X destination case. The same case passed in headed Chromium and then in full headless Chromium; the complete final suite passed with the explicit browser binary. No extension runtime change was needed.
- Production CRX signature, canonical public identity, version and update manifest verified with `deploy/verify-release.mjs` pointed at the isolated signed artifact directory.
- Store packaging verifies deterministic ZIP bytes, allowed permissions/files, required description length, production-only API host, no private keys, no remote executable code, and correct 1.0.2 manifest. Its existing test now reads `deploy/store-version.txt` instead of hardcoding 1.0.1.
- Light/dark detailed-save screenshots were visually inspected at the narrow sidebar size. Validation logs and screenshots are retained in the artifact directory's `verification/` folder.

The two-backend browser isolation test changes only its disposable test builds' destinations to loopback fixtures. The exact final ZIP live test covers the dev origin. No production test account was created by this preparation pass.

## Chrome Web Store submission status

The upload archive is prepared for the **existing** Store item. No new item or public publication was attempted. Metadata inspection found no relevant Chrome Web Store OAuth credentials in the current environment or the normal local FoundKeep/deploy configuration locations. Listing repository secret names through GitHub returned HTTP 403, so those credentials could not be established through that channel either. No secret values were printed or copied.

Submission needs publisher access or an available Store OAuth credential. Existing `deploy/STORE_LISTING.md`, `deploy/STORE_REVIEWER_GUIDE.md`, and the old submission kit still refer to 1.0.1 and predate the final sidebar review; do not upload the old kit as a current 1.0.2 handoff. Update reviewer materials and current screenshots when preparing the authorized Store submission. This blocker affects Store submission, not the prepared signed/manual beta packages.
