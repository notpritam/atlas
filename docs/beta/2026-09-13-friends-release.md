# Friends beta — 13 September 2026

The production web and browser-extension beta are available at **https://foundkeep.app/beta**. Permanent dev remains Pritam-only at **https://dev.foundkeep.app**. The signed Android APK is also available. iOS external TestFlight access, remote-media integration and production Pro configuration remain open; this is not a completed all-device launch.

## Available now

- Production dashboard, scoped MCP create/update/organization/links, canvas mind map, public/private collections and moderation controls.
- Full-width public collections with dashboard-style, natural-height image and note masonry, a compact introduction and inline contribution rules.
- Shared light/dark appearance. Compact controls use a sun/moon icon button with accessible labels; Settings retains Light/Dark/System. Both websites now use Inter, pure-black surfaces, denser desktop navigation and full saved readers; [details](../ux/compact-reader.md). Signed native builds include their own verified light/dark interface at mobile source `76e6ecf`.
- Production extension ZIP: https://foundkeep.app/foundkeep-extension.zip. Unzip, load its extension folder in Chrome's Developer mode, and connect it through Apps & devices. Existing production local data/identity remain separate from Foundkeep Dev.
- Signed Android APK: https://foundkeep.app/downloads/foundkeep-android-1.0.0-5.apk. The [beta page](https://foundkeep.app/beta) includes installation steps and the checksum link.
- Desktop: use the production dashboard and browser extension. The web manifest opens the installed web app at `/dashboard`; the legacy Atlas native dock is not distributed.
- Private dev demo: https://dev.foundkeep.app/collection/demo-design-that-works. Demo seeding is additive and was not run in production.

## Verification

The final code review passed at `884120a`; native follow-ups passed scoped review through `76e6ecf`. The latest backend tests passed 255/255 with 2,217 assertions; mobile tests passed 94/94, plus mobile/backend/site typechecking. Installed native checks remain separate release gates. Web covering tests passed, including public masonry, appearance, graph, processing, authentication and public metadata checks.

After production promotion, an actual MCP SDK connected to `https://foundkeep.app/api/mcp` with a temporary scoped token. It created two saves, updated context, linked them, and exposed the relationship in the real canvas graph. Desktop/phone appearance switching, saved-item navigation and token revocation passed. Browser runtime errors: zero.

The live production extension journey passed signup, recovery acknowledgement, pairing, preference sync, note/highlight/article/screenshot capture, readable article metadata, screenshot OCR, bookmark import and connection revocation. The test now opens “Continue with email” when production social providers are present. No production auth behavior was changed for the test.

Both temporary QA accounts and their data were deleted. The original production inventory remained **4 accounts, 28 captures and 5 extension connections**; ID-set preservation and SQLite integrity were verified. Production was not seeded. Existing dev accounts, data, authentication and Paddle sandbox were preserved.

Live evidence is under `.impeccable/review/friends-beta/live/` and `.impeccable/review/friends-beta/production/`. The release controller's full logs are outside the repository under `/tmp/foundkeep-beta-*`.

## Release pointers and rollback

| Service | Current release |
| --- | --- |
| Production website | `/home/pritam/.local/share/foundkeep-site/releases/20260913-123918-beta-distribution` |
| Production backend/static | `/home/pritam/.local/share/foundkeep-backend/releases/20260913-native-notes-ab4c082` |
| Dev website | `/home/pritam/.local/share/foundkeep-site-dev/releases/20260913-123822-beta-distribution` |
| Dev static | `/home/pritam/.local/share/foundkeep-dev-web/releases/20260913-104300-friends-beta` |

The latest dev website backup is `/home/pritam/.local/share/foundkeep-dev/backups/20260913-124251-android-beta5`; production is `/home/pritam/.local/share/foundkeep-production-backups/20260913-124313-android-beta5`. Website revision `6284edd` was activated on dev at **12:42:52Z**, then production at **12:43:15Z**, after standalone build/typecheck, task review and staged browser verification. Live desktop/phone checks passed in both realms with no overflow or runtime errors. The public APK matches the signed artifact hash and size below.

The immediately previous website releases remain available: production `20260913-105647-android-share`, dev `20260913-115909-compact-reader`. Saved pointer records support code rollback; do not replace a live database with an older backup over new customer writes. The production backend remains immutable release `20260913-native-notes-ab4c082`; its only subsequent restart enabled the verified Android App Links certificate at **12:44Z**. New remote-media code is not deployed there yet.

The initial production backup and prior service overrides remain at `/home/pritam/.local/share/foundkeep-production-backups/20260913-101226-friends-beta`. Original IDs were reconfirmed after signed Android QA cleanup at **12:34:31Z**: 4 accounts, 28 captures, 5 connections, SQLite integrity `ok`. Evidence is `.impeccable/review/friends-beta/signed-android-preservation.json` and `distribution/{staged-dev,staged-prod,live-dev,live-prod}/`.

Production extension allowlist includes the existing store ID `cficnecbdbiddngllpfbacabgbcjinmk` and manual-install ID `mjfcgmboaijfcaanepdipbgmipnccnpn`. It excludes dev ID `fngoidplpdpoamenhgpabbheghpkdkcb`. Both ZIPs are version 1.7.1:

| Artifact | Bytes | SHA-256 |
| --- | --- | --- |
| Production extension | 128339 | `28cf104338efe6105bb1645f462b0f3a7be8b95db020364c1b520836afd7e9c2` |
| Dev extension | 128184 | `ffe66170e47197d8301fd9b81040b7c9cf726d71a3d88448638fcc9ad3c23a1a` |

## Mobile distribution

Friends builds use production APIs and the `production-beta` OTA channel. Pritam profiles use dev APIs and the `dev` channel. Both retain the canonical iOS app `app.foundkeep.ios`, share extension/group, Android package `app.foundkeep.android` and `foundkeep` scheme. Environment-specific credentials, queues and caches remain isolated. Installing a different realm binary replaces the other binary on the same device.

**iOS:** the current candidate is version **1.0.0 (21)**, built from frozen mobile/shared source `76e6ecf` and uploaded to existing App Store Connect app **6809771188**. [Submission](https://expo.dev/accounts/notpritam/projects/foundkeep/submissions/ea2dc508-9fc6-47fd-80f6-f425624c14a1) succeeded. Apple API verification at **2026-09-13T12:30:35.839Z** confirmed build 21 (`aa33333f-63d7-4187-b785-73573160203e`) is **VALID**, internally **READY_FOR_BETA_TESTING**, and externally **READY_FOR_BETA_SUBMISSION**. The existing Foundkeep Internal group is unchanged. External review still needs real contact details; no tester join URL or external-review submission is claimed.

The IPA at `/Users/notpritamm/.local/share/foundkeep-builds/20260913-friends-ios21/FoundKeep.ipa` is **23,821,626 bytes**, SHA-256 `81805a732bacc98043f36c95ac1d83a2b5a93c451085c64ff063d17c33c8c1cc`. Actual bundled runtime is `3fe4cb50f983381c10a005f79f00c3d65e01840c`. Production origin/channel, canonical app/share-extension/team/App Group/keychain entitlements, App Store provisioning and both deep strict signatures passed. The actual EAS build tree matched 111 frozen mobile/shared source files and the repository lockfile. Previous build20/IPA remains retained unchanged. EAS reported two existing Expo Doctor dependency checks; these did not prevent the signed archive/export. Native simulator verification below is separate from installed TestFlight verification.

Check availability in [App Store Connect](https://appstoreconnect.apple.com/apps/6809771188/testflight/ios). No invitation, external-review or public-store action was invoked. Apple's existing `autoNotifyEnabled=true` value was observed, not changed. Full release evidence: `.impeccable/review/friends-beta/ios-release/` and `.superpowers/sdd/2026-09-13-friends-beta/ios-release-followup-report.md`.

The later `ab4c082` iOS simulator candidate passed native login, Light/Dark/System changes on populated screens, preference/session restoration, native note creation (`ios-app-note`), real Safari share (`ios-share-url`), logout and the signed-out share guard. Production API checks confirmed both saves. Its dedicated QA account and two saves were deleted, and the old session returned 401. This verifies the simulator candidate, not an installed TestFlight build or physical device; the signed build21 now includes these shared native fixes, while build20 remains retained unchanged. Root independently reconfirmed all original production IDs and counts (4 accounts, 28 captures, 5 connections), with SQLite integrity `ok`, at **2026-09-13T11:38:35Z**.

**Android:** the signed production APK is publicly available and passed installed-artifact verification.

The signed Android build has now passed its final artifact gate. The APK is `/Users/notpritamm/Developer/foundkeep-friends-android-20260913/dist/foundkeep-friends-android-production-beta.apk`, **107,242,309 bytes**, SHA-256 `d437266a3d16dbb0ad79f2a54390578844a680e48f29605b7826fce0655b6f2a`. It uses package `app.foundkeep.android`, version **1.0.0 (5)**, production API `https://foundkeep.app`, channel `production-beta`, runtime `6ca4757677af90ad84a97820f1affae01c0b9f76` and exact source `76e6ecf`. arm64-v8a, armeabi-v7a, x86 and x86_64 are present; the app is non-debuggable and contains no QA instrumentation. APK Signature Scheme v2 verification passed and the certificate matches the preserved signing key: `03:A3:D5:29:1D:F5:AF:FC:6E:2B:54:A0:97:35:5C:B6:50:5B:89:8F:F6:AF:BA:14:31:FB:22:81:1C:2E:DE:A0`. The private Linux copy at `~/.local/share/foundkeep-beta-artifacts/android/20260913-version5/foundkeep-friends-android-production-beta.apk` and the public download both match this exact hash. No Play URL is claimed; Play's app-signing certificate would be a separate value.

Installed Android checks use an isolated x86_64, debug-key-signed release variant at `~/.local/share/foundkeep-native-check`; this artifact must not be given to friends. Native production login, secure session restoration, warm text and cold URL shares passed against a disposable QA account. The final native candidate at `76e6ecf` also passes hot light/dark surface, text and icon changes while preserving search focus/value and note drafts. Native notes carry `android-app-note` provenance.

Actual MediaStore PNG, PDF and MP4 shares completed production uploads with matching original filenames, MIME, platform/method and byte hashes, verified at **2026-09-13T11:29:40Z**. Native ContentResolver streaming replaces the unsupported Expo content-URI copy; durable queue renames are awaited, and byte uploads preserve their declared MIME. The temporary Android account and its test data were deleted. Evidence: `~/.local/share/foundkeep-native-check/evidence/media-originals-verification.json`. These source-level file tests remain distinct from the signed-artifact checks below.

The exact transferred signed version5 APK was then installed on the disposable API36 AVD. Production login, native note, URL share, real MediaStore PDF share, native file download with matching original bytes, and logout passed; the app runtime error scan found none. Its own QA account/captures and private credentials were removed. Evidence: `~/.local/share/foundkeep-native-check/evidence/signed-v5-final-verification.json`.

Android App Links remain **pending verification**: production `/.well-known/assetlinks.json` returns the exact package/certificate/relation, but Google's Digital Asset Links response currently has no statement and `maxAge: 3600s`; the device reports state1024. The backend certificate was configured at12:44Z, so retry after cache expiry. Ordinary HTTPS links currently resolve through Android/Chrome rather than verified automatic app opening. No OS verification state or app selection was forced. Evidence: `signed-v5-applinks-final-verification.json` beside the installed checks.

## Production Pro and remote-media gates

Production currently has no OpenAI, live Paddle or RevenueCat credentials configured. Checkout and managed processing remain unavailable. Dev retains its existing provider configuration and Paddle sandbox. The choices of an intended production AI key and capped temporary friends Pro access versus normal checkout are pending; no credentials have been copied and no entitlements fabricated. Never copy sandbox billing credentials into production.

Free accounts can connect their own scoped MCP agents. Accessible captured text, article content and image originals remain available. Preview-only social metadata is not treated as full video understanding. Empty/unusable source jobs do not consume a processing credit.

The guarded downloader boundary is complete at `6e927bb`, with independent review approval, 22 Bun tests/130 assertions, 15 Python tests and backend typecheck passing. It has isolated executable configuration, public-address guards across redirects/socket connections, bounded response/file/time/resource use, actual MP4 validation, and explicit unsupported/unavailable results. See [media runtime](media-runtime.md).

Real post-fix downloads on13September passed original-byte/hash/cleanup verification:

| Source | Downloaded bytes | Duration |
| --- | ---: | ---: |
| MDN CC0 flower MP4 | 1,128,375 | 5.055s |
| Public Instagram reel | 918,120 | 4.967s |
| X history video | 1,404,023 | 15.557s |
| X Brooklyn Nets media session | 6,190,690 | 324.501s |

The tested YouTube sample was refused by an upstream sign-in/bot challenge. An older X sample points to an unavailable media host. Neither is presented as a successful download; no authentication bypass was attempted. Only actual accessible subtitle text is included. The current runtime accepts bounded compatible progressive MP4 streams; adaptive-only, live and unsupported media remain explicitly unavailable. Evidence: `~/.local/share/foundkeep-beta-media-samples/fix1-verification.json` and `fix1-x-verification.json`.

Task6b is now integrating this boundary with durable owner-scoped saved files, Pro consent/timing/credits, storage quotas, playback/range responses and cancellation/source-edit guards. The new downloader is **not yet enabled in either real backend**. Existing uploaded-file tests do not prove remote Instagram/X/YouTube integration. UI work is frozen while shipping proceeds.

The goal remains open for remote-media integration and final friends journeys, intended production provider/Pro setup, external iOS tester/review access and Android link verification. Public App Store/Play rollout requires the later release instruction.
