import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const base = process.env.BASE_URL || 'http://127.0.0.1:18791';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Use a disposable local test server.');
const routes = ['/dashboard/agents', '/dashboard/apps', '/dashboard/settings', '/dashboard/settings/capture', '/dashboard/settings/processing', '/dashboard/plans'];

test('account pages guard direct requests before rendering', async () => {
  for (const route of routes) {
    const response = await fetch(base + route, { redirect: 'manual' });
    assert.equal(response.status, 307, route);
    assert.equal(response.headers.get('location'), '/login', route);
  }
});

test('account navigation opens real pages, supports history, and keeps billing separate', async t => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const password = 'Account-pages-disposable-938251';
  const registered = await context.request.post(base + '/api/auth/register', { headers: { Origin: base }, data: { email: `pages-${crypto.randomUUID()}@example.test`, name: 'Page collector', password } });
  assert.equal(registered.status(), 201, await registered.text());
  t.after(async () => {
    const response = await context.request.delete(base + '/api/account', { headers: { Origin: base }, data: { password } });
    assert.equal(response.status(), 200);
    await browser.close();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/dashboard');
  assert.equal(await page.locator('#onboarding').count(), 0, 'Library does not mount device setup');
  await page.locator('[data-type="note"]').click();
  await page.waitForURL('**/dashboard?type=note');
  await page.locator('#all-captures').click();
  await page.waitForURL(base + '/dashboard');
  assert.equal(await page.locator('[data-type=""]').getAttribute('aria-pressed'), 'true', 'My library clears filters as well as its URL');
  await page.locator('#open-setup').click();
  await page.waitForURL(base + '/dashboard/apps');
  await page.getByRole('heading', { name: 'Apps & devices', exact: true }).waitFor();
  assert.equal(await page.locator('#capture-grid').count(), 0);
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(await page.locator('#open-setup').getAttribute('aria-current'), 'page');
  await page.locator('#open-account').click(); await page.locator('#sidebar-account-settings').click();
  await page.waitForURL(base + '/dashboard/settings');
  assert.equal(await page.locator('#account-dialog').count(), 0);
  await page.getByRole('link', { name: 'Browser capture', exact: true }).click();
  await page.waitForURL(base + '/dashboard/settings/capture');
  await page.locator('#preference-form[data-ready="true"]').waitFor();
  await page.reload();
  await page.locator('#preference-form[data-ready="true"]').waitFor();
  await page.goBack();
  await page.waitForURL(base + '/dashboard/settings');
  await page.getByRole('link', { name: 'Plans & usage', exact: true }).click();
  await page.waitForURL(base + '/dashboard/plans');
  await page.locator('[data-plan="free"] .current-plan-label').waitFor();
  assert.equal(await page.locator('[data-plan]').count(), 2);
  assert.equal(await page.locator('#capture-grid, #preference-form, #device-list').count(), 0);
  assert.equal(await page.getByRole('progressbar', { name: 'Cloud storage' }).getAttribute('aria-valuenow'), '0');
  for (const [old, destination] of [['?panel=devices', '/dashboard/apps'], ['?panel=settings', '/dashboard/settings'], ['?billing=success', '/dashboard/plans?billing=success'], ['#devices', '/dashboard/apps'], ['#extension-settings', '/dashboard/settings/capture']]) {
    await page.goto(base + '/dashboard' + old);
    await page.waitForURL(base + destination);
  }
  await mkdir('.impeccable/review/account-pages', { recursive: true });
  for (const route of routes) {
    await page.goto(base + route);
    await page.locator('.account-page').waitFor();
    await page.evaluate(() => document.fonts.ready);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${route} overflows at ${width}`);
      if (width !== 320) await page.screenshot({ path: `.impeccable/review/account-pages/${route.replaceAll('/', '-')}-${width}.png`, fullPage: true });
    }
    assert.equal(await page.locator('dialog[open]').count(), 0);
  }
  assert.deepEqual(errors, []);
});

test('plans handle verified Pro, billing failures, expiry, and queued usage without a real purchase', async t => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const password = 'Billing-pages-disposable-719326';
  const registered = await context.request.post(base + '/api/auth/register', { headers: { Origin: base }, data: { email: `billing-pages-${crypto.randomUUID()}@example.test`, name: 'Billing page test', password } });
  assert.equal(registered.status(), 201, await registered.text());
  const account = (await registered.json()).account;
  t.after(async () => {
    try { assert.equal((await context.request.delete(base + '/api/account', { headers: { Origin: base }, data: { password } })).status(), 200); }
    finally { await browser.close(); }
  });
  const page = await context.newPage();
  let planError = true, checkoutError = false;
  let checkoutDestination = 'https://untrusted.example/checkout';
  let snapshot = { pro: false, subscriptions: [], limits: { maxBytes: 200 * 1024 ** 2, maxCaptures: 10000, monthlyProcessing: 0 }, price: { currency: 'USD', monthly: 5 }, billing: { paddle: { available: true, canManage: false }, stripe: { available: false, canManage: false } } };
  const free = structuredClone(snapshot);
  let processing = { available: true, enabled: false, fetchLinks: false, images: false, consentVersion: '2026-09-12', activity: [], usage: { used: 0, reserved: 0, limit: 0, cycle: '2026-09' } };
  const mutations = [];
  await page.route('**/api/plan', route => route.fulfill({ status: planError ? 503 : 200, contentType: 'application/json', body: JSON.stringify(planError ? { message: 'Plan service unavailable.' } : snapshot) }));
  await page.route('**/api/automation', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(processing) }));
  await page.route('**/api/billing/**', async route => {
    const request = route.request();
    mutations.push(new URL(request.url()).pathname);
    assert.equal((await request.allHeaders())['x-atlas-account'], account.id);
    assert.deepEqual(request.postDataJSON(), {});
    if (request.url().endsWith('/checkout')) return route.fulfill({ status: checkoutError ? 503 : 200, contentType: 'application/json', body: JSON.stringify(checkoutError ? { message: 'Checkout is temporarily unavailable. Please retry.' } : { url: checkoutDestination }) });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(snapshot) });
  });
  await page.goto(base + '/dashboard/plans');
  await page.getByRole('heading', { name: 'Your plan couldn’t load.' }).waitFor();
  assert.equal(await page.locator('[data-plan]').count(), 0, 'Failed plan request never labels the account Free');
  planError = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByRole('button', { name: 'Get Pro · $5/month', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'payment destination is unavailable' }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/dashboard/plans', 'Untrusted checkout destination rejected');
  checkoutError = true;
  await page.getByRole('button', { name: 'Get Pro · $5/month', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Checkout is temporarily unavailable' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Get Pro · $5/month', exact: true }).isEnabled(), true);
  await page.goto(base + '/dashboard/plans?billing=success');
  await page.getByRole('status').filter({ hasText: 'waiting for your subscription to be verified' }).waitFor();
  await page.locator('[data-plan="free"] .current-plan-label').waitFor();
  snapshot = { ...free, pro: true, limits: { ...free.limits, maxBytes: 2 * 1024 ** 3, monthlyProcessing: 500 }, subscriptions: [{ provider: 'paddle', active: true, status: 'active', renews: false, expiresAt: Date.now() + 86400000 }], billing: { ...free.billing, paddle: { available: true, canManage: true } } };
  processing = { ...processing, usage: { ...processing.usage, used: 200, reserved: 50, limit: 500 } };
  await page.getByRole('button', { name: 'Refresh plan', exact: true }).click();
  await page.locator('[data-plan="pro"] .current-plan-label').waitFor();
  await page.getByRole('status').filter({ hasText: 'Your Pro plan is ready' }).waitFor();
  await page.getByRole('button', { name: 'Manage subscription', exact: true }).waitFor();
  assert.equal(await page.getByRole('progressbar', { name: 'Processing credits' }).getAttribute('aria-valuenow'), '250');
  assert.match(await page.locator('.plan-overview-heading').innerText(), /Access until/);
  assert.equal(await page.getByRole('button', { name: /Get Pro/ }).count(), 0);
  assert.ok(mutations.includes('/api/billing/paddle/sync'));
  snapshot = { ...snapshot, subscriptions: [{ ...snapshot.subscriptions[0], provider: 'revenuecat', renews: true }], billing: free.billing };
  await page.reload();
  await page.getByRole('link', { name: /Manage in your Apple Account/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Manage subscription', exact: true }).count(), 0);
  planError = true;
  await page.goto(base + '/dashboard/settings/processing');
  await page.getByRole('alert').filter({ hasText: 'Plan service unavailable.' }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Explore plans', exact: true }).count(), 0, 'A plan failure must not imply Free');
  planError = false;
  await page.getByRole('button', { name: 'Retry plan', exact: true }).click();
  await page.locator('.preference-toggle input:not([disabled])').first().waitFor();
  snapshot = { ...free, subscriptions: [{ provider: 'paddle', active: false, status: 'past_due', renews: false, expiresAt: Date.now() - 1000 }], billing: { ...free.billing, paddle: { available: true, canManage: true } } };
  await page.goto(base + '/dashboard/plans');
  await page.getByRole('button', { name: 'Manage your existing subscription', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Manage your existing subscription', exact: true }).isDisabled(), true);
  snapshot = free;
  checkoutError = false;
  checkoutDestination = '/checkout?_ptxn=txn_disposable_navigation_test';
  await page.goto(base + '/dashboard/plans');
  await page.getByRole('button', { name: 'Get Pro · $5/month', exact: true }).click();
  await page.waitForURL(base + checkoutDestination);
});
