# Foundkeep — Paddle billing setup

Paddle Billing is Foundkeep's **web** billing provider, integrated **directly** —
not through RevenueCat. It replaces the never-enabled Stripe web checkout (the
Stripe provider code stays in the codebase, dormant and env-gated, but is no
longer wired to the generic checkout/portal routes). RevenueCat remains the
**iOS / App Store** path only, unrelated to Paddle; see
[REVENUECAT-SETUP.md](REVENUECAT-SETUP.md) for that side. Foundkeep targets
customers outside India; the seller account still uses the owner's actual
legal identity and country.

## Current status

Implemented on `feat/paddle-billing` (Tasks 1–8 of the paddle-billing plan):

- Schema migration widening `customer_subscriptions.provider` to include
  `'paddle'`, plus a `paddle_id` column on `customer_billing_identities`.
- A `paddle` branch in `createBillingService` (`apps/backend/src/customer-billing.ts`):
  checkout, portal, sync, webhook, reconcile and account-deletion cleanup —
  mirroring the existing Stripe/RevenueCat providers.
- Routes: the generic `POST /billing/checkout` and `POST /billing/portal` are
  now Paddle-backed, plus `POST /billing/paddle/sync` and
  `POST /billing/webhooks/paddle`.
- The `/checkout` page in `apps/site` (Paddle.js) and a scoped CSP allowance
  for it.
- Paddle-aware plan UI in `components/dashboard/collection-services.tsx`.

Not yet done — paused for a checkpoint before touching shared infra (Caddy has
a documented history of silently losing hosts; see `~/personal/CLAUDE.md`) and
blocked on the user's Cloudflare DNS record:

- Reconciling/provisioning the real sandbox catalog, client token and webhook
  destination against the owner's Paddle account (§1, §5 below).
- The `dev.foundkeep.app` environment: DNS, Caddy block, systemd units (§5).
- A real sandbox checkout end-to-end test (§5).

**Open item to confirm before wiring any of this into production:** the
backend unit actually running in production, `atlas-backend.service`, has
`WorkingDirectory=/home/pritam/personal/apps/atlas/apps/backend` — a
*different* repo from this one (`foundkeep-scenic-landing`). Confirm which
checkout is actually deployed before pointing `paddle.prod.env` at a systemd
unit or editing `deploy/`.

## Architecture: Paddle as a third provider

Paddle sits alongside Stripe (dormant) and RevenueCat (iOS) inside the same
`createBillingService`. Entitlement is still computed generically from
`customer_subscriptions` via `accountPlan()` — Paddle rows are just another
provider in that table, gated at write time (see §4).

| Route | Backed by |
| --- | --- |
| `POST /billing/checkout` | `paddleCheckout` — creates a Paddle transaction, returns `${PADDLE_CHECKOUT_ORIGIN}/checkout?_ptxn=<id>` |
| `POST /billing/portal` | `paddlePortal` — creates a Paddle customer-portal session |
| `POST /billing/paddle/sync` | `syncPaddle` — re-fetches subscription state for the account's Paddle customer |
| `POST /billing/webhooks/paddle` | `paddleWebhook` — HMAC-verified, idempotent on `event_id` |

Stripe's own routes (`/billing/webhooks/stripe`, the old Stripe `checkout`)
stay in the code but are no longer reachable from the generic buttons — they
are dead code paths kept for a possible future re-enable, not deleted.

## 1. Catalog: create the Foundkeep Pro price

`scripts/paddle-sandbox.mjs` creates (or reuses) the catalog against Paddle's
sandbox API. It only calls `sandbox-api.paddle.com`, rejects live keys, does
not print keys or provider error bodies, reuses a matching existing catalog,
and stops if an existing product/price conflicts. Its CLI lock prevents
concurrent runs against the same credentials file — after a crash, confirm no
process is running before removing a stale `.catalog.lock` file. Output files
are written exclusively (`wx`), so pick a new `--output` path per run or omit
it.

In the **sandbox dashboard**, Developer tools → Authentication → New API key:

- Name: **Foundkeep sandbox catalog**.
- Permissions: **Products — Read and Write**, **Prices — Read and Write**.
- Paste the key into BB's private credential form, not into chat — it writes
  `/home/pritam/.config/foundkeep/paddle-sandbox.env`. This file is a one-time
  catalog-creation credential, separate from the runtime keys in §2, and is
  outside the repo and not loaded by the live backend.

Preview, then apply:

```sh
node scripts/paddle-sandbox.mjs --env-file /home/pritam/.config/foundkeep/paddle-sandbox.env
node scripts/paddle-sandbox.mjs --env-file /home/pritam/.config/foundkeep/paddle-sandbox.env --apply --output /home/pritam/.config/foundkeep/paddle-sandbox-catalog.json
```

Expected catalog:

| Field | Value |
| --- | --- |
| Product | Foundkeep Pro |
| Description | Automatic tags, summaries and connections for your saved collection. Includes 500 processing credits per month and 2 GB of storage. |
| Tax category | SaaS (`saas`); must be enabled in Paddle |
| Price name | Foundkeep Pro Monthly |
| Amount / currency | 5.00 / USD |
| Billing | Recurring, every 1 month |
| Trial | None |
| Quantity | Exactly one |
| Tax calculation | External: applicable tax is added at checkout |

The report includes the non-secret `pro_…` and `pri_…` IDs. **The `pri_…`
price ID is `PADDLE_PRICE_ID`** — used directly by the backend, both to create
transactions and to assert server-side that the live price still matches this
shape before every checkout. There is no RevenueCat import step for the web
price; Paddle is not routed through RevenueCat.

## 2. Environment variables

Backend (`apps/backend`), read in `createBillingService`:

| Variable | Purpose |
| --- | --- |
| `PADDLE_API_KEY` | Server API key for transactions, customers, subscriptions, portal sessions |
| `PADDLE_WEBHOOK_SECRET` | Verifies the `Paddle-Signature` header on inbound webhooks |
| `PADDLE_PRICE_ID` | The `pri_…` from §1; asserted server-side on every checkout |
| `PADDLE_ENV` | `sandbox` (default) or `production` — gates the sandbox allow-list (§4) |
| `PADDLE_API_BASE` | `https://sandbox-api.paddle.com` (default) or `https://api.paddle.com` |
| `PADDLE_CHECKOUT_ORIGIN` | Absolute origin prefixed onto the returned `/checkout?_ptxn=…` URL (default `https://foundkeep.app`) |
| `PADDLE_SANDBOX_ACCOUNT_IDS` | Comma-separated Foundkeep account IDs allowed to hold a sandbox subscription; empty by default |

`PADDLE_API_KEY` needs write access to Customers, Subscriptions and
Transactions, plus Customer portal sessions — it creates/reads customers,
reads prices, creates transactions, creates portal sessions, lists and
cancels subscriptions, and archives customers on account deletion.

Frontend (`apps/site`), public build-time variables:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | Paddle.js client-side token (sandbox `test_…`) |
| `NEXT_PUBLIC_PADDLE_ENV` | `sandbox` or `production`, passed to `initializePaddle` |

Secrets live in `~/.config/foundkeep/paddle.dev.env` (sandbox) and
`paddle.prod.env` (live, created at go-live — §6), loaded by the backend
systemd unit via `EnvironmentFile=`, and **never committed**. The frontend's
`NEXT_PUBLIC_*` values are baked in at build time, not secret, but still kept
out of the repo alongside the backend env file for one source of truth per
environment.

## 3. Checkout flow

1. The browser calls `POST /billing/checkout`. The server (`paddleCheckout`)
   rejects an already-Pro account or a pending non-terminal subscription,
   asserts the live price still matches $5/mo USD/no-trial/qty-1, ensures a
   Paddle customer exists for the account (storing `paddle_id`), and creates a
   transaction for `PADDLE_PRICE_ID` with `custom_data.foundkeep_account`. It
   returns `${PADDLE_CHECKOUT_ORIGIN}/checkout?_ptxn=<txn_id>`.
2. The browser navigates to that URL. Paddle Billing has **no** no-JS hosted
   checkout page, so a dedicated `/checkout` route in `apps/site`
   (`app/checkout/checkout-client.tsx`) runs Paddle.js
   (`@paddle/paddle-js`, `initializePaddle({ token, environment })`) and calls
   `paddle.Checkout.open({ transactionId })`. On `checkout.completed` it
   redirects to `/dashboard?billing=success`.
3. **CSP**: `/checkout` is in `apps/site/proxy.ts`'s `config.matcher` and gets
   the same nonce + `strict-dynamic` base policy as the rest of the app, only
   *adding* `frame-src 'self' https://*.paddle.com https://sandbox-buy.paddle.com`,
   `connect-src 'self' https://*.paddle.com`, and `img-src 'self' data: blob:
   https://*.paddle.com` for that one route. `cdn.paddle.com` is deliberately
   **not** added to `script-src` — under `strict-dynamic`, Paddle.js (loaded
   from the already-nonced app bundle) is trusted without a host entry, and
   host entries are ignored under `strict-dynamic` anyway.
4. The webhook is the **source of truth**, not the browser redirect:
   `POST /billing/webhooks/paddle` verifies the `Paddle-Signature` header
   (`ts=…;h1=…`, HMAC-SHA256 over `` `${ts}:${rawBody}` ``, timing-safe
   compare, ~1h freshness bound) and dedupes on `event.event_id`. It resolves
   the account primarily by Paddle customer id (`paddle_id`) — Paddle does not
   propagate transaction `custom_data` onto subscription events — falling back
   to the `custom_data.foundkeep_account` hint. It then calls `syncPaddle`,
   which re-fetches current subscription state rather than trusting the event
   payload, and only marks the event processed after that sync succeeds. Any
   throw returns non-2xx so Paddle retries delivery.
5. `syncPaddle` and the webhook/reconcile paths are also invoked from
   `refreshProviders`, so a "Refresh plan" click (`/billing/paddle/sync` in the
   dashboard) or normal plan-page load re-verifies state without waiting on a
   webhook.

## 4. Sandbox safety

`PADDLE_ENV=sandbox` plus `PADDLE_SANDBOX_ACCOUNT_IDS` is the gate that keeps
sandbox test purchases from silently granting production Pro access:

- `syncPaddle` computes the subscription snapshot and then applies
  `gateSandbox`: if the snapshot is a sandbox subscription and the account is
  **not** in `PADDLE_SANDBOX_ACCOUNT_IDS`, the write is forced to `inactive` —
  it never reaches the account as Pro. This happens **at write time**, in the
  provider layer; `accountPlan()` stays provider-agnostic and is never used to
  filter sandbox state.
- This mirrors the equivalent RevenueCat sandbox gate
  (`REVENUECAT_ALLOW_SANDBOX` / `REVENUECAT_SANDBOX_ACCOUNT_IDS`) already used
  for the iOS path.
- On top of the write-time gate, **dev runs as a separate deployment**
  (`dev.foundkeep.app`, its own ports and its own SQLite database — §5) so
  sandbox test purchases never share a process or a database file with
  production, even before the gate is considered.

## 5. Dev environment

Dev and prod are the **same code**, differing only by env file and Paddle
account (sandbox vs. live). Promoting to prod is a config swap, not a rebuild.

| | Dev | Prod |
| --- | --- | --- |
| Host | `dev.foundkeep.app` | `foundkeep.app` |
| Backend port | `:8890` | `:8790` |
| Site port | `:8891` | `:8791` |
| Database | separate, throwaway `atlas.db` | real `atlas.db` |
| Paddle env file | `~/.config/foundkeep/paddle.dev.env` (sandbox) | `~/.config/foundkeep/paddle.prod.env` (live, §6) |
| `PADDLE_ENV` | `sandbox` + `PADDLE_SANDBOX_ACCOUNT_IDS` | `production` |
| Paddle webhook destination | `https://dev.foundkeep.app/api/billing/webhooks/paddle` | live prod webhook |

Infra steps (still pending — see Current status):

1. **Cloudflare DNS (user):** `dev` A record → `157.180.102.248` (+ AAAA →
   `2a01:4f9:3090:1055::2`), proxied.
2. **Caddy (agent):** `sudo cp` a timestamped backup first and confirm every
   existing host in `~/personal/CLAUDE.md`'s hosting table is still present —
   Caddy has silently dropped an unrelated host mid-session before — then add
   a `dev.foundkeep.app` block reverse-proxying to `:8890`/`:8891`.
3. **systemd (agent):** dev units mirroring prod (`atlas-backend.service`,
   `foundkeep-site.service`), pointed at an isolated data directory and
   `paddle.dev.env`. Mirror unit files into `deploy/`.
4. **Auth in dev:** native email/password test accounts — no Supabase
   dependency needed for the sandbox flow.

Install and build with **bun**, not npm — this is a bun workspace
(`bun install` at the repo root, `bun run --cwd apps/backend dev`, etc.). A
`package-lock.json` created by `npm install` inside `apps/site` will fight the
committed `bun.lock` and break `bun install --frozen-lockfile` in CI/deploy;
delete it and reinstall via bun if one shows up.

## 6. Paddle provisioning (REST, one dashboard step)

- `POST /client-tokens` → `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` (sandbox `test_…`).
- `POST /notification-settings` with events `transaction.completed`,
  `subscription.created`, `subscription.updated`, `subscription.canceled`,
  url = the dev webhook above → `PADDLE_WEBHOOK_SECRET`.
- **Default payment link** → `https://dev.foundkeep.app/checkout`. This may
  not be API-settable; if not, it is a ~30-second one-time dashboard step.

## 7. Go-live (gated, later)

Not in scope until sandbox has a passing real purchase end to end (§5's e2e
step). When ready:

1. Complete Paddle's seller verification, payout details, and checkout-domain
   approval for `foundkeep.app`.
2. Create a **separate live catalog** (re-run the equivalent of
   `scripts/paddle-sandbox.mjs` against `api.paddle.com`, or the dashboard),
   a live client token, and a live notification destination — kept **explicit
   and separate** from the sandbox IDs, never reused.
3. Write `~/.config/foundkeep/paddle.prod.env` with the live
   `PADDLE_API_KEY` / `PADDLE_WEBHOOK_SECRET` / `PADDLE_PRICE_ID`, and set
   `PADDLE_ENV=production`.
4. Confirm which backend unit is actually serving `foundkeep.app` (see the
   open item under Current status) before pointing it at `paddle.prod.env`.
5. Deployment and fulfillment review, then enable live checkout.

## 8. Tests

Bun unit tests mirror the existing Stripe/RevenueCat coverage, using the
injected `fetcher` seam (no `@paddle/paddle-node-sdk` — it would break that
seam):

- `apps/backend/test/paddle-migration.test.ts` — schema migration.
- `apps/backend/test/paddle-signature.test.ts` — webhook signature verify.
- `apps/backend/test/paddle-snapshot.test.ts` — subscription → snapshot
  mapping, sandbox gate.
- `apps/backend/test/paddle-billing.test.ts` — checkout guards, sync,
  provisioning, cancellation.
- `apps/backend/test/paddle-routes.test.ts` — route wiring.

Real sandbox end-to-end (pending, in dev): complete a checkout with test card
`4242 4242 4242 4242`, confirm the webhook flips an allow-listed dev account
to Pro; separately exercise Paddle's event simulator for subscription
lifecycle events.

## References

- [Paddle Billing overview](https://developer.paddle.com/build/checkout/build-branded-inline-checkout)
- [Paddle API authentication](https://developer.paddle.com/api-reference/about/authentication/)
- [Create a product](https://developer.paddle.com/api-reference/products/create-product/)
- [Create a price](https://developer.paddle.com/api-reference/prices/create-price/)
- [Create a transaction](https://developer.paddle.com/api-reference/transactions/create-transaction/)
- [Paddle.js overview](https://developer.paddle.com/paddlejs/overview)
- [Verifying webhook signatures](https://developer.paddle.com/webhooks/signature-verification)
- [Paddle pricing](https://www.paddle.com/pricing)
