# Friends beta — 13 September 2026

Status at 14:32 UTC. Friends use **https://foundkeep.app/beta** and production accounts. **https://dev.foundkeep.app** remains Pritam-only. Android and desktop are available for Free beta use; production Pro configuration, updated native builds and external TestFlight access remain open. This is not a completed all-feature, all-device launch.

## Available now

- Production dashboard, scoped MCP create/update/organization/links, canvas mind map, public/private collections and contribution/moderation controls.
- Full-width public collections with natural-height image/note masonry, searchable filters and detailed readers. Inter, compact navigation and icon theme controls; the subsequently approved Linear-style dark palette uses `#08090a` paper, `#0f1011` surfaces and the existing sky-blue accent. Form boundaries retain at least 3:1 contrast.
- Desktop uses the dashboard and browser extension. The installed web app starts at `/dashboard`; the legacy Atlas native dock is not distributed.
- [Production extension ZIP](https://foundkeep.app/foundkeep-extension.zip). Unzip, load the extension folder through Chrome's Developer mode, and connect it in Apps & devices. Production and Foundkeep Dev keep separate identities, credentials and queues.
- [Signed Android 1.0.0 (5) APK](https://foundkeep.app/downloads/foundkeep-android-1.0.0-5.apk), with installation instructions on the beta page and a `.sha256` sidecar.
- Private dev demo: https://dev.foundkeep.app/collection/demo-design-that-works. Seeding is additive and never ran in production.

## Release pointers and rollback

| Service | Current release |
| --- | --- |
| Production website | `/home/pritam/.local/share/foundkeep-site/releases/20260913-135407-media-preservation` |
| Production backend | `/home/pritam/.local/share/foundkeep-backend/releases/20260913-141918-remote-media-ebe9e2e` |
| Dev website | `/home/pritam/.local/share/foundkeep-site-dev/releases/20260913-135056-media-preservation` |
| Dev backend | `/home/pritam/.local/share/foundkeep-backend/releases/20260913-141918-remote-media-ebe9e2e` |
| Dev static downloads | `/home/pritam/.local/share/foundkeep-dev-web/releases/20260913-104300-friends-beta` |

The shared backend code is immutable; each service retains its own environment, database, storage and authentication. Dev's release override is `foundkeep-backend-dev.service.d/foundkeep-media-release.conf`; production uses `atlas-backend.service.d/foundkeep-release.conf`. Restarting dev alone no longer deploys working-tree changes. Both media runtime overrides enable the pinned Python runtime and `PrivateTmp=yes`; service shutdown removes private extractor scratch space.

Revision `8fa9e31` was enabled on the dev backend at13:52Z, dev website at13:54Z, then production backend/website at13:55Z. Online backups and previous service overrides are retained:

- Dev backend: `~/.local/share/foundkeep-dev-backups/20260913-135206-remote-media`.
- Dev website: `~/.local/share/foundkeep-dev/backups/20260913-135433-remote-media`.
- Production backend: `~/.local/share/foundkeep-production-backups/20260913-135505-remote-media`.
- Production website: `~/.local/share/foundkeep-production-backups/20260913-135506-remote-media`.

Backend fix `ebe9e2e` was deployed to dev at14:21:33Z and production at14:21:49Z. Migration27→28 was first applied to an online copy of production and preserved every customer row, adding only nullable `scheduled_cutoff`. Both live databases now have schema28 and pass integrity/ID-preservation checks. New backend backups are dev `~/.local/share/foundkeep-dev-backups/20260913-142132-remote-media` and production `~/.local/share/foundkeep-production-backups/20260913-142149-remote-media`. The immediately previous immutable backend `20260913-135112-remote-media-8fa9e31` is retained. Websites remain at the earlier8fa9e31 build because this fix does not change site code.

Previous website releases are production `20260913-123918-beta-distribution` and dev `20260913-123822-beta-distribution`; prior backend code `20260913-native-notes-ab4c082` remains available. Roll back code/configuration without overwriting newer customer data with a database backup. The raw schema27 backend cannot open schema28 because its migration guard correctly rejects a newer schema. Use prepared `/home/pritam/.local/share/foundkeep-backend/releases/20260913-rollback-8fa9e31-schema28` for an emergency backend rollback: it contains the exact previous8fa9e31 source with only `db.ts` fromebe9e2e so the additive schema remains supported. A copied-production check proved the original release rejects schema28, the compatibility release opens it, and every customer row and database integrity remain unchanged. This compatibility release is staged, not active. Set only the relevant service release override’s `WorkingDirectory` to its `apps/backend`, reload systemd and restart that backend; retain realm environment/data/runtime overrides. Do not lower `user_version` or restore an old database. Evidence: `~/.local/share/foundkeep-beta-media-samples/final-migration/rollback-verification.json`.

At14:04Z all original production and dev account/capture/connection IDs remained present, SQLite integrity was `ok`, and both environments had zero enabled automations after QA cleanup. Current production counts were4accounts/30captures/5connections; dev5accounts/16captures/0connections. New customer saves were retained. No production demo data was seeded.

## Verified journeys

The actual production MCP SDK created saves, updated detailed context, linked ideas, displayed the relationships in the desktop/phone canvas, opened the saved reader and verified token revocation. The actual extension journey passed signup, recovery acknowledgement, pairing, preference sync, note/highlight/article/screenshot capture, readable article extraction, screenshot OCR, import and revocation. Those temporary accounts were deleted.

Native source through `76e6ecf` passed94mobile tests/typecheck, and earlier backend changes passed255tests/2,217assertions. The media integration subsequently passed186covering tests/1,743assertions; final source-evidence changes passed98focused tests/467assertions and backend typecheck. Independent per-task reviews passed. The subsequent broad review identified two final integration gaps. Consolidated fix `ebe9e2e` and its scoped re-review now pass: scheduled due cohorts drain beyond twenty saves in bounded pages, and native readers observe actual managed completion/failure instead of treating enqueue as completion. The fix passed67focused backend tests/445assertions,98mobile tests and backend/mobile/site typechecks. Native artifact verification remains separate.

The packaged production-mode browser passed both existing appearance and public-collection suites, including desktop/phone layout, theme persistence, public snapshot privacy, detailed readers, keyboard/focus behavior, sticky navigation and no-JavaScript collection access. Live dev reader and production beta pages passed desktop/phone checks with no overflow or runtime errors. The retained production APK in the new website release matches its signed checksum.

Evidence: `.impeccable/review/friends-beta/{live,production,distribution,media-live}/`, including `media-live/verification.json` and `cleanup-preservation.json`; private media/provider evidence is under `~/.local/share/foundkeep-beta-media-samples` and `~/.local/share/foundkeep-beta-dev-checkout`.

## Mobile distribution

Friends builds use production APIs and OTA channel `production-beta`; Pritam profiles use dev APIs and channel `dev`. No OTA was published. Canonical identities remain iOS `app.foundkeep.ios`, share extension `app.foundkeep.ios.ShareExtension`, App Group `group.app.foundkeep.ios`, Android `app.foundkeep.android`, and scheme `foundkeep`. Environment-specific credentials, queues and caches remain isolated. Installing another realm replaces the same app binary on that device.

### Android

The public APK is1.0.0/versionCode5,107,242,309bytes, SHA-256 `d437266a3d16dbb0ad79f2a54390578844a680e48f29605b7826fce0655b6f2a`. It includes arm64-v8a, armeabi-v7a, x86 and x86_64; it is non-debuggable, has no QA instrumentation, and passes APK v2 signature verification. Certificate:

`03:A3:D5:29:1D:F5:AF:FC:6E:2B:54:A0:97:35:5C:B6:50:5B:89:8F:F6:AF:BA:14:31:FB:22:81:1C:2E:DE:A0`

Source is `76e6ecf`, runtime `6ca4757677af90ad84a97820f1affae01c0b9f76`. Private original: `~/.local/share/foundkeep-beta-artifacts/android/20260913-version5/foundkeep-friends-android-production-beta.apk`. Signing material is preserved privately on the Mac. No Play listing URL is claimed.

The exact signed APK was installed on an API36 AVD: production login, native note, URL/PDF share, original-file download/hash, logout and runtime-error checks passed. Additional source-level real MediaStore PNG/PDF/MP4 shares retained original names/MIME/hashes; theme switching preserved drafts/focus. Temporary accounts were removed.

After Google's cache refreshed, genuine OS re-verification returned `foundkeep.app: verified`, Google DAL `linked:true`, and a real implicit HTTPS launch opened `app.foundkeep.android/.MainActivity`. No verification state or app choice was forced. Evidence: `~/.local/share/foundkeep-native-check/evidence/signed-v5-applinks-retry-final.json`. The disposable AVD is stopped.

### iOS

Uploaded build1.0.0(21), source `76e6ecf`, is available in the existing [App Store Connect app6809771188](https://appstoreconnect.apple.com/apps/6809771188/testflight/ios). The [EAS submission](https://expo.dev/accounts/notpritam/projects/foundkeep/submissions/ea2dc508-9fc6-47fd-80f6-f425624c14a1) succeeded. Apple confirmed12:30Z: VALID, internal READY_FOR_BETA_TESTING, external READY_FOR_BETA_SUBMISSION. External review contact is missing; no external join URL, review submission, invitation or public release was created.

IPA21 is `/Users/notpritamm/.local/share/foundkeep-builds/20260913-friends-ios21/FoundKeep.ipa`,23,821,626bytes, SHA-256 `81805a732bacc98043f36c95ac1d83a2b5a93c451085c64ff063d17c33c8c1cc`, runtime `3fe4cb50f983381c10a005f79f00c3d65e01840c`. Source, production origin/channel, App Store profile, canonical entitlements and both deep strict signatures passed. IPA20/21 are retained unchanged.

Further actual Files testing exposed an intake bug absent from earlier Safari checks. Reviewed fix `0afb7a0` prioritizes concrete file representations over local URL representations. Its10existing Safari and13new file cases pass. The corrected simulator's actual Xcode-generated loader input was checked against the reviewed canonical hash; checking only canonical source had initially missed a stale generated copy.

After fixing the compiled input, actual individual and mixed PNG/PDF/MP4 shares all passed, as did native original exports with matching names/MIME/bytes/hashes and the signed-out share guard. The dedicated account and all six captures were deleted; its previous session returned401. This is simulator evidence, not a physical TestFlight install. The next signed build is being prepared from reviewed `ebe9e2e` with the Files and managed-processing observer fixes; build21 does not contain them.

## Remote media and Pro

The guarded downloader and durable processing integration are deployed. They retain validated owner-scoped video files, original source URLs, byte-range playback, actual source/subtitle evidence and explicit availability status. Consent, image permission, timing, storage quotas, cancellation/revision guards and atomic credit settlement remain enforced. Crash cleanup covers private extractor temporary files and bounded stale unreferenced remote storage. See [runtime contract](media-runtime.md).

| Real source | Preserved bytes | Duration |
| --- | ---: | ---: |
| MDN CC0 flower MP4 |1,128,375|5.055s|
| Public Instagram reel |918,120|4.967s|
| X history video |1,404,023|15.557s|
| X Brooklyn Nets session |6,190,690|324.501s|

Actual authenticated file hashes, cookie/mobile byte ranges, owner isolation, browser decoding/playback/seeking and completed-job credit deduplication passed. Actual AI output distinguishes a preserved file from the text/frame supplied for analysis. No unavailable transcript is invented.

The YouTube sample encountered an upstream sign-in/bot refusal. It remains a saved link with an honest failure and zero processing credits used. Generic platform marketing/logo metadata is rejected unless actual item-level evidence is present. Current runtime supports bounded compatible progressive MP4; adaptive-only, live, protected and unsupported sources remain unavailable. This is not a claim that every YouTube/Instagram/X video can be downloaded.

A dedicated dev account completed an actual Paddle sandbox checkout. Its verified sandbox subscription enabled Pro after adding only that QA account to the temporary dev allowlist. Real service checks passed reel download/private playback, instant one-credit preservation, paused saving without usage, cap enforcement, scheduled-setting persistence and unavailable-YouTube no-charge behavior. The sandbox subscription was canceled, the account/captures deleted, the old session rejected, private credentials removed and original allowlist restored. Existing user accounts and sandbox configuration were retained.

Production still has no OpenAI/live Paddle/RevenueCat configuration or intended friends Pro grants. Checkout and managed processing remain unavailable there despite the deployed capability. Free users can connect their own MCP agents. The intended production AI key and capped friends Pro access versus paid checkout are pending user choices; no key was copied and no provider entitlement fabricated.

## Remaining gates

- Build and verify updated Android and iOS production-beta artifacts from reviewed `ebe9e2e`; the matching backend is already deployed. The signing Mac stopped responding after14:25:33Z. Android6 source is transferred and iOS simulator compile/install plus observer tests pass, but neither new signed build/increment started. Resume only after an actual remote file/terminal call succeeds; the stale connected label is insufficient. Existing Android5 and iOS21 remain unchanged.
- Configure the intended production AI provider and legitimate Pro access/billing path after the pending user decisions.
- Complete external TestFlight contact/review/tester setup. Android manual APK is available; Play beta is optional and requires account/listing access.
- General App Store/Play publication remains a later, separate release instruction. No invitations or public rollout have been performed.
