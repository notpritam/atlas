import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPaddleSandbox } from '../scripts/paddle-sandbox.mjs';

const key = 'pdl_sdbx_apikey_' + 'a'.repeat(26) + '_' + 'b'.repeat(22) + '_ccc';
const productId = 'pro_' + 'a'.repeat(26);
const priceId = 'pri_' + 'b'.repeat(26);
const product = { id: productId, name: 'Foundkeep Pro', status: 'active', tax_category: 'saas', custom_data: { foundkeep_catalog: 'pro-v1' } };
const price = { id: priceId, product_id: productId, status: 'active', unit_price: { amount: '500', currency_code: 'USD' }, billing_cycle: { interval: 'month', frequency: 1 }, trial_period: null, tax_mode: 'external', quantity: { minimum: 1, maximum: 1 }, unit_price_overrides: [] };
const page = (data, next = null) => Response.json({ data, meta: { pagination: { has_more: !!next, next } } });

test('preview reports the proposed catalog without creating products or prices', async () => {
  const report = await setupPaddleSandbox({ apiKey: key, fetcher: async (url, init) => {
    assert.equal(init.method, 'GET');
    assert.equal(new URL(url).origin, 'https://sandbox-api.paddle.com');
    return page([]);
  } });
  assert.equal(report.environment, 'sandbox');
  assert.equal(report.product.action, 'would-create');
  assert.deepEqual(report.price.fields.unit_price, { amount: '500', currency_code: 'USD' });
  assert.deepEqual(report.price.fields.quantity, { minimum: 1, maximum: 1 });
  assert.equal(report.price.fields.trial_period, null);
});

test('applying creates the monthly catalog once and subsequent runs reuse it', async () => {
  let products = [], prices = [], writes = 0;
  const fetcher = async (url, init) => {
    const path = new URL(url).pathname;
    assert.equal(init.headers.Authorization, `Bearer ${key}`);
    assert.equal(init.redirect, 'error');
    if (init.method === 'GET') return page(path === '/products' ? products : prices);
    writes++;
    const body = JSON.parse(init.body);
    if (path === '/products') {
      assert.equal(body.tax_category, 'saas');
      products = [{ ...body, id: productId, status: 'active' }];
      return Response.json({ data: products[0] }, { status: 201 });
    }
    assert.equal(body.product_id, productId);
    assert.deepEqual(body.billing_cycle, { interval: 'month', frequency: 1 });
    assert.equal(body.unit_price.amount, '500');
    prices = [{ ...body, id: priceId, status: 'active', unit_price_overrides: [] }];
    return Response.json({ data: prices[0] }, { status: 201 });
  };
  const first = await setupPaddleSandbox({ apiKey: key, apply: true, fetcher });
  assert.equal(first.product.id, productId);
  assert.equal(first.price.id, priceId);
  const second = await setupPaddleSandbox({ apiKey: key, apply: true, fetcher });
  assert.equal(second.product.action, 'reuse');
  assert.equal(second.price.action, 'reuse');
  assert.equal(writes, 2);
  assert.ok(!JSON.stringify(second).includes(key));
});

test('searches later catalog pages before deciding whether to create anything', async () => {
  const fetcher = async (url, init) => {
    assert.equal(init.method, 'GET');
    const parsed = new URL(url);
    if (parsed.pathname === '/prices') return page([price]);
    if (parsed.searchParams.has('after')) return page([product]);
    return page([], 'https://sandbox-api.paddle.com/products?after=pro_cursor');
  };
  const report = await setupPaddleSandbox({ apiKey: key, apply: true, fetcher });
  assert.equal(report.product.action, 'reuse');
  assert.equal(report.price.action, 'reuse');
});

test('rejects live credentials before making any request', async () => {
  let calls = 0;
  await assert.rejects(setupPaddleSandbox({ apiKey: key.replace('sdbx', 'live'), fetcher: async () => { calls++; } }), /sandbox API key/);
  assert.equal(calls, 0);
});

test('never follows a pagination URL that would expose the API key elsewhere', async () => {
  let calls = 0;
  await assert.rejects(setupPaddleSandbox({ apiKey: key, fetcher: async () => {
    calls++; return page([], 'https://attacker.example/products');
  } }), /pagination/);
  assert.equal(calls, 1);
});

test('fails closed on malformed pagination instead of creating a duplicate product', async () => {
  await assert.rejects(setupPaddleSandbox({ apiKey: key, apply: true, fetcher: async (_url, init) => {
    assert.equal(init.method, 'GET'); return Response.json({ data: [] });
  } }), /catalog response/);
});

test('does not silently replace an existing Foundkeep price with different billing terms', async () => {
  for (const changed of [
    { unit_price: { amount: '5000', currency_code: 'USD' } },
    { billing_cycle: { interval: 'year', frequency: 1 } },
    { trial_period: { interval: 'day', frequency: 14 } },
    { quantity: { minimum: 1, maximum: 100 } },
    { unit_price_overrides: [{ country_codes: ['US'], unit_price: { amount: '900', currency_code: 'USD' } }] },
  ]) {
    await assert.rejects(setupPaddleSandbox({ apiKey: key, apply: true, fetcher: async (url, init) => {
      assert.equal(init.method, 'GET');
      return page(new URL(url).pathname === '/products' ? [product] : [{ ...price, ...changed }]);
    } }), /existing price/);
  }
});

test('provider error bodies and network errors never leak credential values', async () => {
  for (const fetcher of [async () => new Response(key, { status: 403 }), async () => { throw new Error(key); }]) {
    await assert.rejects(setupPaddleSandbox({ apiKey: key, fetcher }), error => !String(error).includes(key));
  }
});

test('ambiguous product names stop setup without changing either product', async () => {
  await assert.rejects(setupPaddleSandbox({ apiKey: key, apply: true, fetcher: async (_url, init) => {
    assert.equal(init.method, 'GET'); return page([product, { ...product, id: 'pro_' + 'c'.repeat(26) }]);
  } }), /multiple Foundkeep products/);
});

test('an ambiguous create result stops before trying to create a price', async () => {
  let writes = 0;
  await assert.rejects(setupPaddleSandbox({ apiKey: key, apply: true, fetcher: async (_url, init) => {
    if (init.method === 'GET') return page([]);
    writes++; return Response.json({ data: null }, { status: 201 });
  } }), /unexpected product/);
  assert.equal(writes, 1);
});
