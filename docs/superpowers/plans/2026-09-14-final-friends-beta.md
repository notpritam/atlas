# Final friends beta release plan

> **For agentic workers:** Execute independent native and extension packaging tasks using the dispatching-parallel-agents skill; use requesting-code-review before integration and verification-before-completion for every release claim.

**Goal:** Enable production AI and the chosen friends Pro access, release the current app and extension features, and prepare the smallest valid version increments for beta submission.

**Architecture:** Development and production retain separate databases, auth sessions, extension identities, upload queues, and origins. The existing AI provider credential may be used by both server environments without entering client builds. Package immutable backend/site releases, validate copied production migration and rollback compatibility, verify dev, then promote production.

**Tech stack:** Bun/Hono/SQLite, Next.js, Chrome MV3 extension, Expo/React Native, systemd, existing signed native identities and distribution accounts.

**Spec:** User authorization on 2026-09-14 to enable both APIs, production AI/Pro, final native and extension builds and beta submission; standing constraints in `AGENTS.md` and `docs/beta/2026-09-13-friends-release.md`.

## Global constraints

- Dev: `https://dev.foundkeep.app`; production/friends: `https://foundkeep.app`.
- Never copy customer data between environments or reset existing databases.
- Preserve dev Paddle sandbox configuration. Never install sandbox payment credentials into production as live billing.
- Reuse iOS `app.foundkeep.ios`, Android `app.foundkeep.android`, production-beta channel, and existing extension identities.
- Keep mobile marketing version `1.0.0` if accepted; advance each internal build counter only once from its latest accepted value. Advance established extension channels only by the smallest required step; keep the separate Web Store version low.
- Beta upload/submission is authorized; general public App Store/Play rollout and invitations are not part of this release.
- Processing remains subject to each account's consent, quotas and cancellation controls.

## Task 1: Backend provider and Pro access

Files: `apps/backend/src/customer-plans.ts`, associated billing/processing tests and any account-plan presentation requiring a truthful beta label; secure operator files outside the checkout.

- [ ] Inspect running dev/prod environment presence and payment configuration without exposing values.
- [ ] Resolve complimentary beta Pro versus live paid checkout; request missing live payment credentials securely only if paid checkout is selected.
- [ ] Configure the existing OpenAI credential for the production backend only, preserving rollback configuration and provider budget bounds.
- [ ] Verify any policy change with meaningful entitlement tests, then backend tests/typecheck and Python downloader checks.
- [ ] Package immutable backend with Python helper and matching dependencies; verify copied production migration, row preservation and old-code rollback compatibility.

## Task 2: Native beta artifacts

Files: `apps/mobile` version/build configuration and `docs/beta/2026-09-14-final-mobile-beta.md`.

- [ ] Inspect actual Apple/EAS and Android build history before selecting the next build numbers.
- [ ] Verify current mobile tests, typecheck and native generated project.
- [ ] Build signed production-beta APK and iOS archive using existing signing state; inspect identity, API origin, version and checksums.
- [ ] Test installed release paths where devices are available, upload iOS to TestFlight and verify returned processing/submission state.
- [ ] Report exact external-beta prerequisites if any are still missing; never publish an unverified artifact URL.

## Task 3: Extension beta artifacts

Files: `apps/extension/manifest.json`, `deploy/store-version.txt`, build scripts only if needed, `docs/beta/2026-09-14-final-extension-beta.md`.

- [ ] Inspect version histories and choose one minimal increment per applicable channel.
- [ ] Build production and dev packages with their existing environment-specific identities.
- [ ] Verify extension tests and exact packaged save/sidebar/environment behavior.
- [ ] Prepare signed self-hosted update artifacts and a low-version Web Store upload ZIP with existing signing credentials where available.

## Task 4: Verified promotion and handoff

Files: `apps/site/lib/beta-distribution.ts`, release notes under `docs/beta`, packaged artifacts and operator release configuration.

- [ ] Independently review backend entitlement/provider setup and release diff before merge.
- [ ] Update beta distribution metadata only for verified artifacts/submission states.
- [ ] Package/verify dev web with dev backend and Paddle sandbox public token; atomically promote dev and verify public behavior.
- [ ] Package/verify production web with production backend and appropriate public billing configuration; retain previous releases.
- [ ] Back up production online, switch backend/site/static artifacts atomically, restart affected services, verify health and account/data preservation.
- [ ] Run production signup/session, save/organization, preservation/media preview, AI processing/credits, MCP and extension environment smoke checks with disposable QA data only; clean up that QA data.
- [ ] Merge reviewed changes into `main`, push and inspect CI. Publish only authorized beta artifacts/submissions, document versions, checksums, rollback and outstanding external requirements.
