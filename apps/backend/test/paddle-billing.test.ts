import { test, expect } from 'bun:test';
import { createHmac } from 'node:crypto';
import { openDb } from '../src/db.ts';
import { createBillingService } from '../src/customer-billing.ts';
import { accountPlan } from '../src/customer-plans.ts';

const price = { id: 'pri_x', status: 'active', unit_price: { amount: '500', currency_code: 'USD' }, billing_cycle: { interval: 'month', frequency: 1 }, quantity: { minimum: 1, maximum: 1 }, trial_period: null };
const env = { PADDLE_API_KEY: 'pdl_sdbx_apikey_x', PADDLE_API_BASE: 'https://sandbox-api.paddle.com', PADDLE_ENV: 'sandbox', PADDLE_PRICE_ID: 'pri_x', PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_s', PADDLE_CHECKOUT_ORIGIN: 'https://dev.foundkeep.app', PADDLE_SANDBOX_ACCOUNT_IDS: 'acc_ok' } as Record<string,string>;

function seed(id = 'acc_ok') {
  const db = openDb(':memory:');
  db.query("INSERT INTO customer_accounts(id,email,name,password_hash,recovery_hash,created_at) VALUES(?,?,'Test','x','x',0)").run(id, id + '@t.co');
  return db;
}

test('checkout asserts price, creates customer+transaction, returns /checkout url', async () => {
  const db = seed();
  const calls: string[] = [];
  const fetcher = (async (url: any, init: any) => {
    const u = String(url); calls.push(`${init?.method ?? 'GET'} ${u}`);
    if (u.includes('/customers?email=')) return new Response(JSON.stringify({ data: [] }));
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
  const fetcher = (async (_url: any) => new Response(JSON.stringify({ data: [{ id: 'sub_2', status: 'active', current_billing_period: { ends_at: future } }] }))) as typeof fetch;
  const billing = createBillingService(db, { ...env }, fetcher);
  await billing.syncPaddle('acc_no');
  expect(accountPlan(db, 'acc_no').pro).toBe(false);
});

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
  const billing = createBillingService(db, env, (async (_url: any) => new Response('{}')) as typeof fetch);
  const body = JSON.stringify({ event_id: 'evt_2', event_type: 'subscription.created', data: { customer_id: 'ctm_1' } });
  await expect(billing.paddleWebhook('ts=1;h1=' + '0'.repeat(64), body)).rejects.toBeDefined();
  expect(db.query("SELECT 1 FROM customer_billing_events WHERE provider='paddle' AND event_id='evt_2'").get()).toBeNull();
});
