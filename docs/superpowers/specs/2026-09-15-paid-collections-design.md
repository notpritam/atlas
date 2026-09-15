# Paid Collections (Marketplace) — Design Spec

Date: 2026-09-15
Status: Approved for implementation (web-first MVP)

## Goal

Let a creator put a collection up for sale. Buyers pay a FoundKeep-set price
through FoundKeep's payment rail; FoundKeep keeps a commission and credits the
creator's earnings. A purchase grants the buyer ongoing read access to the
collection's entries, including entries the creator adds later ("buy once, keep
getting new finds").

## Locked decisions

- **What's sold:** a one-time purchase → ongoing read access to the collection's
  *entries* (title/url/body/tags + one shared image each), including future
  additions. Never the creator's underlying private library.
- **Payouts:** an earnings ledger with **manual** payouts (no Stripe Connect / KYC
  in the MVP). FoundKeep collects, records the split, and pays creators
  out-of-band; payout requests and fulfillment are logged.
- **Pricing:** FoundKeep-defined fixed tiers — **$3 / $5 / $9 / $19 USD**. Each maps
  to a pre-created Paddle one-time price ID.
- **Commission:** **15%**, stored per-sale (so historical rate is preserved if the
  rate changes later). Configurable via env.
- **Payment rail:** **Paddle** (the existing configured web rail), one-time
  transactions. Buyer needs a FoundKeep account.
- **Surface:** web-first (dashboard seller controls + storefront + checkout;
  price badge in existing public discovery). Mobile/MCP purchasing deferred.

## Existing code this builds on (from repo map)

- Access model + all collection routes: `apps/backend/src/customer-collections.ts`
  — authorization funnels through `role(row, accountId)` (owner/member/null) and
  `read(id, accountId)` (`public || role != null`); `detail()` builds the entry
  listing; `read_collection_image` streams a shared image. Mounted from
  `apps/backend/src/customer.ts:498`.
- Schema + migration patterns: `apps/backend/src/db.ts` (collections tables
  ~499–537; CHECK-rebuild migration pattern ~473–484).
- Billing rail: `apps/backend/src/customer-billing.ts` (Paddle `paddleCheckout`
  ~143, `paddleWebhook` ~244, route `POST /billing/webhooks/paddle` ~339;
  signature in `paddle-signature.ts`, snapshot in `paddle-snapshot.ts`); webhook
  idempotency via `customer_billing_events`.
- Entitlement/plan: `apps/backend/src/customer-plans.ts` (`accountPlan`).
- MCP tool catalog: `apps/backend/src/customer-mcp-catalog.ts`.

## Data model (SQLite, `db.ts` migration)

Add to `customer_collections` (new columns; do **not** alter the `visibility`
CHECK — a for-sale collection keeps `visibility='public'` for card discovery,
entries are gated by purchase):

- `for_sale INTEGER NOT NULL DEFAULT 0`
- `price_tier TEXT` — one of the tier keys (`t3`,`t5`,`t9`,`t19`) or NULL
- `currency TEXT NOT NULL DEFAULT 'USD'`
- `listed_at INTEGER` — when first listed (nullable)

New table `customer_collection_purchases`:
`id TEXT PK, collection_id TEXT NOT NULL, buyer_id TEXT NOT NULL, seller_id TEXT
NOT NULL, price_cents INTEGER NOT NULL, commission_cents INTEGER NOT NULL,
currency TEXT NOT NULL, provider TEXT NOT NULL, provider_txn_id TEXT,
status TEXT NOT NULL CHECK(status IN ('pending','paid','refunded')) DEFAULT
'pending', created_at INTEGER, updated_at INTEGER`.
Indexes: UNIQUE `(collection_id, buyer_id)` where status != 'refunded' (enforce
in code: one active purchase per buyer per collection); `(seller_id, status)`;
`(buyer_id, status)`; UNIQUE `(provider, provider_txn_id)` for webhook idempotency.

New table `customer_payouts`:
`id TEXT PK, seller_id TEXT NOT NULL, amount_cents INTEGER NOT NULL, currency
TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('requested','paid',
'rejected')) DEFAULT 'requested', note TEXT, created_at INTEGER, updated_at
INTEGER`. Index `(seller_id, status)`.

Seller balance is derived, not stored:
`balance = Σ(price_cents - commission_cents) over purchases where status='paid'
and seller_id=me  −  Σ(amount_cents) over payouts where status in
('requested','paid') and seller_id=me`.

## Pricing & commission (config)

- `MARKETPLACE_TIERS` — code constant mapping tier key → `{cents, paddlePriceId}`;
  Paddle price IDs supplied via env (e.g. `PADDLE_PRICE_COLLECTION_T5`).
- `MARKETPLACE_COMMISSION_BPS` (default `1500` = 15%). Commission per sale =
  `round(price_cents * bps / 10000)`; creator share = `price_cents - commission`.
- Tier metadata (label, cents) is server-authoritative; the client only sends a
  tier key, never a price.

## Access control changes (`customer-collections.ts`)

- Add `hasPurchased(db, collectionId, accountId)` → boolean (a `paid` purchase row).
- Extend the read gate so a for-sale collection's **card** stays public but its
  **entries** require owner/member/**buyer**:
  - `read()` unchanged for the card/metadata (public listing still resolves).
  - `detail()` entry query: when `for_sale=1` and the viewer is not
    owner/member and has not purchased, return the card with an empty/locked
    entry list + a `paywalled: true` + price/tier fields (so the storefront can
    render "Buy for $X"). Owner/member/buyer see full entries.
  - `read_collection_image`: 402/404 for non-buyers on a for-sale collection.
- A paid buyer's collection appears in their `GET /collections` listing (extend
  the follow/membership union with purchased collections).

## Buyer flow (web)

1. Storefront: `GET /public/collections/:slug` returns card + `paywalled` +
   `priceTier`/`priceCents` when `for_sale=1`.
2. `POST /collections/:id/purchase` (auth required): validates the collection is
   for sale, not already owned/purchased by this account; creates a Paddle
   one-time transaction for the tier's price ID with
   `custom_data:{kind:'collection_purchase', collectionId, buyerId, tier}`;
   inserts a `pending` purchase row; returns the Paddle checkout URL.
3. `paddleWebhook` new branch: on `transaction.completed` (or paid) where
   `custom_data.kind==='collection_purchase'`, mark the purchase `paid`, set
   `provider_txn_id`, compute+store commission. Idempotent via
   `customer_billing_events` + the UNIQUE `(provider, provider_txn_id)`.
   Refund/chargeback event → `refunded` (revokes access).

## Seller flow (web dashboard)

- `POST /collections/:id/list` (owner-only): set `for_sale=1`, `price_tier`,
  `listed_at`. `POST /collections/:id/unlist`: `for_sale=0` (existing buyers keep
  access).
- `GET /seller/earnings`: totals (sales count, gross, commission, net balance),
  recent sales, payout history.
- `POST /seller/payouts`: create a `requested` payout for the current balance
  (or a requested amount ≤ balance). Admin/manual fulfillment marks it `paid`
  (existing `/admin/*` surface or a documented manual SQL/endpoint).

## Storefront / discovery

- `discover_collections` / `GET /public/collections`: include for-sale
  collections with `forSale`, `priceCents`, `priceLabel` on the card so the badge
  renders. No change to private visibility.

## API / MCP surface

- New HTTP routes above, registered alongside `registerCustomerCollections` and
  `registerCustomerBilling`.
- MCP: add read-only `get_marketplace` / seller `list_collection_for_sale` /
  `get_earnings` tools to the catalog (buying stays web-only — no MCP purchase).
  Purchase/payout tools that move money are gated to explicit user intent per the
  MCP server rules.

## Web UI (`apps/web` dashboard + `apps/site` storefront)

- Dashboard: on an owned collection, a "Sell this collection" control (tier
  picker, list/unlist). An "Earnings" panel (balance, sales, request payout).
- Storefront: for-sale collection page shows card + locked entry preview + "Buy
  for $X" → Paddle checkout; on return, entries unlock.
- Discovery: price badge on for-sale cards.

## Config / ops

- Env (systemd drop-in, mirrored to `.env.example` shape): `PADDLE_PRICE_COLLECTION_T3/T5/T9/T19`,
  `MARKETPLACE_COMMISSION_BPS=1500`.
- Paddle dashboard: create four one-time (non-recurring) prices; put their IDs in
  env. **This is a human step** (needs Paddle console) — implementation ships
  with the wiring and reads IDs from env; sandbox IDs for testing.

## Testing (bun, mirror `customer-*.test.ts`)

- Non-buyer sees a for-sale card but **no entries** (paywalled); owner/member/buyer
  see entries.
- `read_collection_image` denied for non-buyers on for-sale collections.
- Purchase webhook: pending→paid grants access; commission math (15% of each
  tier); idempotent on duplicate webhook; refund revokes access.
- Buyer sees entries added **after** purchase.
- Seller balance = Σ net − payouts; payout request reduces available balance;
  can't request more than balance.
- Can't purchase own collection / can't double-purchase.
- Tier is server-authoritative (client can't set an arbitrary price).

## Out of scope (MVP)

Automated payouts / Stripe Connect / KYC; custom (free-form) pricing; in-app
(iOS/Android) buying; ratings/reviews; coupons/discounts; self-serve refunds;
multi-currency (USD only).

## Rollout

1. Ship behind a flag / dev-first; verify the full purchase→grant→access loop in
   Paddle **sandbox** before enabling on production.
2. Create real Paddle prices + set prod env IDs when going live.
3. Manual payouts run off-platform; document the fulfillment step.
