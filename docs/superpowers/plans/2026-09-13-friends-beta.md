# Friends Beta Implementation Plan

> For agentic workers: use superpowers:subagent-driven-development for independent bounded tasks, with controller-owned integration and review. Preserve other workers' changes.

**Goal:** Verify on permanent dev, then make production beta ready for friends to install, save, connect agents, organize and link their library, control Pro processing, and give feedback.

**Architecture:** Extend the existing Bun/Hono/SQLite customer modules and Next dashboard, preserve scoped MCP transport and the capture ledger, reuse app identities with environment-scoped storage and build/update profiles. The root agent owns integrations, media-source improvements, graph UI, deployments and store operations.

**Tech stack:** Bun, Hono, SQLite, MCP SDK, Next/React, Expo/React Native, existing native Share Extension, EAS/TestFlight/Google Play test channels.

**Spec:** `docs/superpowers/specs/2026-09-13-friends-beta-design.md`

## Global constraints

- Dev is Pritam-only; friends use production APIs. Verify first on permanent dev, then promote tested changes for friends beta. Preserve all accounts/data/auth, dev Paddle sandbox and canonical app identities. No general store rollout.
- No credential values in source, logs, artifacts, or chat. No invitations sent.
- No fake extraction, test passes, store URLs, entitlements, or popularity claims.
- Root controls dependency installation, shared lockfile, integration and deployments. Workers do not switch branches, commit, or deploy.
- Write focused failing tests before behavior changes; finish with relevant suites and a diff self-review.

## Task 1 — MCP writes and environment endpoint

Files: `apps/backend/src/customer-mcp.ts`, `customer-agent-access.ts`, new `customer-mcp-writes.ts`, `apps/backend/test/customer-mcp.test.ts` and focused write tests.

Produces `create_save` and `update_save` through the existing `createMcpOperations(...).call()` contract. Reuse provenance/organization validation and account plans. Use transactions, UTF-8 storage accounting, account and global capture/byte limits, stable client IDs and monotonically increasing revisions. Keep agent-owned generation distinguishable, preserve original file content and omitted fields. Agent writes must appear in `customer_changes`. Retain all existing tools and caller signatures.

- [ ] Add failing tests for create/read round-trip, duplicate client ID, owner-only folders, quota, readonly scope and revision conflict. Example: `await ops.call('create_save',{clientId:'agent-1',type:'note',noteText:'Useful context',userTags:['research']})`, then update using the returned `capture.updatedAt`, and assert original omitted fields/tags remain.
- [ ] Implement schema-validated text creation and explicit detail edits in a focused module; validate authorization again in each transaction.
- [ ] Generate MCP endpoint from configured customer origin, retaining production default.
- [ ] Run `bun test apps/backend/test/customer-mcp.test.ts` plus new tests and backend typecheck. Report interface details for root graph/SDK verification.

## Task 2 — Pro schedule, pause and allowance controls

Files owned: `apps/backend/src/customer-processing.ts`, processing-specific new module if needed, `apps/backend/src/db.ts` migration, `apps/backend/test/customer-processing.test.ts`, `apps/site/components/dashboard/collection-services.tsx`, its scoped CSS, focused browser tests. Do not edit mobile files; report types to mobile worker/root.

Consumes existing consent, ledger, accountPlan and worker tick. Produces `/automation` contract from spec with backward compatibility. Add migration columns to `customer_automation` for mode, interval, monthly cap and next scheduled run. Instant processes new saves; scheduled queues them at the selected interval; manual waits for explicit requests; paused prevents all managed work and releases reservations. Preserve work for safe resume without duplicate charges. Consent disabled remains distinct from a pause. Changing schedule must not execute early, and current limits govern reservation on every path. A failed/cancelled job never consumes a user credit.

- [ ] Add controlled-clock tests: schedule boundary, no auto work in manual mode, pause while provider awaits, resume exactly once, cap below plan allowance, invalid settings, legacy enabled behavior, two workers claiming one job.
- [ ] Implement settings validation/migration and bounded scheduling/claim/settlement behavior. Use immediate transactions for credit and schedule decisions.
- [ ] Add accessible explicit timing choices, interval and cap controls, next-run/usage text, and error/retry feedback in the web settings module; preserve consent confirmation.
- [ ] Run processing tests and typecheck; report backward-compatibility and native API fields.

## Task 3 — Dev mobile variant and Android runtime/share support

Own all `apps/mobile/**` except dependency installs/root lockfile, which root handles on request. Produces build profiles `friends-ios` (store/TestFlight), `friends-android` (internal APK), `friends-play` (store AAB), all on canonical app identities, production APIs, and production-beta channel. Pritam-only profiles use dev APIs/channel and internally isolated credentials/queues/cache. Public store release remains excluded.

- [ ] Add tests for dev/prod resolved configuration, origins, schemes, groups/keychain/queue isolation and rejected cross-environment OAuth/navigation.
- [ ] Use dynamic app config and environment module; remove production hardcoding from dev API, deep links, Swift module/share extension configuration and plugins. Preserve default production tests.
- [ ] Implement Android native module/runtime parity needed to start, securely store scoped device credentials, process owner-bound queues, download originals, and receive shared URLs/text/images/files. Read current Expo/native docs; request dependencies through root. Never execute received content or upload an old account's queue under another account.
- [ ] Update mobile processing controls/types/client for Task 2 contract after coordination; default unknown server timing fields safely.
- [ ] Run mobile unit/type/config checks and produce native generation/build instructions. Root handles remote Mac toolchain and actual EAS/store distribution.

## Task 4 — Root graph and source reliability

Files: new customer graph module/tests, route registration in `customer.ts`; new Next `/dashboard/mind-map` route and graph components, sidebar/section integration; `customer-source.ts`, source tests, processing detail evidence, extension extraction tests as needed. Root alone installs dependencies.

- [ ] Build owner-scoped bounded graph data from real captures, tags, and explicit link table; tests exclude foreign IDs/tags and preserve actual link origins.
- [ ] Add readable interactive graph with save navigation, focus/search, pan/zoom, accessible list and honest bounds. Include real demo connected saves through additive seeding.
- [ ] Expand public source parsing with tested structured metadata/social content extraction; distinguish readable text, metadata-only and unavailable. Preserve original URL/content and SSRF/size/time limits. Verify blogs, X posts, Instagram and YouTube samples where accessible, plus images/video files; disclose missing transcript rather than infer it.
- [ ] Run full SDK-to-dashboard graph/browser flow and focused regression suites.

## Task 5 — Beta distribution and launch evidence

Files: `docs/beta/`, install/onboarding page/config, extension packaging artifacts, mobile profiles and verified distribution records. Root owns deployment.

- [ ] Inspect available EAS/Apple/Google access without exposing credentials; prepare exact dev identities/builds and use test channels only. External review/account availability is recorded explicitly.
- [ ] Build dev extension and verify pairing, save/sync, MCP mutations and graph against disposable environments. Publish dev ZIP in a new static dev release.
- [ ] Build signed iOS/Android artifacts, verify bundled dev origin/identity, upload to available TestFlight/Play test destinations. Share APK as an additional immediate Android option.
- [ ] Provide one beta start page with install links, agent setup, example tasks, processing controls and a feedback path using existing product conventions.
- [ ] Back up dev SQLite, build/package/verify new web/backend/static releases, deploy only dev, retain rollback and verify existing accounts/data/config.
- [ ] Record tests, actual URLs, supported parsing coverage and outstanding external gates. Complete goal only when all required work is achieved; follow goal-blocking policy for external impasses.
