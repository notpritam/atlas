import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright-core';

// Run against a Next development or production server with an anonymous /api/me.
// Browser fixtures intercept API requests. The optional lifecycle test requires
// an explicitly disposable local backend and cleans up the accounts it creates.
const base = process.env.FOUNDKEEP_WEB_TEST_URL || 'http://127.0.0.1:18792';
const account = {id: 'test-account', email: 'collector@example.test', name: 'Collector', createdAt: 1};
const browserErrors = [];
let browser;
before(async () => {
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox']});
});
after(async () => {
  await browser?.close();
  assert.deepEqual(browserErrors, [], 'No browser runtime errors');
});

async function fixture(t, handler = () => undefined) {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  page.on('pageerror', error => browserErrors.push(error.message));
  const requests = [];
  await context.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.postData() ? JSON.parse(request.postData()) : null;
    requests.push({path, body, headers: request.headers()});
    const response = await handler({path, body, request});
    await route.fulfill(response || {json: {providers: []}});
  });
  await context.route('**/dashboard', route => route.fulfill({contentType: 'text/html', body: '<h1>Dashboard fixture</h1>'}));
  return {context, page, requests};
}

async function pending(context, flow, intent = 'sign-in', accountId) {
  await context.addInitScript(({flow, intent, accountId}) => {
    if (!sessionStorage.getItem('foundkeep-fixture-initialized')) {
      sessionStorage.setItem('foundkeep-oauth-' + flow, JSON.stringify({verifier: 'v'.repeat(43), intent, accountId, expires: Date.now() + 600000}));
      sessionStorage.setItem('foundkeep-fixture-initialized', '1');
    }
  }, {flow, intent, accountId});
}

test('signup requires recovery acknowledgement and downloads the actual code', async t => {
  const {page, requests} = await fixture(t, ({path}) => path === '/api/auth/register' ? {json: {account, recoveryCode: 'save-this-recovery-code'}} : undefined);
  await page.goto(base + '/signup');
  await page.locator('#email').waitFor({state: 'visible'});
  await page.locator('#name').fill('  Collector  ');
  await page.locator('#email').fill(account.email);
  await page.locator('#password').fill('A-long-test-password-2096');
  await page.locator('#show-password').click();
  assert.equal(await page.locator('#password').getAttribute('type'), 'text');
  await page.locator('#auth-submit').click();
  await page.locator('#recovery-save').waitFor();
  assert.equal(await page.locator('#continue-dashboard').isEnabled(), false);
  assert.equal(requests.find(request => request.path === '/api/auth/register').body.name, 'Collector');
  const download = page.waitForEvent('download');
  await page.locator('#download-recovery').click();
  const file = await download;
  assert.equal(file.suggestedFilename(), 'foundkeep-recovery-code.txt');
  let text = '';
  for await (const chunk of await file.createReadStream()) text += chunk;
  assert.match(text, /collector@example.test/);
  assert.match(text, /save-this-recovery-code/);
  await page.locator('#recovery-saved').check();
  await page.locator('#continue-dashboard').click();
  await page.waitForURL('**/dashboard');
});

test('recovery errors retain input for a corrected submission', async t => {
  let tries = 0;
  const {page} = await fixture(t, ({path}) => path === '/api/auth/recover'
    ? ++tries === 1 ? {status: 401, json: {error: 'invalid_credentials', message: 'Email or recovery code is incorrect.'}} : {json: {account, recoveryCode: 'replacement-code'}}
    : undefined);
  await page.goto(base + '/recover');
  await page.locator('#email').fill(account.email);
  await page.locator('#password').fill('A-new-password-2096');
  await page.locator('#recovery-code').fill('wrong-code');
  await page.locator('#auth-submit').click();
  await page.locator('#auth-error').waitFor({state: 'visible'});
  assert.equal(await page.locator('#recovery-code').inputValue(), 'wrong-code');
  await page.locator('#recovery-code').fill('correct-code');
  await page.locator('#auth-submit').click();
  await page.locator('#new-recovery-code').waitFor();
  assert.equal(await page.locator('#new-recovery-code').textContent(), 'replacement-code');
});

test('provider start preserves the verifier challenge and same-origin protocol', async t => {
  const flow = 'a'.repeat(32);
  const {page, requests} = await fixture(t, ({path}) => path === '/api/auth/providers' ? {json: {providers: ['google']}}
    : path === '/api/auth/oauth/start' ? {json: {flow, authorizeUrl: base + '/api/auth/oauth/authorize/' + flow}}
    : {contentType: 'text/html', body: 'Provider fixture'});
  await page.goto(base + '/login');
  await page.getByRole('button', {name: 'Continue with Google'}).click();
  await page.waitForURL('**/api/auth/oauth/authorize/' + flow);
  const proof = await page.evaluate(flow => JSON.parse(sessionStorage.getItem('foundkeep-oauth-' + flow)), flow);
  assert.match(proof.verifier, /^[A-Za-z0-9_-]{43}$/);
  const start = requests.find(request => request.path === '/api/auth/oauth/start').body;
  assert.equal(start.codeChallenge, createHash('sha256').update(proof.verifier).digest('base64url'));
  assert.equal(start.client, 'web');
  assert.equal(proof.intent, 'sign-in');
});

test('account linking exchanges once initially, retries a wrong password and cleans up', async t => {
  let count = 0;
  const flow = 'c'.repeat(32);
  const {context, page, requests} = await fixture(t, ({path}) => path === '/api/auth/oauth/exchange'
    ? ++count === 1 ? {status: 409, json: {error: 'account_link_required', message: 'Enter your current password.'}}
      : count === 2 ? {status: 401, json: {error: 'invalid_credentials', message: 'The existing password is incorrect.'}} : {json: {account}}
    : undefined);
  await pending(context, flow);
  await page.goto(base + '/auth?flow=' + flow + '&code=' + 'b'.repeat(43));
  await page.locator('#oauth-password').waitFor({state: 'visible'});
  assert.equal(count, 1);
  assert.equal(page.url(), base + '/auth');
  await page.locator('#oauth-password').fill('wrong');
  await page.locator('#oauth-connect').click();
  await page.getByText('The existing password is incorrect.').waitFor();
  await page.locator('#oauth-password').fill('correct');
  await page.locator('#oauth-password').press('Enter');
  await page.waitForURL('**/dashboard');
  assert.equal(count, 3);
  assert.equal(requests.filter(request => request.path === '/api/auth/oauth/exchange')[2].body.password, 'correct');
  assert.equal(await page.evaluate(flow => sessionStorage.getItem('foundkeep-oauth-' + flow), flow), null);
});

test('missing browser proof prevents an exchange and removes handoff parameters', async t => {
  const {page, requests} = await fixture(t);
  await page.goto(base + '/auth?flow=' + 'a'.repeat(32) + '&code=' + 'b'.repeat(43));
  await page.getByText('Sign-in was canceled or expired. Please start again.').waitFor();
  assert.equal(requests.some(request => request.path === '/api/auth/oauth/exchange'), false);
  assert.equal(page.url(), base + '/auth');
});

test('transient exchange failures can retry with the retained proof', async t => {
  let count = 0;
  const flow = 'd'.repeat(32);
  const {context, page} = await fixture(t, ({path}) => path === '/api/auth/oauth/exchange'
    ? ++count === 1 ? {status: 503, json: {message: 'Please retry.'}} : {json: {account}} : undefined);
  await pending(context, flow);
  await page.goto(base + '/auth?flow=' + flow + '&code=' + 'b'.repeat(43));
  await page.locator('#oauth-retry').waitFor();
  assert.equal(await page.evaluate(flow => sessionStorage.getItem('foundkeep-oauth-' + flow) !== null, flow), true);
  await page.locator('#oauth-retry').click();
  await page.waitForURL('**/dashboard');
  assert.equal(count, 2);
});

test('provider deletion requires a click and preserves account-bound proof', async t => {
  const flow = 'e'.repeat(32);
  const proof = 'p'.repeat(43);
  const {context, page, requests} = await fixture(t, ({path}) => path === '/api/auth/oauth/exchange' ? {json: {reauthToken: proof}}
    : path === '/api/account' ? {json: {ok: true}} : undefined);
  await pending(context, flow, 'delete', account.id);
  await page.goto(base + '/auth?flow=' + flow + '&code=' + 'b'.repeat(43));
  await page.locator('#oauth-delete').waitFor({state: 'visible'});
  assert.equal(requests.some(request => request.path === '/api/account'), false);
  await page.locator('#oauth-delete').click();
  await page.waitForURL('**/signup?deleted=1');
  const deletion = requests.find(request => request.path === '/api/account');
  assert.equal(deletion.body.reauthToken, proof);
  assert.equal(deletion.headers['x-atlas-account'], account.id);
  assert.equal(requests.find(request => request.path === '/api/auth/oauth/exchange').headers['x-atlas-account'], account.id);
});

test('clean mode URLs keep email expanded, clear secrets and support back navigation', async t => {
  const {page} = await fixture(t, ({path}) => path === '/api/auth/providers' ? {json: {providers: ['google', 'apple']}} : undefined);
  await page.goto(base + '/signup');
  await page.getByRole('button', {name: 'Continue with Google'}).waitFor();
  assert.equal(await page.locator('#email').isVisible(), false);
  await page.locator('#email-signin summary').click();
  await page.locator('#email').fill(account.email);
  await page.locator('#password').fill('A-long-test-password');
  await page.locator('[data-mode="login"]').click();
  assert.equal(page.url(), base + '/login');
  assert.equal(await page.locator('#email').inputValue(), account.email);
  assert.equal(await page.locator('#email').isVisible(), true);
  assert.equal(await page.locator('#password').inputValue(), '');
  await page.locator('[data-mode="recover"]').click();
  assert.equal(page.url(), base + '/recover');
  assert.equal(await page.locator('#recovery-code').isVisible(), true);
  await page.goBack();
  assert.equal(page.url(), base + '/login');
  assert.equal(await page.locator('#auth-title').textContent(), 'Welcome back.');
});

test('viewport footer, narrow screen scrolling and reachable email form', async t => {
  const {page} = await fixture(t, ({path}) => path === '/api/auth/providers' ? {json: {providers: ['google', 'apple']}} : undefined);
  await mkdir('docs/design/next-web', {recursive: true});
  for (const [width, height] of [[1440, 1000], [1920, 1080], [390, 844], [320, 700]]) {
    await page.setViewportSize({width, height});
    await page.goto(base + '/signup');
    await page.getByRole('button', {name: 'Continue with Google'}).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const geometry = await page.evaluate(() => ({viewport: innerWidth, width: document.body.scrollWidth, height: document.body.scrollHeight, footerBottom: document.querySelector('.account-footer').getBoundingClientRect().bottom}));
    assert.equal(geometry.width, geometry.viewport);
    assert.ok(Math.abs(geometry.footerBottom - geometry.height) < 1);
    if (width > 320) assert.equal(geometry.footerBottom, height);
    if (width === 1440 || width === 390) await page.screenshot({path: `docs/design/next-web/auth-${width === 1440 ? 'desktop' : 'mobile'}.png`, fullPage: true});
    await page.locator('#email-signin summary').click();
    await page.locator('#auth-submit').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#auth-submit').isVisible(), true);
    assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false);
    if (width === 390) await page.screenshot({path: 'docs/design/next-web/auth-mobile-email.png', fullPage: true});
  }
});

test('entering auth from the public landing applies its document CSP', async t => {
  const {page} = await fixture(t, ({path}) => path === '/api/auth/providers' ? {json: {providers: ['google']}}
    : path === '/api/auth/session' ? {json: {account: null}} : undefined);
  const inlineHandlerProbe = async () => {
    await page.evaluate(() => {
      delete window.__foundkeepCspProbe;
      const button = document.createElement('button');
      button.id = 'auth-csp-test-probe';
      button.textContent = 'CSP test';
      button.setAttribute('onclick', 'window.__foundkeepCspProbe = "executed"');
      document.body.append(button);
    });
    await page.locator('#auth-csp-test-probe').click();
    return await page.evaluate(() => window.__foundkeepCspProbe || 'blocked');
  };
  const direct = await page.goto(base + '/login');
  await page.getByRole('button', {name: 'Continue with Google'}).waitFor();
  assert.match(direct.headers()['content-security-policy'], /script-src .*'nonce-[^']+'/);
  assert.equal(await inlineHandlerProbe(), 'blocked');
  await page.goto(base + '/');
  await page.locator('.header-actions .login-link').click();
  await page.getByRole('button', {name: 'Continue with Google'}).waitFor();
  assert.equal(page.url(), base + '/login');
  assert.equal(await inlineHandlerProbe(), 'blocked', 'The private auth document must enforce CSP after public navigation');
});

test('a deferred export cannot complete after leaving the dashboard and changing accounts', {skip: process.env.FOUNDKEEP_AUTH_SECURITY !== '1'}, async t => {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Security integration requires an isolated local backend');
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  const emails = [];
  const password = 'Disposable-auth-audit-password-2096';
  let release;
  const held = new Promise(resolve => { release = resolve; });
  t.after(async () => {
    release();
    try {
      for (const email of emails) {
        await context.request.post(base + '/api/auth/login', {headers: {Origin: base}, data: {email, password}});
        const removed = await context.request.delete(base + '/api/account', {headers: {Origin: base}, data: {password}});
        assert.equal(removed.status(), 200, 'Disposable audit account deleted');
      }
    } finally { await context.close(); }
  });
  async function register(name) {
    const email = `auth-audit-${crypto.randomUUID()}@example.test`;
    const result = await context.request.post(base + '/api/auth/register', {headers: {Origin: base}, data: {email, name, password}});
    assert.equal(result.status(), 201, await result.text());
    emails.push(email);
    return email;
  }
  await register('Audit account A');
  const page = await context.newPage();
  page.on('pageerror', error => browserErrors.push(error.message));
  let requested;
  const started = new Promise(resolve => { requested = resolve; });
  let downloaded = false;
  page.on('download', () => { downloaded = true; });
  await page.route('**/api/account/export', async route => {
    requested();
    await held;
    try { await route.fulfill({contentType: 'application/json', body: JSON.stringify({account: 'Old audit account A'})}); }
    catch { /* The dashboard aborts the request when its lifecycle ends. */ }
  });
  await page.goto(base + '/dashboard');
  await page.locator('#open-account').click();
  await page.locator('#export-account').click();
  await page.locator('#confirm-accept').click();
  await started;
  await page.locator('.sidebar-bottom a[href="/support"]').click();
  await page.waitForURL('**/support');
  const second = await register('Audit account B');
  const me = await (await context.request.get(base + '/api/me')).json();
  assert.equal(me.account.email, second);
  release();
  await page.waitForEvent('download', {timeout: 1000}).catch(() => null);
  assert.equal(downloaded, false, 'Account A export must not download after its dashboard has unmounted');
});
