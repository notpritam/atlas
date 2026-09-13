# Paddle web billing — design spec

**Date:** 2026-09-12
**Status:** approved design, pre-implementation
**Scope:** Add Paddle as FoundKeep's web billing provider (sandbox first), with a
dedicated dev environment for end-to-end testing before promoting to production.

---

## 1. Decisions (locked)

- **Direct Paddle Billing, NOT via RevenueCat.** `docs/PADDLE-SETUP.md` currently
  describes Paddle-*via*-RevenueCat; that is superseded and must be rewritten to match
  this spec (step 0 of implementation). RevenueCat stays as the **iOS/App Store** path only.
- **Paddle replaces the never-enabled Stripe web path.** Stripe provider code stays in
  place but dormant (env-gated, as it already is) — not removed.
- **Checkout = dedicated `/checkout` page** in `apps/site` (redirect-style). The server
  creates a Paddle *transaction*; the browser navigates to `/checkout?_ptxn=<txn>`; that
  page runs Paddle.js which auto-opens the checkout. Paddle Billing has **no** no-JS
  hosted checkout page, so Paddle.js is unavoidable — isolating it to one route keeps the
  rest of the app's strict CSP untouched.
- **Dev and prod are separate deployments of identical code**, differing only by env file
  and Paddle account (sandbox vs live). "Promote to prod" is a config swap, not a rebuild.
- Sandbox only for now. **No go-live** in this scope (that's the gated step in the
  rewritten PADDLE-SETUP doc).

## 2. Stack facts (verified)

- Backend: **Bun + Hono + `bun:sqlite`**. Billing lives in
  `apps/backend/src/customer-billing.ts` (`createBillingService`) with providers Stripe +
  RevenueCat today. Entitlement derives from `customer_subscriptions` via
  `accountPlan()` (`customer-plans.ts`); webhook idempotency via `customer_billing_events`
  (`processed()`/`finishEvent()`); per-account serialization via `serial()`.
- Frontend: **Next.js `apps/site`**. Plan UI in
  `components/dashboard/collection-services.tsx`; CSP in `proxy.ts` (nonce + `strict-dynamic`).
- Public host `foundkeep.app` is **Cloudflare-proxied** → origin Caddy (`tls internal`),
  backend on loopback `:8790`, site on `:8791`.

## 3. Architecture — Paddle as a third provider (mirrors Stripe)

### 3.1 Data / migration (`apps/backend/src/db.ts`, append to `MIGRATIONS[]`)
- **Rebuild `customer_subscriptions`** to widen the provider CHECK to
  `('stripe','revenuecat','paddle')`. The rebuilt table MUST reproduce the *current* shape:
  PK `(account_id,provider)` **and** the later-added `next_check_at INTEGER NOT NULL DEFAULT 0`
  column; copy every column for every row, then `DROP` + `RENAME`. No `foreign_keys` toggling
  (it's a no-op inside the migration transaction, and nothing references the table inbound).
- `ALTER TABLE customer_billing_identities ADD COLUMN paddle_id TEXT;` (Paddle customer
  `ctm_…`). Add a unique index on `paddle_id` (partial `WHERE paddle_id IS NOT NULL`).
  **Store only `paddle_id`** — subscription state is derived by listing subs for the customer.
- **DROP + CREATE** the `customer_billing_identity_cleanup` trigger to also enqueue one
  `('paddle', OLD.paddle_id)` cleanup row.
- Widen the `SubscriptionProvider` type in `customer-plans.ts` to include `'paddle'`.

### 3.2 Billing service (`customer-billing.ts`)
Add a `paddle` provider inside `createBillingService` using the **injected `fetch`** (as
RevenueCat and `scripts/paddle-sandbox.mjs` do) — **not** `@paddle/paddle-node-sdk` (it
breaks the injectable-fetcher test seam). Config: `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`,
`PADDLE_PRICE_ID`, `PADDLE_ENV`, `PADDLE_API_BASE`, `PADDLE_CHECKOUT_ORIGIN`,
`PADDLE_SANDBOX_ACCOUNT_IDS`. `paddleAvailable = !!(API_KEY && WEBHOOK_SECRET && PRICE_ID)`.

- **`checkout(accountId)`** — wrapped in `serial('purchase:'+id)`: `refreshProviders`,
  reject if already Pro or a non-terminal Paddle/other sub exists, **assert the price**
  server-side (amount `500`, `USD`, monthly, qty 1, no trial — same invariants as
  `scripts/paddle-sandbox.mjs`), ensure/reuse the Paddle customer (store `paddle_id`),
  create a transaction for `PADDLE_PRICE_ID` with `custom_data.foundkeep_account=accountId`,
  return `${PADDLE_CHECKOUT_ORIGIN}/checkout?_ptxn=<txn_id>` (absolute URL). No stored
  pending-txn state: an unpaid draft transaction is harmless and the already-Pro guard
  prevents a second active subscription.
- **`syncPaddle(accountId)`** — fetch current subscription state for the customer,
  compute `{status, expiresAt, renews}`, and **gate sandbox at write time**: if
  `PADDLE_ENV==='sandbox'` and `accountId` not in `PADDLE_SANDBOX_ACCOUNT_IDS`, write an
  `inactive` snapshot. Otherwise `writeSubscription(db, accountId, 'paddle', snapshot)`.
  Never rely on `accountPlan` to filter sandbox — it is provider-agnostic by design.
- **`paddleWebhook(signature, rawBody)`** — verify the `Paddle-Signature` header
  (`ts=…;h1=…`, HMAC-SHA256 over `` `${ts}:${rawBody}` ``) with `node:crypto` +
  `timingSafeEqual` (bound `ts` freshness); dedupe on `event.eventId` (cap its length,
  ~200, before insert) via `processed('paddle', id)`; **resolve the account by customer id
  (`paddle_id`) primarily**, `custom_data.foundkeep_account` only as a secondary hint for
  `transaction.completed` (Paddle does not propagate transaction `custom_data` to
  subscription events); call `syncPaddle`; `finishEvent` **only after** the sync succeeds.
  On any throw return non-2xx so Paddle retries (its delivery contract: only 2xx = delivered).
- **`portal(accountId)`** — create a Paddle customer-portal session, return its URL.
- Add `syncPaddle` to **`refreshProviders`** and a `paddle` branch to **`reconcileBilling`**
  (gated on `PADDLE_API_KEY && PADDLE_PRICE_ID`) — webhooks primary, reconcile backstops.
- **Account deletion** (`processBillingCleanup`): add `paddle` to the SELECT filter (gated
  on `PADDLE_API_KEY`); in the branch, **list all subscriptions for the customer and cancel
  each active one, then archive** the customer (archiving alone does NOT stop billing).

### 3.3 Routes (`registerCustomerBilling`)
- Repoint the generic `POST /billing/checkout` and `POST /billing/portal` to the Paddle
  functions (this is "Paddle replaces Stripe"). Stripe's own routes stay, dormant.
- Add `POST /billing/webhooks/paddle` — raw body via `boundedText(c.req.raw)`, **no**
  `services.auth`, verify-before-process. (The CORS guard passes origin-less server POSTs.)
- Add `POST /billing/paddle/sync`.

### 3.4 Frontend (`apps/site`)
- `components/dashboard/collection-services.tsx`: add `paddle` to the `Plan.billing`
  shape and the provider branching (so a Paddle subscriber gets the right "Manage" button);
  update the redirect allowlist to accept the **site's own origin** (`/checkout`, returned
  as an absolute `https://…/checkout?_ptxn=…`) and the Paddle portal host; "Refresh plan"
  → `/billing/paddle/sync`.
- New `app/checkout/page.tsx` (client): read `_ptxn`, `initializePaddle({ token:
  NEXT_PUBLIC_PADDLE_CLIENT_TOKEN, environment: NEXT_PUBLIC_PADDLE_ENV })`, Paddle.js
  auto-opens the transaction; on `checkout.completed` → `/dashboard?billing=success`.
  New dep `@paddle/paddle-js`.
- **CSP (`proxy.ts`)**: add `/checkout` to `config.matcher` and give it the **same nonce +
  `strict-dynamic`** base policy, only *adding* `frame-src https://*.paddle.com
  https://sandbox-buy.paddle.com; connect-src 'self' https://*.paddle.com; img-src 'self'
  https://*.paddle.com data: blob:`. Keep `default-src 'self'`, `base-uri 'none'`,
  `object-src 'none'`, `frame-ancestors 'none'`, and `X-Frame-Options: DENY`. Under
  `strict-dynamic`, Paddle.js (injected from the nonced app bundle) is already trusted — do
  NOT add `cdn.paddle.com` to `script-src` (host entries are ignored under strict-dynamic).

## 4. Dev vs prod environments

Identical code; env + Paddle account differ. Dev exists to exercise the full flow
(payment, agent, backend) against sandbox with throwaway data.

| | Dev | Prod |
|---|---|---|
| Host | `dev.foundkeep.app` (Cloudflare-proxied → origin) | `foundkeep.app` |
| Backend | `foundkeep-backend-dev.service` `:8890` | `atlas-backend.service` `:8790` |
| Site | `foundkeep-site-dev.service` `:8891` | `foundkeep-site.service` `:8791` |
| DB | separate dev `atlas.db` (throwaway) | prod `atlas.db` (real data) |
| Paddle env file | `~/.config/foundkeep/paddle.dev.env` (sandbox) | `~/.config/foundkeep/paddle.prod.env` (live, later) |
| `PADDLE_ENV` | `sandbox` + `PADDLE_SANDBOX_ACCOUNT_IDS` | `production` |
| Paddle destination | sandbox → `https://dev.foundkeep.app/api/billing/webhooks/paddle` | live → prod webhook |

**Infra steps:**
1. **Cloudflare DNS (user):** add `dev` A → `157.180.102.248` (+ AAAA → `2a01:4f9:3090:1055::2`), Proxied.
2. **Caddy (agent):** back up `/etc/caddy/*.bak.<ts>` first and confirm every existing host
   is still present (per the box's Caddy-rewrite warning), then add a
   `dev.foundkeep.app { tls internal; … reverse_proxy :8890 (@backend) / :8891 }` block.
3. **systemd (agent):** dev units mirroring prod, isolated `ATLAS_DATA_DIR`, referencing
   `paddle.dev.env`. Mirror unit files into `deploy/`.
4. Auth in dev: use native email/password test accounts (no Supabase needed).

**Promotion to prod:** deploy same code, point prod unit at `paddle.prod.env`, create the
**live** catalog + client token + notification destination + default payment link, then a
deployment/fulfillment review. No code change.

## 5. Paddle provisioning (via REST, no dashboard except one item)
- Archive the ad-hoc catalog (`pro_…6d`/`pri_…ff`), run
  `node scripts/paddle-sandbox.mjs --apply` → canonical `pri_…` = `PADDLE_PRICE_ID`.
- `POST /client-tokens` → `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` (sandbox `test_…`).
- `POST /notification-settings` (events `transaction.completed`,
  `subscription.created/updated/canceled`, url = dev webhook) → `PADDLE_WEBHOOK_SECRET`.
- **Default payment link** → `https://dev.foundkeep.app/checkout`. May not be API-settable;
  if not, a ~30-sec dashboard step (documented for the user).

## 6. Tests
- Bun unit tests mirroring `apps/backend/test/customer-billing.test.ts` with the injected
  `fetcher`: signature verify (valid/invalid → non-2xx), idempotency (same `eventId`),
  provisioning (`subscription.created` → pro), cancellation (→ free), **sandbox gate**
  (sandbox sub for a non-allowlisted account → NOT pro), checkout guards (already-Pro,
  price-mismatch).
- Frontend `tests/collection-services.mjs` updated for the Paddle button.
- Real sandbox e2e in **dev**: complete a checkout with test card `4242 4242 4242 4242`,
  confirm the webhook flips the (allowlisted) dev account to Pro; plus Paddle's simulator
  for subscription events.

## 7. Open items to resolve during implementation
- Whether the default payment link is API-settable (else one dashboard step).
- Exact Paddle subscription fields for `expiresAt`/`renews` (`next_billed_at`,
  `scheduled_change`) — confirm against a live sandbox subscription.
- The deployed prod checkout path: `atlas-backend.service` has
  `WorkingDirectory=…/apps/atlas/…` (not `foundkeep-scenic-landing`) and ships no billing
  secrets — confirm which checkout is actually deployed before editing deploy/env.

## 8. Non-goals
Going live; RevenueCat/Paddle integration; removing Stripe; multi-plan/annual pricing;
proration/upgrades beyond the single $5/mo Pro plan.
