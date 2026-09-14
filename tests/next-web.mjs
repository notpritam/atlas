import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium, request as playwrightRequest} from 'playwright-core';

// A production Next build backed by a disposable local database. Never run these
// account mutations against a customer deployment.
const base = process.env.FOUNDKEEP_WEB_TEST_URL || 'http://127.0.0.1:18791';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Use an isolated local test server.');
const password = 'Only-for-disposable-integration-928461';
let browser;
before(async () => { browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox']}); });
after(async () => { await browser?.close(); });
async function account(t) {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  const email = `next-web-${crypto.randomUUID()}@example.test`;
  const response = await context.request.post(base + '/api/auth/register', {headers: {Origin: base}, data: {email, name: 'Integration collector', password}});
  assert.equal(response.status(), 201, await response.text());
  const result = await response.json();
  t.after(async () => {
    await context.request.post(base + '/api/auth/login', {headers: {Origin: base}, data: {email, password}});
    const cleanup = await context.request.delete(base + '/api/account', {headers: {Origin: base}, data: {password}});
    assert.equal(cleanup.status(), 200, 'Disposable account deleted');
    await context.close();
  });
  return {context, email, result};
}

test('public pages contain real pre-rendered content, clean redirects and safe app handoffs', async () => {
  for (const [path, title] of [['/', 'Found it? Keep it.'], ['/support', 'Help, from save to sync.'], ['/privacy', 'Privacy'], ['/terms', 'Terms of use.']]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes(title), `${path} includes content before JavaScript`);
    assert.doesNotMatch(html, /SUPABASE_(?:ANON|SERVICE_ROLE)_KEY|sb_secret_|service_role/);
    assert.match(response.headers.get('cache-control'), path === '/' ? /private, no-store/ : /s-maxage/);
  }
  for (const name of ['auth', 'dashboard', 'support', 'privacy', 'terms', 'open']) {
    const response = await fetch(`${base}/${name}.html?q=kept&flow=callback`, {redirect: 'manual'});
    assert.equal(response.status, 308);
    const target = new URL(response.headers.get('location'), base);
    assert.equal(target.pathname, '/' + name);
    assert.equal(target.searchParams.get('flow'), 'callback');
    assert.equal(target.searchParams.get('q'), 'kept');
  }
  assert.equal((await fetch(base + '/not-a-foundkeep-page')).status, 404);
  const context = await browser.newContext({javaScriptEnabled: false});
  try {
    const page = await context.newPage();
    await page.goto(base + '/');
    assert.match(await page.locator('h1').textContent(), /Found it/);
    await page.goto(base + '/open?path=https://evil.example/path');
    const destinations = await page.locator('a[href^="foundkeep:"]').evaluateAll(links => links.map(link => link.href));
    assert.ok(destinations.length);
    assert.ok(destinations.every(link => !link.includes('evil.example')));
  } finally { await context.close(); }
});

test('server guards redirect before JavaScript and never cache private account HTML', async t => {
  const {context, email} = await account(t);
  for (const path of ['/login', '/signup', '/recover', '/auth', '/auth?mode=login']) {
    const response = await context.request.get(base + path, {maxRedirects: 0});
    assert.equal(response.status(), 307, path);
    assert.equal(response.headers().location, '/dashboard');
    assert.match(response.headers()['cache-control'], /no-store/);
  }
  const callback = await context.request.get(base + '/auth?flow=return&code=proof', {maxRedirects: 0});
  assert.equal(callback.status(), 200, 'Authenticated OAuth callbacks remain completable');
  const first = await context.request.get(base + '/dashboard');
  const second = await context.request.get(base + '/dashboard');
  assert.ok((await first.text()).includes(email));
  assert.match(first.headers()['cache-control'], /private.*no-store/);
  const policy = first.headers()['content-security-policy'];
  assert.match(policy, /nonce-/);
  assert.doesNotMatch(policy, /unsafe-eval/);
  assert.notEqual(policy, second.headers()['content-security-policy'], 'Fresh nonce per private request');
  const anonymous = await playwrightRequest.newContext();
  try {
    const response = await anonymous.get(base + '/dashboard', {maxRedirects: 0});
    assert.equal(response.status(), 307);
    assert.equal(response.headers().location, '/login');
    assert.ok(!(await response.text()).includes(email));
  } finally { await anonymous.dispose(); }
  const noJs = await browser.newContext({javaScriptEnabled: false, storageState: await context.storageState()});
  try {
    const page = await noJs.newPage(); await page.goto(base + '/login');
    assert.equal(new URL(page.url()).pathname, '/dashboard');
    assert.equal(await page.locator('#account-name').textContent(), 'Integration collector');
  } finally { await noJs.close(); }
});

test('switching the account cookie clears an open library and rejects stale mutations', async t => {
  const first = await account(t);
  const second = await account(t);
  const title = 'Private first-account capture ' + crypto.randomUUID();
  const saved = await first.context.request.post(base + '/api/captures', {headers: {Origin: base}, data: {clientId: crypto.randomUUID(), type: 'note', noteText: title}});
  assert.equal(saved.status(), 201);
  const id = (await saved.json()).capture.id;
  const page = await first.context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/dashboard');
  await page.locator('.capture-open').filter({hasText: title}).waitFor();
  await page.locator('#new-note:not([disabled])').waitFor();
  await page.locator('#refresh-library:not([disabled])').waitFor();
  await first.context.addCookies(await second.context.cookies());
  if (!(await page.locator('#session-dialog').isVisible())) await page.locator('#refresh-library').click();
  await page.locator('#session-dialog').waitFor({state: 'visible'});
  assert.equal(await page.locator('.capture-card').count(), 0);
  assert.ok(!(await page.locator('body').innerText()).includes(title));
  const guarded = await first.context.request.post(base + '/api/captures', {headers: {Origin: base, 'X-Atlas-Account': first.result.account.id}, data: {clientId: crypto.randomUUID(), type: 'note', noteText: 'Must never save to the wrong account'}});
  assert.equal(guarded.status(), 409);
  assert.equal((await first.context.request.get(base + '/api/captures/' + id)).status(), 404);
  assert.deepEqual(errors, []);
});

test('expired sessions remove visible private content and return to login on reload', async t => {
  const {context} = await account(t);
  const page = await context.newPage();
  await page.goto(base + '/dashboard');
  await page.locator('#new-note:not([disabled])').waitFor();
  await context.request.post(base + '/api/auth/logout', {headers: {Origin: base}, data: {}});
  await page.locator('#refresh-library:not([disabled])').click();
  await page.locator('#session-dialog').waitFor({state: 'visible'});
  assert.equal(await page.locator('.capture-card').count(), 0);
  await page.reload();
  assert.equal(new URL(page.url()).pathname, '/login');
});
