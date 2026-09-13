# Friends beta — 13 September 2026

The production web and browser-extension beta are available at **https://foundkeep.app/beta**. Permanent dev remains Pritam-only at **https://dev.foundkeep.app**. Mobile distribution and production Pro configuration are still pending; this is not a completed all-device launch.

## Available now

- Production dashboard, scoped MCP create/update/organization/links, canvas mind map, public/private collections and moderation controls.
- Full-width public collections with dashboard-style, natural-height image and note masonry, a compact introduction and inline contribution rules.
- Shared light/dark appearance. Compact controls use a sun/moon icon button with accessible labels; Settings retains Light/Dark/System. The latest dev-only UI refinement uses Inter, pure-black surfaces, denser desktop navigation and full saved readers; [details](../ux/compact-reader.md). Native binaries and production retain their earlier visual release.
- Production extension ZIP: https://foundkeep.app/foundkeep-extension.zip. Unzip, load its extension folder in Chrome's Developer mode, and connect it through Apps & devices. Existing production local data/identity remain separate from Foundkeep Dev.
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
| Production website | `/home/pritam/.local/share/foundkeep-site/releases/20260913-105647-android-share` |
| Production backend/static | `/home/pritam/.local/share/foundkeep-backend/releases/20260913-native-notes-ab4c082` |
| Dev website | `/home/pritam/.local/share/foundkeep-site-dev/releases/20260913-115909-compact-reader` |
| Dev static | `/home/pritam/.local/share/foundkeep-dev-web/releases/20260913-104300-friends-beta` |

The latest dev and production online backups are under their respective backup roots at `20260913-111551-native-notes`, before the backend-only native note provenance deployment. The earlier `20260913-105925-android-share` backups retain the `884120a` website/backend release pointers. The `d628178` website adds explicit Android capture provenance and matching web labels, preserving existing extension artifacts and configuration. Both standalone web releases and public health checks passed. A real installed Android text share reached production and rendered “Android” in the deployed web dashboard with zero browser runtime errors. The final `76e6ecf` fix only changes Android runtime code and does not require another backend release.

The earlier production online backup, before/after records and previous systemd overrides are retained at `/home/pritam/.local/share/foundkeep-production-backups/20260913-101226-friends-beta`. A copy of that database successfully migrated before the real service switch. Previous release directories remain available.

The previous production website is `/home/pritam/.local/share/foundkeep-site/releases/20260912-agentic-hydration`; the previous backend is `/home/pritam/.local/share/foundkeep-backend/releases/20260912-billing-9a93b05`. Roll back code using the saved website pointer/backend override and restart only the affected production services. Do not replace the current database with an older backup over new customer writes.

Production extension allowlist includes the existing store ID `cficnecbdbiddngllpfbacabgbcjinmk` and manual-install ID `mjfcgmboaijfcaanepdipbgmipnccnpn`. It excludes dev ID `fngoidplpdpoamenhgpabbheghpkdkcb`. Both ZIPs are version 1.7.1:

| Artifact | Bytes | SHA-256 |
| --- | --- | --- |
| Production extension | 128339 | `28cf104338efe6105bb1645f462b0f3a7be8b95db020364c1b520836afd7e9c2` |
| Dev extension | 128184 | `ffe66170e47197d8301fd9b81040b7c9cf726d71a3d88448638fcc9ad3c23a1a` |

## Mobile distribution still pending

Friends builds use production APIs and the `production-beta` OTA channel. Pritam profiles use dev APIs and the `dev` channel. Both retain the canonical iOS app `app.foundkeep.ios`, share extension/group, Android package `app.foundkeep.android` and `foundkeep` scheme. Environment-specific credentials, queues and caches remain isolated. Installing a different realm binary replaces the other binary on the same device.

**iOS:** version 1.0.0, build **20**, was signed, deeply verified and successfully uploaded to existing App Store Connect app **6809771188**. Submission: https://expo.dev/accounts/notpritam/projects/foundkeep/submissions/d9ddc5b3-dcd5-4ed7-929b-fd2d13df6eff. The IPA is 23,815,957 bytes, SHA-256 `f1822edd4e99d5349d5ba8595bfe07e84ffe410b5c8305912d44bd46282bddde`; bundled runtime is `3fe4cb50f983381c10a005f79f00c3d65e01840c`. Canonical identity, production origin, channel and signing passed. The later Android-only autolinking fix does not change iOS native source. Apple API verification at **2026-09-13T10:53:57Z** confirmed build 20 is **VALID**, internally **READY_FOR_BETA_TESTING**, and externally **READY_FOR_BETA_SUBMISSION**. There is no public tester join link; installed iOS simulator checks are underway.

The IPA remains on MacBook Pro Work at `~/.local/share/foundkeep-builds/20260913-friends-ios20/FoundKeep.ipa`. Check processing/group availability in https://appstoreconnect.apple.com/apps/6809771188/testflight/ios. External beta review still needs the owner's real review-contact information; none was invented. No invitations or public store release were sent.

The later `ab4c082` iOS simulator candidate passed native login, Light/Dark/System changes on populated screens, preference/session restoration, native note creation (`ios-app-note`), real Safari share (`ios-share-url`), logout and the signed-out share guard. Production API checks confirmed both saves. Its dedicated QA account and two saves were deleted, and the old session returned 401. This verifies the simulator candidate, not an installed TestFlight build or physical device; signed build 20 remains unchanged and predates the shared native appearance follow-ups. Root independently reconfirmed all original production IDs and counts (4 accounts, 28 captures, 5 connections), with SQLite integrity `ok`, at **2026-09-13T11:38:35Z**.

**Android:** the first signed local EAS build reached Gradle but failed because Expo selected a precompiled `expo-sharing` publication while the bridge requires its source Gradle project. `5fbe3c5` enables Android `buildFromSource: ["expo-sharing"]` and repairs a clean-install fingerprint test import. Focused tests, all 86 mobile tests, typechecking and scoped code review passed. The Mac later recovered, verified through completed file reads and terminal execution. An isolated Linux API 36 emulator build successfully compiled the native bridge; the signed distribution retry awaits installed fixes below.

The signed Android build has now passed its final artifact gate. The APK is `/Users/notpritamm/Developer/foundkeep-friends-android-20260913/dist/foundkeep-friends-android-production-beta.apk`, **107,242,309 bytes**, SHA-256 `d437266a3d16dbb0ad79f2a54390578844a680e48f29605b7826fce0655b6f2a`. It uses package `app.foundkeep.android`, version **1.0.0 (5)**, production API `https://foundkeep.app`, channel `production-beta`, runtime `6ca4757677af90ad84a97820f1affae01c0b9f76` and exact source `76e6ecf`. arm64-v8a, armeabi-v7a, x86 and x86_64 are present; the app is non-debuggable and contains no QA instrumentation. APK Signature Scheme v2 verification passed and the certificate matches the preserved signing key: `03:A3:D5:29:1D:F5:AF:FC:6E:2B:54:A0:97:35:5C:B6:50:5B:89:8F:F6:AF:BA:14:31:FB:22:81:1C:2E:DE:A0`. Transfer to private Linux staging is underway; no public APK or Play URL is claimed until the hosted bytes are verified. Play's app-signing certificate is a separate value.

Installed Android checks use an isolated x86_64, debug-key-signed release variant at `~/.local/share/foundkeep-native-check`; this artifact must not be given to friends. Native production login, secure session restoration, warm text and cold URL shares passed against a disposable QA account. The final native candidate at `76e6ecf` also passes hot light/dark surface, text and icon changes while preserving search focus/value and note drafts. Native notes carry `android-app-note` provenance.

Actual MediaStore PNG, PDF and MP4 shares completed production uploads with matching original filenames, MIME, platform/method and byte hashes, verified at **2026-09-13T11:29:40Z**. Native ContentResolver streaming replaces the unsupported Expo content-URI copy; durable queue renames are awaited, and byte uploads preserve their declared MIME. The temporary Android account and its test data were deleted. Evidence: `~/.local/share/foundkeep-native-check/evidence/media-originals-verification.json`. Signed APK verification is complete; hosted distribution and installed signed-artifact checks remain distinct from these emulator-source checks.

## Production Pro and parsing limits

Production currently has no OpenAI, live Paddle or RevenueCat credentials configured. Checkout and managed processing remain unavailable. Dev retains the working Paddle sandbox and its existing provider configuration. Do not copy sandbox billing credentials into production or invent Pro entitlements. Production configuration requires the intended live provider credentials before a paid journey can be verified.

Free accounts can connect their own scoped MCP agents. Accessible captured text, article content and image originals remain available. Protected social posts and links without transcripts retain honest metadata/availability states; preview-only YouTube/X/Instagram data is not treated as full video understanding. Empty/unusable source jobs do not spend a processing credit. The UI labels unsupported downloading/transcription features as future work.

The latest launch request explicitly adds real remote video downloading to the release gate. Task 6 now implements a bounded downloader for accessible public sources, followed by owner-scoped storage/processing integration and real sample verification. Existing uploaded-file tests do not prove remote Instagram/X/YouTube downloads. Desktop beta uses the production dashboard and extension; the old Atlas personal-token Electron dock is not a customer release. The completed UI is frozen while shipping work proceeds.

The launch goal remains open until actual mobile distribution/device checks, remote-media integration and required production provider setup are resolved. Public App Store/Play rollout requires the later release instruction.
