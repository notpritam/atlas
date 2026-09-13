# Social Collections Implementation Plan

**Goal:** Ship public/private collections, collaboration, moderation, following and fast extension submission to the existing dev environment.
**Architecture:** Add a separate sharing model and explicit public DTOs around existing account authentication and captures. Collection entries are deliberate snapshots. Keep the private library and its access controls intact.
**Tech Stack:** Bun, Hono, SQLite, Next.js App Router, React, browser-extension ES modules.
**Spec:** ../specs/2026-09-12-social-collections-design.md

## Global constraints

Private by default. No automatic publication of existing captures. Pro creates groups/invites; joining and following free. No emails or production deployment. Source collection rules and destination rules checked transactionally. All new routes preserve account binding.

## 1. Collection data and permissions

- [x] Append migration in `apps/backend/src/db.ts`.
- [x] Create `apps/backend/src/customer-collections.ts` with `registerCustomerCollections(app, db, services, optionalAuth)`; register from `customer.ts`. Reuse `CustomerServices` and `accountPlan`.
- [x] Add `apps/backend/test/customer-collections.test.ts` covering private/public DTOs, source ownership, moderation, followers, accepted members, Pro gates, deletion, move, pagination and stale credentials.
- [x] Run `bun test apps/backend/test/customer-collections.test.ts`; fix implementation until all permission and lifecycle checks pass.

## 2. Public and account UI

- [x] Define shared API DTOs in `apps/site/lib/collections.ts` matching the backend's explicit response fields.
- [x] Add `/collection/[slug]`, `/collections`, `/dashboard/collections` and `/dashboard/collections/[id]` with server authorization and real navigation.
- [x] Build collection cards, forms, rules, entries, member management and moderation components under `apps/site/components/collections/`; scope CSS there.
- [x] Wire sidebar and capture detail sharing. Extend the plans copy for Free personal collections and Pro groups.
- [x] Browser tests in `tests/next-collections.mjs` create disposable owner/contributor accounts, publish a link, submit and approve an entry, follow it, make the collection private and assert it becomes inaccessible. Check 320/390/1440px overflow and keyboard interactions.

## 3. Extension

- [x] Extend fixed `libraryOperation` vocabulary for listing eligible collections and submitting entries, preserving sender and account checks.
- [x] Add target selection and explicit submission to popup and cloud library, including pending/approved feedback. Never change the private save default.
- [x] Add allowlist and browser behavior assertions to `tests/extension-collections.mjs`, and run affected existing extension suites.

## 4. Verify and deliver

- [x] Run collection, auth and relevant existing backend tests, site typecheck/build, and browser flows on disposable local storage.
- [x] Package a verified standalone dev site and build the dev extension; use a consistent database backup before the additive dev migration.
- [x] Restart only dev services, publish the dev extension downloads, verify live public/private route behavior without modifying customer data, and document deployment/results.

## Status — shipped to dev (2026-09-12)

All sections implemented and verified; deployed to https://dev.foundkeep.app.

- Backend: 79 tests pass (8 collection permission/lifecycle). Additive migration (`customer_collection*` tables) applied to the dev DB after a SQLite backup; dev backend restarted.
- Site: typecheck + production build clean; collection routes render-time/dynamic, homepage stays static. Packaged release `20260912-234034-social-collections`, `current` switched atomically, `foundkeep-site-dev.service` restarted (prev release retained for rollback).
- Extension: 66 extension tests + 3 collection tests pass.
- Browser E2E (`tests/next-collections.mjs`): 4/4 pass. **Fixed a real bug** — after approving a pending entry, the owner's Finds tab showed stale data because finds/pending are cached under separate keys (`tab==='pending'`) and only the active query was refetched; `manager.tsx` now invalidates the whole `['social-collection', id]` prefix so the other tab refetches past the 15s staleTime.
- Live checks: `/collections` 200, `/collection/<missing>` 404, `/dashboard/collections` unauth → 307 login. Other shared-Caddy hosts unaffected.
