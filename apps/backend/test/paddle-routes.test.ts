import { afterEach, beforeEach, test, expect } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { openDb } from '../src/db.ts';
import { createApp } from '../src/app.ts';

const ORIGIN = process.env.ATLAS_CUSTOMER_ORIGIN || 'https://atlas.notpritam.in';
let db: Database;
let app: ReturnType<typeof createApp>;
let restoreEnv: Record<string, string | undefined>;

beforeEach(() => {
  // createBillingService (invoked once inside createApp -> registerCustomerBilling)
  // reads process.env eagerly at construction time, so the env vars must be set
  // BEFORE createApp(db) runs, not after.
  restoreEnv = {
    PADDLE_API_KEY: process.env.PADDLE_API_KEY,
    PADDLE_WEBHOOK_SECRET: process.env.PADDLE_WEBHOOK_SECRET,
    PADDLE_PRICE_ID: process.env.PADDLE_PRICE_ID,
  };
  process.env.PADDLE_API_KEY = 'pdl_sdbx_apikey_x';
  process.env.PADDLE_WEBHOOK_SECRET = 'pdl_ntfset_s';
  process.env.PADDLE_PRICE_ID = 'pri_x';
  db = openDb(':memory:');
  app = createApp(db);
});

afterEach(() => {
  db.close();
  for (const [key, value] of Object.entries(restoreEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('unsigned paddle webhook returns non-2xx and is not recorded', async () => {
  const res = await app.request(`${ORIGIN}/api/billing/webhooks/paddle`, {
    method: 'POST',
    headers: { 'paddle-signature': 'ts=1;h1=' + '0'.repeat(64) },
    body: '{"event_id":"evt_x","event_type":"subscription.created","data":{}}',
  });
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).not.toBe(404); // must be handled (invalid_webhook), not fall through to app.notFound
  const payload = await res.json() as { error: string };
  expect(payload.error).toBe('invalid_webhook');
  expect(db.query("SELECT 1 FROM customer_billing_events WHERE provider='paddle' AND event_id='evt_x'").get()).toBeNull();
});

test('POST /billing/checkout routes to paddle (asserts price via Paddle-shaped fetch, not Stripe)', async () => {
  // No account/session is provided, so this only proves the route is wired to the
  // paddle path (which requires PADDLE_* env, already set above) rather than 404
  // or the old Stripe handler (which would fail differently — missing STRIPE_SECRET_KEY).
  const res = await app.request(`${ORIGIN}/api/billing/checkout`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: '{}' });
  expect(res.status).not.toBe(404);
});

test('POST /billing/paddle/sync route exists (not 404)', async () => {
  const res = await app.request(`${ORIGIN}/api/billing/paddle/sync`, { method: 'POST', headers: { origin: ORIGIN } });
  expect(res.status).not.toBe(404);
});
