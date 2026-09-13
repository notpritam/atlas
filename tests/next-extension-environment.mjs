import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const base = process.env.BASE_URL || 'http://127.0.0.1:18791';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Use a disposable test database.');

test('dev Apps & devices offers its own download and detects only the dev extension', async t => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const password = 'Dev-extension-page-923810';
  const signup = await context.request.post(base + '/api/auth/register', { headers: { Origin: base }, data: { name: 'Extension tester', email: `extension-${crypto.randomUUID()}@example.test`, password } });
  assert.equal(signup.status(), 201, await signup.text());
  t.after(async () => {
    await context.request.delete(base + '/api/account', { headers: { Origin: base }, data: { password } });
    await browser.close();
  });
  await context.addInitScript(() => {
    window.detectedExtensionIds = [];
    window.chrome = { runtime: { sendMessage(id, message, callback) {
      window.detectedExtensionIds.push(id);
      callback({ ok: true, version: '1.7.0', account: null });
    } } };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/dashboard/apps');
  await page.getByRole('heading', { name: 'Install Foundkeep Dev', exact: true }).waitFor();
  const download = page.locator('#install-extension');
  assert.equal(await download.getAttribute('href'), '/ext/foundkeep-extension-dev.zip');
  assert.equal(await download.getAttribute('download'), 'foundkeep-extension-dev.zip');
  assert.equal(await page.locator('#manual-install').getAttribute('open'), '');
  assert.equal(await page.locator('a[href*="chromewebstore.google.com"]').count(), 0);
  const detected = await page.evaluate(() => window.detectedExtensionIds);
  assert.ok(detected.length > 0);
  assert.deepEqual([...new Set(detected)], ['fngoidplpdpoamenhgpabbheghpkdkcb']);
  const zip = await context.request.get(base + '/ext/foundkeep-extension-dev.zip');
  assert.equal(zip.status(), 200);
  assert.equal(zip.headers()['cache-control'], 'no-store');
  assert.equal((await zip.body()).subarray(0, 2).toString(), 'PK');
  const policy = await context.request.get(base + '/extension-policy.json');
  assert.equal(policy.status(), 200);
  assert.equal((await policy.json()).schemaVersion, 1);
  assert.deepEqual(errors, []);
});
