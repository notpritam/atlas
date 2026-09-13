# Paddle Web Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Paddle as FoundKeep's web billing provider (sandbox first), tested end-to-end in a dedicated dev environment before promoting to production.

**Architecture:** Paddle is a third provider inside `createBillingService`, mirroring the existing Stripe provider: server-created transaction → dedicated `/checkout` page runs Paddle.js → Paddle webhook verifies + syncs into `customer_subscriptions` → `accountPlan()` grants Pro. Sandbox is gated at write time. A separate dev deployment (own DB, own ports, sandbox keys, `dev.foundkeep.app`) exercises the full flow; prod runs identical code with live keys.

**Tech Stack:** Bun, Hono, `bun:sqlite`, Next.js 16 (App Router), `@paddle/paddle-js` (frontend only), `node:crypto` (webhook HMAC), Paddle REST API, systemd, Caddy, Cloudflare DNS.

**Spec:** `docs/superpowers/specs/2026-09-12-paddle-billing-design.md`

## Global Constraints

- Backend uses the **injected `fetcher`** for all Paddle HTTP (`createBillingService(db, env, fetcher)`); **do not** add `@paddle/paddle-node-sdk`. `@paddle/paddle-js` is frontend-only.
- Price invariants (assert server-side before every checkout, verbatim): amount `"500"`, currency `USD`, `billing_cycle` `{interval:'month',frequency:1}`, `quantity {min:1,max:1}`, no trial.
- Paddle API: base from `PADDLE_API_BASE` (`https://sandbox-api.paddle.com`), header `Authorization: Bearer <PADDLE_API_KEY>`, `Content-Type: application/json`, `Paddle-Version: 1`, `redirect: 'error'`, `AbortSignal.timeout(15_000)`.
- **Sandbox gate:** if `PADDLE_ENV==='sandbox'` and the account is not in `PADDLE_SANDBOX_ACCOUNT_IDS`, `syncPaddle` writes an `inactive` snapshot. `accountPlan()` stays provider-agnostic — never filter sandbox there.
- Webhook: read raw body via `boundedText(c.req.raw)`; never `services.auth`; return non-2xx on any failure; `finishEvent` only after a successful sync; cap `event.eventId` length at 200 before dedupe insert.
- Migrations are **append-only** entries in `db.ts` `MIGRATIONS[]`; never edit an existing entry. Each runs inside `db.transaction(...)`.
- Commits: work on branch `feat/paddle-billing` (cut from current `feat/agentic-import-sidebar`). Conventional commit messages.
- Secrets live only in `/home/pritam/.config/foundkeep/*.env` (mode 600), never in the repo.

---

### Task 0: Branch + reconcile the sandbox catalog

**Files:**
- None in repo (operational). Produces `PADDLE_PRICE_ID` used by later tasks.

**Interfaces:**
- Produces: canonical sandbox `pri_…` (the Paddle price ID), written to `~/.config/foundkeep/paddle-sandbox-catalog.json`.

- [ ] **Step 1: Cut the implementation branch**

```bash
cd /home/pritam/personal/apps/foundkeep-scenic-landing
git checkout -b feat/paddle-billing
```

- [ ] **Step 2: Archive the ad-hoc catalog created earlier (Paddle has no hard delete)**

```bash
set -a; . /home/pritam/.config/foundkeep/paddle-sandbox.env; set +a
for id in pro_01m2av2xbrzpvcyb6jjv5nnc6d; do
  curl -sS -X PATCH -H "Authorization: Bearer $PADDLE_API_KEY" -H 'Content-Type: application/json' \
    "$PADDLE_API_BASE/products/$id" -d '{"status":"archived"}' | head -c 200; echo
done
curl -sS -X PATCH -H "Authorization: Bearer $PADDLE_API_KEY" -H 'Content-Type: application/json' \
  "$PADDLE_API_BASE/prices/pri_01m2av2xj7zrnk53jexcnvqeff" -d '{"status":"archived"}' | head -c 200; echo
```

Expected: each returns `"status":"archived"`.

- [ ] **Step 3: Run the canonical catalog script (preview, then apply)**

```bash
node scripts/paddle-sandbox.mjs --env-file /home/pritam/.config/foundkeep/paddle-sandbox.env
node scripts/paddle-sandbox.mjs --env-file /home/pritam/.config/foundkeep/paddle-sandbox.env \
  --apply --output /home/pritam/.config/foundkeep/paddle-sandbox-catalog.json
```

Expected: preview shows the "Foundkeep Pro" / "$5/mo USD" catalog with no conflict; apply prints a `pri_…` ID and writes the catalog JSON.

- [ ] **Step 4: Record the canonical price ID**

```bash
grep -oE 'pri_[a-z0-9]{26}' /home/pritam/.config/foundkeep/paddle-sandbox-catalog.json | head -1
```

Note the value — it is `PADDLE_PRICE_ID` for Task 9. No commit (operational task).

---

### Task 1: Migration — add `paddle` to the provider CHECK, `paddle_id` column, cleanup trigger

**Files:**
- Modify: `apps/backend/src/db.ts` (append two entries to `MIGRATIONS[]`)
- Modify: `apps/backend/src/customer-plans.ts:2` (widen `SubscriptionProvider`)
- Test: `apps/backend/test/paddle-migration.test.ts` (create)

**Interfaces:**
- Produces: `customer_subscriptions.provider` accepts `'paddle'`; `customer_billing_identities.paddle_id TEXT` (unique when non-null); `SubscriptionProvider = 'stripe'|'revenuecat'|'paddle'`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/test/paddle-migration.test.ts
import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrate } from '../src/db.ts';

test('paddle provider row and paddle_id column exist after migration', () => {
  const db = new Database(':memory:');
  migrate(db);
  db.query("INSERT INTO customer_accounts(id,email,password_hash,created_at) VALUES('a1','a@b.co','x',0)").run();
  // paddle provider now allowed by the CHECK:
  db.query("INSERT INTO customer_subscriptions(account_id,provider,status,expires_at,renews,sandbox,updated_at,next_check_at) VALUES('a1','paddle','active',9999999999999,1,1,1,0)").run();
  const row = db.query("SELECT provider FROM customer_subscriptions WHERE account_id='a1'").get() as {provider:string};
  expect(row.provider).toBe('paddle');
  // paddle_id column exists and is unique:
  db.query("INSERT INTO customer_billing_identities(account_id,revenuecat_id,created_at,paddle_id) VALUES('a1','fk_x',0,'ctm_1')").run();
  expect(() => db.query("INSERT INTO customer_accounts(id,email,password_hash,created_at) VALUES('a2','c@d.co','x',0)").run()).not.toThrow();
  expect(() => db.query("INSERT INTO customer_billing_identities(account_id,revenuecat_id,created_at,paddle_id) VALUES('a2','fk_y',0,'ctm_1')").run()).toThrow();
});
```

> Confirm `migrate` and the exact `customer_accounts` insert columns against `db.ts` before running; adjust the account insert to match the real schema if it differs.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/backend/test/paddle-migration.test.ts`
Expected: FAIL — CHECK constraint rejects `'paddle'` / no `paddle_id` column.

- [ ] **Step 3: Append the migration entries in `db.ts` `MIGRATIONS[]` (after the last existing entry)**

```ts
  // Rebuild customer_subscriptions to allow the 'paddle' provider (SQLite can't
  // alter a CHECK in place). Reproduce the CURRENT shape incl. next_check_at.
  `CREATE TABLE customer_subscriptions_new (
    account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK(provider IN ('stripe','revenuecat','paddle')),
    status TEXT NOT NULL, expires_at INTEGER NOT NULL, renews INTEGER NOT NULL DEFAULT 0,
    sandbox INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
    next_check_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(account_id,provider)
   );
   INSERT INTO customer_subscriptions_new (account_id,provider,status,expires_at,renews,sandbox,updated_at,next_check_at)
     SELECT account_id,provider,status,expires_at,renews,sandbox,updated_at,next_check_at FROM customer_subscriptions;
   DROP TABLE customer_subscriptions;
   ALTER TABLE customer_subscriptions_new RENAME TO customer_subscriptions;`,

  // Paddle customer id + partial-unique index; extend the cleanup trigger.
  `ALTER TABLE customer_billing_identities ADD COLUMN paddle_id TEXT;
   CREATE UNIQUE INDEX customer_billing_identities_paddle ON customer_billing_identities(paddle_id) WHERE paddle_id IS NOT NULL;
   DROP TRIGGER customer_billing_identity_cleanup;
   CREATE TRIGGER customer_billing_identity_cleanup BEFORE DELETE ON customer_billing_identities BEGIN
     INSERT OR IGNORE INTO customer_billing_cleanup(provider,external_id,created_at)
       SELECT 'stripe',OLD.stripe_id,CAST(strftime('%s','now') AS INTEGER)*1000 WHERE OLD.stripe_id IS NOT NULL;
     INSERT OR IGNORE INTO customer_billing_cleanup(provider,external_id,created_at)
       VALUES('revenuecat',OLD.revenuecat_id,CAST(strftime('%s','now') AS INTEGER)*1000);
     INSERT OR IGNORE INTO customer_billing_cleanup(provider,external_id,created_at)
       SELECT 'paddle',OLD.paddle_id,CAST(strftime('%s','now') AS INTEGER)*1000 WHERE OLD.paddle_id IS NOT NULL;
   END;`,
```

- [ ] **Step 4: Widen the provider type in `customer-plans.ts:2`**

```ts
export type SubscriptionProvider = 'stripe' | 'revenuecat' | 'paddle';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test apps/backend/test/paddle-migration.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/db.ts apps/backend/src/customer-plans.ts apps/backend/test/paddle-migration.test.ts
git commit -m "feat(billing): migrate schema for paddle provider"
```

---

### Task 2: Paddle webhook signature verification (`node:crypto`)

**Files:**
- Create: `apps/backend/src/paddle-signature.ts`
- Test: `apps/backend/test/paddle-signature.test.ts`

**Interfaces:**
- Produces: `verifyPaddleSignature(rawBody: string, header: string, secret: string, now?: number): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/test/paddle-signature.test.ts
import { test, expect } from 'bun:test';
import { createHmac } from 'node:crypto';
import { verifyPaddleSignature } from '../src/paddle-signature.ts';

const secret = 'pdl_ntfset_testsecret';
const body = '{"event_id":"evt_1","event_type":"subscription.created"}';
function sign(ts: number, b = body, s = secret) {
  const h1 = createHmac('sha256', s).update(`${ts}:${b}`).digest('hex');
  return `ts=${ts};h1=${h1}`;
}

test('accepts a valid, fresh signature', () => {
  const ts = Math.floor(Date.now() / 1000);
  expect(verifyPaddleSignature(body, sign(ts), secret)).toBe(true);
});
test('rejects a tampered body', () => {
  const ts = Math.floor(Date.now() / 1000);
  expect(verifyPaddleSignature(body + 'x', sign(ts), secret)).toBe(false);
});
test('rejects a wrong secret', () => {
  const ts = Math.floor(Date.now() / 1000);
  expect(verifyPaddleSignature(body, sign(ts, body, 'wrong'), secret)).toBe(false);
});
test('rejects a stale timestamp (>1h)', () => {
  const ts = Math.floor(Date.now() / 1000) - 7200;
  expect(verifyPaddleSignature(body, sign(ts), secret)).toBe(false);
});
test('rejects a malformed header', () => {
  expect(verifyPaddleSignature(body, 'garbage', secret)).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/backend/test/paddle-signature.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/backend/src/paddle-signature.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Verify a Paddle `Paddle-Signature` header (`ts=…;h1=…`) over the raw body.
 *  eventId dedupe (in the caller) is the primary replay defence; the 1h window
 *  is a coarse sanity bound that still tolerates Paddle's retry re-signing. */
export function verifyPaddleSignature(rawBody: string, header: string, secret: string, now = Date.now()): boolean {
  if (!header || !secret) return false;
  const parts: Record<string, string> = {};
  for (const seg of header.split(';')) {
    const i = seg.indexOf('=');
    if (i > 0) parts[seg.slice(0, i).trim()] = seg.slice(i + 1).trim();
  }
  const ts = parts.ts, h1 = parts.h1;
  if (!ts || !h1 || !/^\d+$/.test(ts) || !/^[a-f0-9]{64}$/.test(h1)) return false;
  if (Math.abs(now - Number(ts) * 1000) > 60 * 60 * 1000) return false;
  const expected = createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'hex'), b = Buffer.from(h1, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/backend/test/paddle-signature.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/paddle-signature.ts apps/backend/test/paddle-signature.test.ts
git commit -m "feat(billing): paddle webhook signature verification"
```

---

### Task 3: Paddle subscription snapshot mapper + write-time sandbox gate

**Files:**
- Create: `apps/backend/src/paddle-snapshot.ts`
- Test: `apps/backend/test/paddle-snapshot.test.ts`

**Interfaces:**
- Consumes: `SubscriptionSnapshot` from `customer-plans.ts` (`{status,expiresAt,renews,sandbox}`).
- Produces:
  - `paddleSnapshot(sub: any, opts: {sandbox: boolean}): SubscriptionSnapshot`
  - `gateSandbox(snapshot: SubscriptionSnapshot, allowed: boolean): SubscriptionSnapshot`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/test/paddle-snapshot.test.ts
import { test, expect } from 'bun:test';
import { paddleSnapshot, gateSandbox } from '../src/paddle-snapshot.ts';

const future = new Date(Date.now() + 30 * 86400_000).toISOString();

test('active subscription → active snapshot that renews', () => {
  const snap = paddleSnapshot({ status: 'active', current_billing_period: { ends_at: future }, scheduled_change: null }, { sandbox: false });
  expect(snap.status).toBe('active');
  expect(snap.expiresAt).toBeGreaterThan(Date.now());
  expect(snap.renews).toBe(true);
  expect(snap.sandbox).toBe(false);
});
test('scheduled cancel → active but not renewing', () => {
  const snap = paddleSnapshot({ status: 'active', current_billing_period: { ends_at: future }, scheduled_change: { action: 'cancel', effective_at: future } }, { sandbox: true });
  expect(snap.status).toBe('active');
  expect(snap.renews).toBe(false);
  expect(snap.sandbox).toBe(true);
});
test('canceled subscription → inactive', () => {
  const snap = paddleSnapshot({ status: 'canceled', current_billing_period: { ends_at: future } }, { sandbox: false });
  expect(snap.status).toBe('canceled');
});
test('sandbox gate downgrades to inactive when not allowed', () => {
  const active = { status: 'active', expiresAt: Date.now() + 1000, renews: true, sandbox: true };
  expect(gateSandbox(active, false).status).toBe('inactive');
  expect(gateSandbox(active, false).expiresAt).toBe(0);
  expect(gateSandbox(active, true).status).toBe('active');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/backend/test/paddle-snapshot.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/backend/src/paddle-snapshot.ts
import type { SubscriptionSnapshot } from './customer-plans.ts';

const ts = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : 0;

/** Map a Paddle subscription entity to our provider-agnostic snapshot.
 *  Fields to confirm against a live sandbox sub: current_billing_period.ends_at,
 *  next_billed_at, scheduled_change.action. */
export function paddleSnapshot(sub: any, opts: { sandbox: boolean }): SubscriptionSnapshot {
  const status = typeof sub?.status === 'string' ? sub.status : 'inactive';
  const active = ['active', 'trialing', 'past_due'].includes(status);
  const expiresAt = Math.max(ts(sub?.current_billing_period?.ends_at), ts(sub?.next_billed_at));
  const cancelScheduled = sub?.scheduled_change?.action === 'cancel';
  return { status, expiresAt, renews: active && !cancelScheduled, sandbox: opts.sandbox };
}

/** Write-time sandbox gate: a sandbox subscription grants nothing unless the
 *  account is explicitly allow-listed. Mirrors the RevenueCat gate. */
export function gateSandbox(snapshot: SubscriptionSnapshot, allowed: boolean): SubscriptionSnapshot {
  if (snapshot.sandbox && !allowed) return { status: 'inactive', expiresAt: 0, renews: false, sandbox: true };
  return snapshot;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/backend/test/paddle-snapshot.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/paddle-snapshot.ts apps/backend/test/paddle-snapshot.test.ts
git commit -m "feat(billing): paddle snapshot mapper + sandbox write-time gate"
```

---

### Task 4: Paddle provider in `createBillingService` — checkout, sync, portal

**Files:**
- Modify: `apps/backend/src/customer-billing.ts` (add paddle config + methods; extend `refreshProviders`)
- Test: `apps/backend/test/paddle-billing.test.ts` (create)

**Interfaces:**
- Consumes: `verifyPaddleSignature`, `paddleSnapshot`, `gateSandbox`; existing `identity()`, `serial()`, `writeSubscription`, `accountPlan`, `moduleFail`.
- Produces on the returned service object: `paddleCheckout(accountId): Promise<string>`, `paddlePortal(accountId): Promise<string>`, `syncPaddle(accountId): Promise<Plan>`, `paddleWebhook(signature, rawBody): Promise<void>`.

- [ ] **Step 1: Write the failing tests (mock fetcher; mirrors `customer-billing.test.ts` style)**

```ts
// apps/backend/test/paddle-billing.test.ts
import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrate } from '../src/db.ts';
import { createBillingService } from '../src/customer-billing.ts';
import { accountPlan } from '../src/customer-plans.ts';

const price = { id: 'pri_x', status: 'active', unit_price: { amount: '500', currency_code: 'USD' }, billing_cycle: { interval: 'month', frequency: 1 }, quantity: { minimum: 1, maximum: 1 }, trial_period: null };
const env = { PADDLE_API_KEY: 'pdl_sdbx_apikey_x', PADDLE_API_BASE: 'https://sandbox-api.paddle.com', PADDLE_ENV: 'sandbox', PADDLE_PRICE_ID: 'pri_x', PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_s', PADDLE_CHECKOUT_ORIGIN: 'https://dev.foundkeep.app', PADDLE_SANDBOX_ACCOUNT_IDS: 'acc_ok' } as Record<string,string>;

function seed(id = 'acc_ok') {
  const db = new Database(':memory:'); migrate(db);
  db.query("INSERT INTO customer_accounts(id,email,password_hash,created_at) VALUES(?,?,?,?)").run(id, id + '@t.co', 'x', 0);
  return db;
}

test('checkout asserts price, creates customer+transaction, returns /checkout url', async () => {
  const db = seed();
  const calls: string[] = [];
  const fetcher = (async (url: any, init: any) => {
    const u = String(url); calls.push(`${init?.method ?? 'GET'} ${u}`);
    if (u.endsWith('/prices/pri_x')) return new Response(JSON.stringify({ data: price }));
    if (u.endsWith('/customers') && init?.method === 'POST') return new Response(JSON.stringify({ data: { id: 'ctm_1' } }));
    if (u.endsWith('/subscriptions?customer_id=ctm_1&status=active')) return new Response(JSON.stringify({ data: [] }));
    if (u.endsWith('/transactions') && init?.method === 'POST') return new Response(JSON.stringify({ data: { id: 'txn_1' } }));
    throw new Error('unexpected ' + u);
  }) as typeof fetch;
  const billing = createBillingService(db, env, fetcher);
  const url = await billing.paddleCheckout('acc_ok');
  expect(url).toBe('https://dev.foundkeep.app/checkout?_ptxn=txn_1');
  expect(calls.some(c => c.startsWith('GET') && c.endsWith('/prices/pri_x'))).toBe(true);
  const id = db.query("SELECT paddle_id FROM customer_billing_identities WHERE account_id='acc_ok'").get() as {paddle_id:string};
  expect(id.paddle_id).toBe('ctm_1');
});

test('syncPaddle grants pro for an allow-listed sandbox account', async () => {
  const db = seed('acc_ok');
  db.query("INSERT INTO customer_billing_identities(account_id,revenuecat_id,created_at,paddle_id) VALUES('acc_ok','fk_a',0,'ctm_1')").run();
  const future = new Date(Date.now() + 30 * 86400_000).toISOString();
  const fetcher = (async (url: any) => {
    if (String(url).includes('/subscriptions?customer_id=ctm_1')) return new Response(JSON.stringify({ data: [{ id: 'sub_1', status: 'active', current_billing_period: { ends_at: future }, scheduled_change: null }] }));
    throw new Error('unexpected ' + url);
  }) as typeof fetch;
  const billing = createBillingService(db, env, fetcher);
  await billing.syncPaddle('acc_ok');
  expect(accountPlan(db, 'acc_ok').pro).toBe(true);
});

test('syncPaddle does NOT grant pro for a non-allow-listed sandbox account', async () => {
  const db = seed('acc_no');
  db.query("INSERT INTO customer_billing_identities(account_id,revenuecat_id,created_at,paddle_id) VALUES('acc_no','fk_b',0,'ctm_2')").run();
  const future = new Date(Date.now() + 30 * 86400_000).toISOString();
  const fetcher = (async () => new Response(JSON.stringify({ data: [{ id: 'sub_2', status: 'active', current_billing_period: { ends_at: future } }] }))) as typeof fetch;
  const billing = createBillingService(db, { ...env }, fetcher);
  await billing.syncPaddle('acc_no');
  expect(accountPlan(db, 'acc_no').pro).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/backend/test/paddle-billing.test.ts`
Expected: FAIL — `paddleCheckout`/`syncPaddle` not defined.

- [ ] **Step 3: Add paddle config + a request helper inside `createBillingService` (near the stripe/rc config block)**

```ts
  const paddle = {
    apiKey: env.PADDLE_API_KEY, base: env.PADDLE_API_BASE || 'https://sandbox-api.paddle.com',
    priceId: env.PADDLE_PRICE_ID, webhookSecret: env.PADDLE_WEBHOOK_SECRET,
    sandbox: (env.PADDLE_ENV || 'sandbox') === 'sandbox',
    checkoutOrigin: env.PADDLE_CHECKOUT_ORIGIN || 'https://foundkeep.app',
    sandboxAccounts: new Set((env.PADDLE_SANDBOX_ACCOUNT_IDS || '').split(',').map(s => s.trim()).filter(Boolean)),
  };
  const paddleAvailable = !!(paddle.apiKey && paddle.webhookSecret && paddle.priceId);
  async function paddleReq(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown) {
    const res = await fetcher(paddle.base + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${paddle.apiKey}`, 'Content-Type': 'application/json', 'Paddle-Version': '1' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) moduleFail(503, 'billing_unavailable', 'Payment provider is temporarily unavailable.');
    try { return (JSON.parse(await boundedText(res)) as any).data; }
    catch { moduleFail(503, 'verification_pending', 'Could not read the payment provider response.'); }
  }
```

- [ ] **Step 4: Add the paddle methods (import the helpers at top of file)**

Add to imports:
```ts
import { verifyPaddleSignature } from './paddle-signature.ts';
import { paddleSnapshot, gateSandbox } from './paddle-snapshot.ts';
```

Add methods inside `createBillingService`:
```ts
  async function syncPaddle(accountId: string) {
    if (!paddleAvailable) moduleFail(503, 'billing_unavailable', 'Web subscriptions are not configured yet.');
    return serial(`paddle:${accountId}`, async () => {
      const owned = identity(accountId);
      if (!owned.paddle_id) { writeSubscription(db, accountId, 'paddle', { status: 'inactive', expiresAt: 0, renews: false, sandbox: paddle.sandbox }); return accountPlan(db, accountId); }
      const subs = await paddleReq(`/subscriptions?customer_id=${encodeURIComponent(owned.paddle_id)}&status=active`);
      const list = Array.isArray(subs) ? subs : [];
      const relevant = list.filter((s: any) => (s.items || []).some((it: any) => it?.price?.id === paddle.priceId) || list.length === 1);
      const chosen = (relevant.length ? relevant : list).map((s: any) => paddleSnapshot(s, { sandbox: paddle.sandbox }))
        .sort((a, b) => b.expiresAt - a.expiresAt)[0] ?? { status: 'inactive', expiresAt: 0, renews: false, sandbox: paddle.sandbox };
      const gated = gateSandbox(chosen, !paddle.sandbox || paddle.sandboxAccounts.has(accountId));
      writeSubscription(db, accountId, 'paddle', gated);
      return accountPlan(db, accountId);
    });
  }

  async function ensurePaddleCustomer(accountId: string): Promise<string> {
    let owned = identity(accountId);
    if (owned.paddle_id) return owned.paddle_id;
    const email = (db.query('SELECT email FROM customer_accounts WHERE id=?').get(accountId) as { email: string }).email;
    // Reuse an existing Paddle customer for this email if present (create 409s otherwise).
    const existing = await paddleReq(`/customers?email=${encodeURIComponent(email)}`);
    const found = Array.isArray(existing) && existing[0]?.id;
    const customerId = found || (await paddleReq('/customers', 'POST', { email, custom_data: { foundkeep_account: accountId } })).id;
    identity(accountId); // never recreate access if account was deleted mid-request
    db.query('UPDATE customer_billing_identities SET paddle_id=? WHERE account_id=? AND paddle_id IS NULL').run(customerId, accountId);
    owned = identity(accountId);
    return owned.paddle_id!;
  }

  async function paddleCheckout(accountId: string) {
    if (!paddleAvailable) moduleFail(503, 'billing_unavailable', 'Web subscriptions are coming soon. Your free collection stays available.');
    return serial(`purchase:${accountId}`, async () => {
      await refreshProviders(accountId);
      if (accountPlan(db, accountId).pro) moduleFail(409, 'already_pro', 'You already have Pro. Manage the existing subscription instead.');
      if (db.query('SELECT 1 FROM customer_purchase_attempts WHERE account_id=? AND expires_at>?').get(accountId, Date.now())) moduleFail(409, 'subscription_pending', 'An App Store purchase is still pending. Finish or cancel it before opening web checkout.');
      if (accountPlan(db, accountId).subscriptions.some(s => s.provider === 'paddle' && !['inactive', 'canceled'].includes(s.status))) moduleFail(409, 'subscription_pending', 'Your existing subscription needs attention. Manage it instead.');
      const price = await paddleReq(`/prices/${encodeURIComponent(paddle.priceId!)}`);
      if (price.status !== 'active' || price.unit_price?.amount !== '500' || price.unit_price?.currency_code !== 'USD'
        || price.billing_cycle?.interval !== 'month' || price.billing_cycle?.frequency !== 1 || price.trial_period) {
        moduleFail(503, 'billing_unavailable', 'The monthly plan is not configured correctly.');
      }
      const customerId = await ensurePaddleCustomer(accountId);
      const txn = await paddleReq('/transactions', 'POST', {
        items: [{ price_id: paddle.priceId, quantity: 1 }], customer_id: customerId,
        custom_data: { foundkeep_account: accountId },
      });
      if (typeof txn?.id !== 'string') moduleFail(503, 'billing_unavailable', 'Could not open checkout.');
      return `${paddle.checkoutOrigin}/checkout?_ptxn=${txn.id}`;
    });
  }

  async function paddlePortal(accountId: string) {
    const owned = identity(accountId);
    if (!paddleAvailable || !owned.paddle_id) moduleFail(409, 'no_web_subscription', 'There is no web subscription to manage.');
    const session = await paddleReq(`/customers/${encodeURIComponent(owned.paddle_id!)}/portal-sessions`, 'POST', {});
    const url = session?.urls?.general?.overview;
    if (typeof url !== 'string') moduleFail(503, 'billing_unavailable', 'Could not open subscription settings.');
    return url;
  }
```

- [ ] **Step 5: Wire paddle into `refreshProviders` and export the methods**

In `refreshProviders`, after the stripe/revenuecat lines:
```ts
    if (paddleAvailable && owned.paddle_id) await syncPaddle(accountId);
```
Add to the returned object: `syncPaddle, paddleCheckout, paddlePortal, paddleWebhook` (webhook added in Task 5).

> Temporarily add `paddleWebhook: async () => {}` to the return so the file type-checks until Task 5 replaces it; or implement Task 5 before running the full suite.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test apps/backend/test/paddle-billing.test.ts`
Expected: PASS (3 tests) — note the third proves a non-allow-listed sandbox account does NOT get Pro (the blocker-1 guard).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/customer-billing.ts apps/backend/test/paddle-billing.test.ts
git commit -m "feat(billing): paddle checkout, sync, portal provider methods"
```

---

### Task 5: Paddle webhook handler + idempotency + reconcile/cleanup parity

**Files:**
- Modify: `apps/backend/src/customer-billing.ts` (`paddleWebhook`; `reconcileBilling`; `processBillingCleanup`)
- Test: append to `apps/backend/test/paddle-billing.test.ts`

**Interfaces:**
- Consumes: `verifyPaddleSignature`, `processed`, `finishEvent`, `syncPaddle`.
- Produces: `paddleWebhook(signature: string, rawBody: string): Promise<void>` (throws on failure → caller returns non-2xx); `reconcileBilling`/`processBillingCleanup` handle `provider='paddle'`.

- [ ] **Step 1: Write the failing tests**

```ts
// append to apps/backend/test/paddle-billing.test.ts
import { createHmac } from 'node:crypto';

function sign(body: string, secret = 'pdl_ntfset_s') {
  const ts = Math.floor(Date.now() / 1000);
  return `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')}`;
}

test('webhook: valid signature triggers sync exactly once (idempotent on eventId)', async () => {
  const db = seed('acc_ok');
  db.query("INSERT INTO customer_billing_identities(account_id,revenuecat_id,created_at,paddle_id) VALUES('acc_ok','fk_a',0,'ctm_1')").run();
  const future = new Date(Date.now() + 30 * 86400_000).toISOString();
  let syncCalls = 0;
  const fetcher = (async (url: any) => { syncCalls++; return new Response(JSON.stringify({ data: [{ id: 'sub_1', status: 'active', current_billing_period: { ends_at: future } }] })); }) as typeof fetch;
  const billing = createBillingService(db, env, fetcher);
  const body = JSON.stringify({ event_id: 'evt_1', event_type: 'subscription.created', data: { customer_id: 'ctm_1' } });
  await billing.paddleWebhook(sign(body), body);
  await billing.paddleWebhook(sign(body), body); // retry, same eventId
  expect(syncCalls).toBe(1);
  expect(accountPlan(db, 'acc_ok').pro).toBe(true);
});

test('webhook: bad signature throws (caller returns non-2xx) and does not record the event', async () => {
  const db = seed('acc_ok');
  const billing = createBillingService(db, env, (async () => new Response('{}')) as typeof fetch);
  const body = JSON.stringify({ event_id: 'evt_2', event_type: 'subscription.created', data: { customer_id: 'ctm_1' } });
  await expect(billing.paddleWebhook('ts=1;h1=' + '0'.repeat(64), body)).rejects.toBeDefined();
  expect(db.query("SELECT 1 FROM customer_billing_events WHERE provider='paddle' AND event_id='evt_2'").get()).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test apps/backend/test/paddle-billing.test.ts`
Expected: FAIL — `paddleWebhook` is the temporary no-op.

- [ ] **Step 3: Implement `paddleWebhook` (replace the temporary no-op)**

```ts
  async function paddleWebhook(signature: string, rawBody: string) {
    if (!paddleAvailable) moduleFail(503, 'billing_unavailable', 'Web billing is not configured.');
    if (!verifyPaddleSignature(rawBody, signature, paddle.webhookSecret!)) moduleFail(401, 'invalid_webhook', 'Invalid webhook signature.');
    let event: any;
    try { event = JSON.parse(rawBody); } catch { moduleFail(400, 'invalid_webhook', 'Invalid webhook body.'); }
    const eventId = event?.event_id;
    if (typeof eventId !== 'string' || eventId.length > 200 || typeof event.event_type !== 'string') moduleFail(400, 'invalid_webhook', 'Invalid webhook event.');
    if (processed('paddle', eventId)) return;
    // Resolve account by CUSTOMER ID first (custom_data does not propagate to subscription events).
    const data = event.data || {};
    const customerId = typeof data.customer_id === 'string' ? data.customer_id : (typeof data.customer === 'object' ? data.customer?.id : undefined);
    const hint = data.custom_data?.foundkeep_account;
    const owned = (customerId && db.query('SELECT account_id FROM customer_billing_identities WHERE paddle_id=?').get(customerId) as { account_id: string } | null)
      || (typeof hint === 'string' && db.query('SELECT account_id FROM customer_billing_identities WHERE account_id=?').get(hint) as { account_id: string } | null);
    if (owned) await syncPaddle(owned.account_id); // throws on provider error → non-2xx → Paddle retries; finishEvent only after success
    finishEvent('paddle', eventId);
  }
```

- [ ] **Step 4: Add paddle to `reconcileBilling` and `processBillingCleanup`**

In `reconcileBilling`, extend the SELECT filter and the per-row branch:
```ts
// add to the provider filter (mirror the stripe/revenuecat clauses):
//   OR (provider='paddle' AND ?=1)   with bind Number(!!(env.PADDLE_API_KEY && env.PADDLE_PRICE_ID))
// and in the loop:
    else if (row.provider === 'paddle') await billing.syncPaddle(row.account_id);
```

In `processBillingCleanup`, extend the SELECT filter with `OR (provider='paddle' AND ?=1)` bound on `Number(!!env.PADDLE_API_KEY)`, then add the branch:
```ts
      else if (row.provider === 'paddle') {
        const base = env.PADDLE_API_BASE || 'https://sandbox-api.paddle.com';
        const head = { Authorization: `Bearer ${env.PADDLE_API_KEY}`, 'Content-Type': 'application/json', 'Paddle-Version': '1' };
        // List and cancel EVERY subscription for the customer, then archive the customer.
        const list = await fetcher(`${base}/subscriptions?customer_id=${encodeURIComponent(row.external_id)}&status=active`, { headers: head, redirect: 'error', signal: AbortSignal.timeout(15_000) });
        if (!list.ok && list.status !== 404) throw new Error('paddle cleanup unavailable');
        const subs = list.ok ? ((JSON.parse(await list.text()) as any).data || []) : [];
        for (const s of subs) {
          const c = await fetcher(`${base}/subscriptions/${encodeURIComponent(s.id)}/cancel`, { method: 'POST', headers: head, body: JSON.stringify({ effective_from: 'immediately' }), redirect: 'error', signal: AbortSignal.timeout(15_000) });
          if (!c.ok && c.status !== 404) throw new Error('paddle cancel failed');
        }
        await fetcher(`${base}/customers/${encodeURIComponent(row.external_id)}`, { method: 'PATCH', headers: head, body: JSON.stringify({ status: 'archived' }), redirect: 'error', signal: AbortSignal.timeout(15_000) }).catch(() => {});
      }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test apps/backend/test/paddle-billing.test.ts`
Expected: PASS (5 tests total).

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/customer-billing.ts apps/backend/test/paddle-billing.test.ts
git commit -m "feat(billing): paddle webhook, reconcile + deletion cleanup parity"
```

---

### Task 6: Routes — repoint checkout/portal to Paddle, add webhook + sync

**Files:**
- Modify: `apps/backend/src/customer-billing.ts` (`registerCustomerBilling`)
- Test: `apps/backend/test/paddle-routes.test.ts` (create)

**Interfaces:**
- Consumes: `services.auth/rate/jsonBody`, `boundedText`, the paddle methods.
- Produces: `POST /billing/checkout` → paddle; `POST /billing/portal` → paddle; `POST /billing/webhooks/paddle`; `POST /billing/paddle/sync`.

- [ ] **Step 1: Write the failing test (drive the Hono app like existing route tests)**

```ts
// apps/backend/test/paddle-routes.test.ts
import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrate } from '../src/db.ts';
import { createApp } from '../src/app.ts';

test('unsigned paddle webhook returns non-2xx and is not recorded', async () => {
  const db = new Database(':memory:'); migrate(db);
  process.env.PADDLE_API_KEY = 'pdl_sdbx_apikey_x'; process.env.PADDLE_WEBHOOK_SECRET = 'pdl_ntfset_s'; process.env.PADDLE_PRICE_ID = 'pri_x';
  const app = createApp(db);
  const res = await app.request('/api/billing/webhooks/paddle', { method: 'POST', headers: { 'paddle-signature': 'ts=1;h1=' + '0'.repeat(64) }, body: '{"event_id":"evt_x","event_type":"subscription.created","data":{}}' });
  expect(res.status).toBeGreaterThanOrEqual(400);
});
```

> Confirm the mount prefix (`/api`) and `createApp` signature against `app.ts`/`customer.ts` before running.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/backend/test/paddle-routes.test.ts`
Expected: FAIL — route 404.

- [ ] **Step 3: Update `registerCustomerBilling`**

Replace the generic `for (const action of ['checkout','portal'])` loop with explicit paddle wiring, and add the two new routes:
```ts
  for (const [path, fn] of [['checkout', billing.paddleCheckout], ['portal', billing.paddlePortal]] as const) {
    app.post('/billing/' + path, async c => {
      const current = services.auth(c, true); services.rate(`billing:${current.account.id}`, 5, 60_000);
      const body = await services.jsonBody(c); if (Object.keys(body).length) moduleFail(400, 'invalid_billing_request', 'This action does not accept a price or redirect URL.');
      services.auth(c, true, false); const url = await fn(current.account.id); services.auth(c, true, false); return c.json({ url });
    });
  }
  app.post('/billing/paddle/sync', async c => {
    const current = services.auth(c, true); services.rate(`purchase-sync:${current.account.id}`, 10, 60_000);
    const result = await billing.syncPaddle(current.account.id); services.auth(c, true, false); return c.json(result);
  });
  app.post('/billing/webhooks/paddle', async c => { await billing.paddleWebhook(c.req.header('paddle-signature') || '', await boundedText(c.req.raw)); return c.json({ ok: true }); });
```

Leave the existing `/billing/webhooks/stripe`, `/billing/stripe/sync`, `/billing/revenuecat/*` routes in place (dormant/iOS).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/backend/test/paddle-routes.test.ts && bun test apps/backend/test/`
Expected: PASS; existing billing tests still green.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/customer-billing.ts apps/backend/test/paddle-routes.test.ts
git commit -m "feat(billing): route web checkout/portal/webhook to paddle"
```

---

### Task 7: Frontend `/checkout` page + CSP allowance

**Files:**
- Create: `apps/site/app/checkout/page.tsx`
- Create: `apps/site/app/checkout/checkout-client.tsx`
- Modify: `apps/site/proxy.ts` (matcher + additive CSP for `/checkout`)
- Add dep: `@paddle/paddle-js` in `apps/site/package.json`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, `NEXT_PUBLIC_PADDLE_ENV`, `_ptxn` query param.
- Produces: a route that opens Paddle.js checkout for the transaction and redirects to `/dashboard?billing=success` on completion.

- [ ] **Step 1: Install the client library**

```bash
cd apps/site && npm install @paddle/paddle-js && cd -
```

- [ ] **Step 2: Create the checkout client component**

```tsx
// apps/site/app/checkout/checkout-client.tsx
'use client';
import { initializePaddle, type Paddle } from '@paddle/paddle-js';
import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

export function CheckoutClient() {
  const ptxn = useSearchParams().get('_ptxn');
  const router = useRouter();
  const [error, setError] = useState(false);
  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    const environment = process.env.NEXT_PUBLIC_PADDLE_ENV as 'sandbox' | 'production' | undefined;
    if (!token || !environment || !ptxn) { setError(true); return; }
    let paddle: Paddle | undefined;
    initializePaddle({
      token, environment,
      eventCallback: (e) => { if (e.name === 'checkout.completed') router.replace('/dashboard?billing=success'); },
    }).then((p) => { paddle = p; p?.Checkout.open({ transactionId: ptxn }); }).catch(() => setError(true));
    return () => { try { paddle?.Checkout.close?.(); } catch {} };
  }, [ptxn, router]);
  if (error) return <main style={{ padding: 48, textAlign: 'center' }}>Couldn’t open checkout. <a href="/dashboard">Back to dashboard</a>.</main>;
  return <main style={{ padding: 48, textAlign: 'center' }}>Opening secure checkout…</main>;
}
```

- [ ] **Step 3: Create the route page (server component wrapper)**

```tsx
// apps/site/app/checkout/page.tsx
import { Suspense } from 'react';
import { CheckoutClient } from './checkout-client';

export const metadata = { title: 'Checkout · Foundkeep' };
export default function CheckoutPage() {
  return <Suspense><CheckoutClient /></Suspense>;
}
```

- [ ] **Step 4: Add `/checkout` to the CSP middleware — additive only**

In `apps/site/proxy.ts`: add `/checkout` to `config.matcher`, and where the CSP string is built, append Paddle sources to the EXISTING nonce policy (do not remove `strict-dynamic`, `default-src`, `base-uri`, `object-src`, `frame-ancestors`). Concretely, extend the `frame-src`/`connect-src`/`img-src` directives:

```ts
// pseudo-diff against the existing directive list in proxy.ts:
//   frame-src 'self'                    ->  frame-src 'self' https://*.paddle.com https://sandbox-buy.paddle.com
//   connect-src 'self'                  ->  connect-src 'self' https://*.paddle.com
//   img-src 'self' data:                ->  img-src 'self' https://*.paddle.com data: blob:
// script-src stays: 'self' 'nonce-…' 'strict-dynamic'   (Paddle.js is injected from the nonced bundle;
//                                                         do NOT add cdn.paddle.com — ignored under strict-dynamic)
```

Apply the Paddle additions only when the request path is `/checkout` (leave dashboard/auth policies unchanged).

- [ ] **Step 5: Verify locally (no e2e infra yet)**

Run: `cd apps/site && npm run build`
Expected: build passes; `/checkout` compiles. (Full open-checkout verification happens in Task 13 against dev.)

- [ ] **Step 6: Commit**

```bash
git add apps/site/app/checkout apps/site/proxy.ts apps/site/package.json apps/site/package-lock.json
git commit -m "feat(site): paddle checkout page + scoped CSP allowance"
```

---

### Task 8: Frontend plan UI — Paddle-aware branching + redirect allowlist

**Files:**
- Modify: `apps/site/components/dashboard/collection-services.tsx`
- Test: `tests/collection-services.mjs` (extend)

**Interfaces:**
- Consumes: `POST /billing/checkout` → `{url}` (now `https://…/checkout?_ptxn=…`), `POST /billing/paddle/sync`, `POST /billing/portal` → Paddle portal url.
- Produces: a Paddle-aware "YOUR PLAN" section: Get Pro, Manage subscription, Refresh plan.

- [ ] **Step 1: Extend the plan type + provider branching**

- Add `paddle` to the `Plan.billing` shape (`billing.paddle: { available: boolean; canManage: boolean }`) and to `configuration()` in `customer-billing.ts` (return `paddle: { available: paddleAvailable, canManage: !!owned.paddle_id }`).
- In `collection-services.tsx`: treat a `subscriptions.some(s => s.provider === 'paddle')` (or `billing.paddle.canManage`) subscriber as web-managed → show "Manage subscription" (calls `/billing/portal`); keep the Apple link only for `provider === 'revenuecat'`.

- [ ] **Step 2: Fix the redirect allowlist for the same-origin checkout URL**

The current code hardcodes `checkout.stripe.com`. Replace the host check so it accepts the site's own origin (the `/checkout` path) and the Paddle portal host:
```ts
const dest = new URL(result.url, window.location.origin); // tolerate absolute or relative
const ok = dest.origin === window.location.origin || /(^|\.)paddle\.com$/.test(dest.hostname);
if (ok) window.location.assign(dest.href);
```
Point "Refresh plan" at `/billing/paddle/sync`.

- [ ] **Step 3: Extend the frontend test**

Add a case to `tests/collection-services.mjs`: mock `POST /api/billing/checkout` → `{url:'https://dev.foundkeep.app/checkout?_ptxn=txn_1'}`, click "Get Pro", assert the page navigates to `/checkout?_ptxn=txn_1` (same-origin allowed). Follow the existing mocking pattern in that file.

- [ ] **Step 4: Run tests**

Run: `node --test tests/collection-services.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/site/components/dashboard/collection-services.tsx apps/backend/src/customer-billing.ts tests/collection-services.mjs
git commit -m "feat(site): paddle-aware plan UI + same-origin checkout redirect"
```

---

### Task 9: Env files + config plumbing

**Files:**
- Create (outside repo): `/home/pritam/.config/foundkeep/paddle.dev.env` (mode 600)
- Modify: `apps/backend/src/config.ts` (surface the new env if config is centralized there; else backend already reads `process.env`)
- Modify: `.env.example`-style docs if the repo keeps one (it does not — document in the rewritten PADDLE-SETUP)

**Interfaces:**
- Produces: dev env file consumed by the dev backend unit (Task 10).

- [ ] **Step 1: Write the dev env file (values from Task 0 + Task 12)**

```bash
umask 077
cat > /home/pritam/.config/foundkeep/paddle.dev.env <<EOF
PADDLE_ENV=sandbox
PADDLE_API_BASE=https://sandbox-api.paddle.com
PADDLE_API_KEY=<sandbox api key from paddle-sandbox.env>
PADDLE_PRICE_ID=<pri_ from Task 0>
PADDLE_WEBHOOK_SECRET=<pdl_ntfset_ from Task 12>
PADDLE_CHECKOUT_ORIGIN=https://dev.foundkeep.app
PADDLE_SANDBOX_ACCOUNT_IDS=<your test account id(s), comma-separated>
EOF
chmod 600 /home/pritam/.config/foundkeep/paddle.dev.env
```

- [ ] **Step 2: Confirm the backend reads these**

Verify `config.ts` and `customer-billing.ts` reference each var name exactly. If `config.ts` centralizes env, add the paddle keys there; otherwise no code change (service reads `process.env`).

- [ ] **Step 3: (No commit — secrets file is outside the repo.)** Record the var names in the rewritten doc (Task 14).

---

### Task 10: systemd dev units (backend :8890, site :8891)

**Files:**
- Create: `deploy/systemd/foundkeep-backend-dev.service`
- Create: `deploy/systemd/foundkeep-site-dev.service`

**Interfaces:**
- Produces: a running dev backend on `127.0.0.1:8890` (own DB) + dev site on `127.0.0.1:8891` pointing at it.

- [ ] **Step 1: Author the dev backend unit (mirror `deploy/atlas-backend.service`, changing port + data dir + env files)**

```ini
# deploy/systemd/foundkeep-backend-dev.service
[Unit]
Description=Foundkeep backend (DEV/sandbox)
After=network.target
[Service]
Type=simple
WorkingDirectory=/home/pritam/personal/apps/foundkeep-scenic-landing/apps/backend
Environment=ATLAS_PORT=8890
Environment=ATLAS_DATA_DIR=/home/pritam/.local/share/foundkeep-dev
EnvironmentFile=-/home/pritam/.config/foundkeep/paddle.dev.env
ExecStart=/home/pritam/.bun/bin/bun run src/index.ts
Restart=on-failure
[Install]
WantedBy=default.target
```

> Confirm the real prod unit's exact `ExecStart`, user/service scope (`--user`?), and env-file set; copy anything the backend needs (origins etc.) into a dev equivalent. The prod unit's `WorkingDirectory` points at `…/apps/atlas/…` — verify the actually-deployed path first (spec §7).

- [ ] **Step 2: Author the dev site unit (mirror `deploy/foundkeep-site.service`)**

```ini
# deploy/systemd/foundkeep-site-dev.service
[Unit]
Description=Foundkeep site (DEV/sandbox)
After=network.target
[Service]
Type=simple
WorkingDirectory=/home/pritam/personal/apps/foundkeep-scenic-landing/apps/site
Environment=PORT=8891
Environment=FOUNDKEEP_BACKEND_URL=http://127.0.0.1:8890
Environment=NEXT_PUBLIC_PADDLE_ENV=sandbox
Environment=NEXT_PUBLIC_PADDLE_CLIENT_TOKEN=<test_ token from Task 12>
ExecStart=/usr/bin/npm run start
Restart=on-failure
[Install]
WantedBy=default.target
```

- [ ] **Step 3: Install, build the site, start the units**

```bash
cp deploy/systemd/foundkeep-*-dev.service ~/.config/systemd/user/    # or /etc/systemd/system with sudo, matching prod
systemctl --user daemon-reload
(cd apps/site && npm run build)
systemctl --user enable --now foundkeep-backend-dev foundkeep-site-dev
```

- [ ] **Step 4: Verify both listen**

Run:
```bash
curl -s http://127.0.0.1:8890/healthz && echo OK-backend
curl -sI http://127.0.0.1:8891 | head -1
```
Expected: backend healthz 200; site responds.

- [ ] **Step 5: Commit the unit files (secrets are NOT in them)**

```bash
git add deploy/systemd/foundkeep-backend-dev.service deploy/systemd/foundkeep-site-dev.service
git commit -m "chore(deploy): dev systemd units for sandbox billing"
```

---

### Task 11: Caddy — `dev.foundkeep.app` block (backup + host-integrity check first)

**Files:**
- Modify: `/etc/caddy/Caddyfile` (add a block)
- Modify: `deploy/Caddyfile` (mirror the block into the repo template)

**Interfaces:**
- Produces: `https://dev.foundkeep.app` → dev backend/site (once the Cloudflare DNS record exists).

- [ ] **Step 1: Back up and confirm every existing host is present (per CLAUDE.md warning)**

```bash
sudo cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%s)"
grep -c '{' /etc/caddy/Caddyfile
grep -E 'foundkeep\.app|atlas\.notpritam|mailroom\.notpritam|cutroom\.notpritam|rig\.notpritam' /etc/caddy/Caddyfile
```
Expected: every host in the hosting table is still listed. If any is missing, STOP and restore from a backup.

- [ ] **Step 2: Add the dev block (mirror the foundkeep.app block, ports 8890/8891)**

```
dev.foundkeep.app {
	tls internal
	encode zstd gzip
	@backend path /api /api/* /v1 /v1/* /admin /admin/* /agent /agent/* /invite /invite/* /ext /ext/* /healthz /customer-config.json /mobile-policy.json /updates.xml /atlas-extension.zip /foundkeep-extension.zip /.well-known/* /redeem /redeem.html
	handle @backend { reverse_proxy 127.0.0.1:8890 }
	handle { reverse_proxy 127.0.0.1:8891 }
}
```

- [ ] **Step 3: Validate + reload**

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```
Expected: validation OK; reload succeeds.

- [ ] **Step 4: Verify end-to-end once DNS exists**

Run: `curl -s https://dev.foundkeep.app/healthz`
Expected: 200. (If DNS not yet added, this fails — that's the pending user action.)

- [ ] **Step 5: Commit the repo mirror**

```bash
git add deploy/Caddyfile
git commit -m "chore(deploy): dev.foundkeep.app caddy block"
```

---

### Task 12: Provision Paddle client token + notification destination

**Files:** none (operational; fills Task 9 env values)

**Interfaces:**
- Produces: `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` (`test_…`), `PADDLE_WEBHOOK_SECRET` (`pdl_ntfset_…`).

- [ ] **Step 1: Create the client-side token**

```bash
set -a; . /home/pritam/.config/foundkeep/paddle-sandbox.env; set +a
curl -sS -X POST -H "Authorization: Bearer $PADDLE_API_KEY" -H 'Content-Type: application/json' \
  "$PADDLE_API_BASE/client-tokens" -d '{"name":"Foundkeep dev frontend"}'
```
Record the returned `token` (`test_…`) into `paddle.dev.env` / the dev site unit.

- [ ] **Step 2: Create the notification destination → dev webhook**

```bash
curl -sS -X POST -H "Authorization: Bearer $PADDLE_API_KEY" -H 'Content-Type: application/json' \
  "$PADDLE_API_BASE/notification-settings" -d '{
    "description":"Foundkeep dev","type":"url","destination":"https://dev.foundkeep.app/api/billing/webhooks/paddle",
    "subscribed_events":["transaction.completed","subscription.created","subscription.updated","subscription.canceled"]
  }'
```
Record the returned `endpoint_secret_key` (`pdl_ntfset_…`) into `PADDLE_WEBHOOK_SECRET`.

- [ ] **Step 3: Set the default payment link → `/checkout`**

Try the API (endpoint may vary); if it 404s/403s, do it in the dashboard (Checkout → Checkout settings → Default payment link = `https://dev.foundkeep.app/checkout`). Document whichever path worked.

- [ ] **Step 4: Restart dev units to load the new env**

```bash
systemctl --user restart foundkeep-backend-dev foundkeep-site-dev
```

---

### Task 13: End-to-end sandbox verification

**Files:** none (verification)

- [ ] **Step 1: Add a test account id to `PADDLE_SANDBOX_ACCOUNT_IDS`, restart backend**

Sign up a test account at `https://dev.foundkeep.app`, get its `customer_accounts.id` from the dev DB, add it to `PADDLE_SANDBOX_ACCOUNT_IDS` in `paddle.dev.env`, `systemctl --user restart foundkeep-backend-dev`.

- [ ] **Step 2: Drive the flow**

Click "Get Pro" → lands on `/checkout` → complete with test card `4242 4242 4242 4242`, any future expiry, any CVC → redirect to `/dashboard?billing=success`.

- [ ] **Step 3: Confirm provisioning via the webhook (source of truth)**

```bash
# dev DB path = ATLAS_DATA_DIR/atlas.db
sqlite3 /home/pritam/.local/share/foundkeep-dev/atlas.db \
  "SELECT provider,status,sandbox FROM customer_subscriptions;"
```
Expected: a `paddle | active | 1` row for the test account; the dashboard shows PRO.

- [ ] **Step 4: Negative check — the sandbox gate**

Repeat with an account NOT in `PADDLE_SANDBOX_ACCOUNT_IDS`; confirm the row is written `inactive` and the dashboard stays FREE (proves a stray sandbox purchase can never grant prod Pro).

- [ ] **Step 5: Simulator checks**

Paddle dashboard → Developer tools → Simulations → run `subscription.canceled` for the customer; confirm the dev account drops to FREE and the notification log shows 200.

---

### Task 14: Rewrite `docs/PADDLE-SETUP.md` to the direct-Paddle architecture

**Files:**
- Modify: `docs/PADDLE-SETUP.md`

- [ ] **Step 1: Replace the Paddle-via-RevenueCat content** with the direct-Paddle model: catalog, env vars (dev/prod split), the `/checkout` page, the webhook + sandbox gate, the dev environment + `dev.foundkeep.app`, and the go-live checklist (create live catalog/token/destination, set `paddle.prod.env`, deployment review). RevenueCat remains documented as the **iOS** path only.

- [ ] **Step 2: Commit**

```bash
git add docs/PADDLE-SETUP.md
git commit -m "docs: rewrite paddle setup for direct billing + dev environment"
```

---

## Self-Review

**Spec coverage:** §1 decisions → Tasks 0,6,7 (replace-stripe, /checkout) + 14 (doc). §3.1 migration → Task 1. §3.2 provider (sync/checkout/portal/webhook/reconcile/cleanup/sandbox-gate) → Tasks 3,4,5. §3.3 routes → Task 6. §3.4 frontend + CSP → Tasks 7,8. §4 dev/prod → Tasks 9,10,11 (+ promotion documented in 14). §5 provisioning → Tasks 0,12. §6 tests → Tasks 1,2,3,4,5,6,8,13. §7 open items → flagged in Tasks 4 (fields), 10 (deploy path), 12 (default payment link). §8 non-goals → not implemented. No gaps.

**Placeholder scan:** the `<…>` tokens in Tasks 9/10/12 are runtime secret values produced by earlier tasks (correct — they can't be hardcoded); every code step contains real code. No "TODO/handle edge cases/similar-to" placeholders.

**Type consistency:** `SubscriptionSnapshot {status,expiresAt,renews,sandbox}` used identically in Tasks 3/4/5; `paddleCheckout/paddlePortal/syncPaddle/paddleWebhook` names consistent across Tasks 4,5,6; env var names (`PADDLE_API_KEY/API_BASE/ENV/PRICE_ID/WEBHOOK_SECRET/CHECKOUT_ORIGIN/SANDBOX_ACCOUNT_IDS`) consistent across Tasks 4,9,10,12.
