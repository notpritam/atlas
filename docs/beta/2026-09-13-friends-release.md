# Friends beta — 13 September 2026

The production web and browser-extension beta are available at **https://foundkeep.app/beta**. Permanent dev remains Pritam-only at **https://dev.foundkeep.app**. Mobile distribution and production Pro configuration are still pending; this is not a completed all-device launch.

## Available now

- Production dashboard, scoped MCP create/update/organization/links, canvas mind map, public/private collections and moderation controls.
- Full-width public collections with dashboard-style, natural-height image and note masonry, a compact introduction and inline contribution rules.
- Shared light/dark appearance. Compact controls use a 48px sun/moon icon button with accessible labels; Settings retains Light/Dark/System.
- Production extension ZIP: https://foundkeep.app/foundkeep-extension.zip. Unzip, load its extension folder in Chrome's Developer mode, and connect it through Apps & devices. Existing production local data/identity remain separate from Foundkeep Dev.
- Private dev demo: https://dev.foundkeep.app/collection/demo-design-that-works. Demo seeding is additive and was not run in production.

## Verification

The final code review passed at `884120a`; the Android build follow-up passed review at `5fbe3c5`. Backend tests passed 254/254 with 2,215 assertions; mobile tests passed 86/86, plus typechecking. Web covering tests passed, including public masonry, appearance, graph, processing, authentication and public metadata checks.

After production promotion, an actual MCP SDK connected to `https://foundkeep.app/api/mcp` with a temporary scoped token. It created two saves, updated context, linked them, and exposed the relationship in the real canvas graph. Desktop/phone appearance switching, saved-item navigation and token revocation passed. Browser runtime errors: zero.

The live production extension journey passed signup, recovery acknowledgement, pairing, preference sync, note/highlight/article/screenshot capture, readable article metadata, screenshot OCR, bookmark import and connection revocation. The test now opens “Continue with email” when production social providers are present. No production auth behavior was changed for the test.

Both temporary QA accounts and their data were deleted. The original production inventory remained **4 accounts, 28 captures and 5 extension connections**; ID-set preservation and SQLite integrity were verified. Production was not seeded. Existing dev accounts, data, authentication and Paddle sandbox were preserved.

Live evidence is under `.impeccable/review/friends-beta/live/` and `.impeccable/review/friends-beta/production/`. The release controller's full logs are outside the repository under `/tmp/foundkeep-beta-*`.

## Release pointers and rollback

| Service | Current release |
| --- | --- |
| Production website | `/home/pritam/.local/share/foundkeep-site/releases/20260913-102000-friends-beta` |
| Production backend/static | `/home/pritam/.local/share/foundkeep-backend/releases/20260913-friends-beta-884120a` |
| Dev website | `/home/pritam/.local/share/foundkeep-site-dev/releases/20260913-095941-friends-beta` |
| Dev static | `/home/pritam/.local/share/foundkeep-dev-web/releases/20260913-104300-friends-beta` |

The production online backup, before/after records and previous systemd overrides are retained at `/home/pritam/.local/share/foundkeep-production-backups/20260913-101226-friends-beta`. A copy of that database successfully migrated before the real service switch. Previous release directories remain available.

The previous production website is `/home/pritam/.local/share/foundkeep-site/releases/20260912-agentic-hydration`; the previous backend is `/home/pritam/.local/share/foundkeep-backend/releases/20260912-billing-9a93b05`. Roll back code using the saved website pointer/backend override and restart only the affected production services. Do not replace the current database with an older backup over new customer writes.

Production extension allowlist includes the existing store ID `cficnecbdbiddngllpfbacabgbcjinmk` and manual-install ID `mjfcgmboaijfcaanepdipbgmipnccnpn`. It excludes dev ID `fngoidplpdpoamenhgpabbheghpkdkcb`. Both ZIPs are version 1.7.1:

| Artifact | Bytes | SHA-256 |
| --- | --- | --- |
| Production extension | 128339 | `28cf104338efe6105bb1645f462b0f3a7be8b95db020364c1b520836afd7e9c2` |
| Dev extension | 128184 | `ffe66170e47197d8301fd9b81040b7c9cf726d71a3d88448638fcc9ad3c23a1a` |

## Mobile distribution still pending

Friends builds use production APIs and the `production-beta` OTA channel. Pritam profiles use dev APIs and the `dev` channel. Both retain the canonical iOS app `app.foundkeep.ios`, share extension/group, Android package `app.foundkeep.android` and `foundkeep` scheme. Environment-specific credentials, queues and caches remain isolated. Installing a different realm binary replaces the other binary on the same device.

**iOS:** version 1.0.0, build **20**, was signed, deeply verified and successfully uploaded to existing App Store Connect app **6809771188**. Submission: https://expo.dev/accounts/notpritam/projects/foundkeep/submissions/d9ddc5b3-dcd5-4ed7-929b-fd2d13df6eff. The IPA is 23,815,957 bytes, SHA-256 `f1822edd4e99d5349d5ba8595bfe07e84ffe410b5c8305912d44bd46282bddde`; bundled runtime is `3fe4cb50f983381c10a005f79f00c3d65e01840c`. Canonical identity, production origin, channel and signing passed. The later Android-only autolinking fix does not change iOS native source. This is upload evidence, not a verified tester join link or an installed-device test.

The IPA remains on MacBook Pro Work at `~/.local/share/foundkeep-builds/20260913-friends-ios20/FoundKeep.ipa`. Check processing/group availability in https://appstoreconnect.apple.com/apps/6809771188/testflight/ios. External beta review still needs the owner's real review-contact information; none was invented. No invitations or public store release were sent.

**Android:** the first signed local EAS build reached Gradle but failed because Expo selected a precompiled `expo-sharing` publication while the bridge requires its source Gradle project. `5fbe3c5` enables Android `buildFromSource: ["expo-sharing"]` and repairs a clean-install fingerprint test import. Focused tests, all 86 mobile tests, typechecking and scoped code review passed. The actual native retry is pending: MacBook Pro Work stopped updating its heartbeat and returned repeated HTTP 504 responses before it could run.

The isolated Android tree is `/Users/notpritamm/Developer/foundkeep-friends-android-20260913`; existing generated private signing credentials remain on that Mac. Resume its `friends-android` EAS local build after reconnect. Verify the actual APK package, version, production origin, channel, runtime, signature, size and hash, then test startup/login/incoming shares before hosting it. Use the final signing certificate for Android asset links; Play's app-signing certificate is a separate value. No APK, Play beta link or completed native-device journey is claimed yet.

## Production Pro and parsing limits

Production currently has no OpenAI, live Paddle or RevenueCat credentials configured. Checkout and managed processing remain unavailable. Dev retains the working Paddle sandbox and its existing provider configuration. Do not copy sandbox billing credentials into production or invent Pro entitlements. Production configuration requires the intended live provider credentials before a paid journey can be verified.

Free accounts can connect their own scoped MCP agents. Accessible captured text, article content and image originals remain available. Protected social posts and links without transcripts retain honest metadata/availability states; preview-only YouTube/X/Instagram data is not treated as full video understanding. Empty/unusable source jobs do not spend a processing credit. The UI labels unsupported downloading/transcription features as future work.

The launch goal remains open until actual mobile distribution/device checks and required production provider setup are resolved. Public App Store/Play rollout requires the later release instruction.
