import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const base = process.env.BASE_URL || 'http://127.0.0.1:18791';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Use a disposable local backend.');

test('agent page exposes setup, preserves scoped connections, and supports the full lifecycle', async t => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const password = 'Agents-page-disposable-834126';
  let account;
  t.after(async () => {
    try { if (account) assert.equal((await context.request.delete(base + '/api/account', { headers: { Origin: base, 'X-Atlas-Account': account.id }, data: { password } })).status(), 200); }
    finally { await browser.close(); }
  });
  const guard = await context.request.get(base + '/dashboard/agents', { maxRedirects: 0 });
  assert.equal(guard.status(), 307);
  assert.equal(guard.headers().location, '/login');
  const registration = await context.request.post(base + '/api/auth/register', { headers: { Origin: base }, data: { email: `agents-page-${crypto.randomUUID()}@example.test`, name: 'Agent collector', password } });
  assert.equal(registration.status(), 201);
  account = (await registration.json()).account;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/dashboard/apps');
  await page.getByRole('heading', { name: 'Apps & devices', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Create connection', exact: true }).count(), 0);
  let failList = true, failCreate = true;
  const writes = [];
  await page.route('**/api/agents', async route => {
    const request = route.request();
    assert.equal((await request.allHeaders())['x-atlas-account'], account.id);
    if (request.method() === 'GET' && failList) return route.fulfill({ status: 503, json: { message: 'Connections are temporarily unavailable.' } });
    if (request.method() === 'POST') {
      writes.push(request.postDataJSON());
      if (failCreate) { failCreate = false; return route.fulfill({ status: 503, json: { message: 'Connection could not be created. Please retry.' } }); }
    }
    await route.continue();
  });
  await page.getByRole('link', { name: 'Open Agent connections', exact: false }).click();
  await page.waitForURL(base + '/dashboard/agents');
  await page.getByRole('heading', { name: 'Agent connections', exact: true }).waitFor();
  assert.equal(await page.locator('#open-agents').getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('#workspace-navigation > #open-agents').count(), 1, 'Agents remains a direct workspace destination alongside Collections');
  assert.equal(await page.locator('#agent-connection-form').isVisible(), true, 'Setup is immediately available, outside a disclosure');
  assert.equal(await page.locator('#onboarding, #device-list, #capture-grid').count(), 0);
  await page.getByRole('alert').filter({ hasText: 'Connections are temporarily unavailable.' }).waitFor();
  failList = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.getByRole('heading', { name: 'No agents connected yet.' }).waitFor();
  await mkdir('.impeccable/review/agents', { recursive: true });
  for (const width of [1440, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Agent setup fits ${width}px`);
    assert.equal(await page.locator('#agent-connection-form').isVisible(), true);
    if (width === 1440 || width === 390) await page.screenshot({ path: `.impeccable/review/agents/setup-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#agent-name').fill('Research agent');
  await page.locator('#agent-files').check();
  await page.locator('#create-agent-connection').click();
  await page.getByRole('alert').filter({ hasText: 'Connection could not be created.' }).waitFor();
  assert.equal(await page.locator('#agent-name').inputValue(), 'Research agent');
  assert.equal(await page.locator('#agent-files').isChecked(), true);
  assert.equal(await page.locator('#agent-write').isChecked(), false);
  await page.locator('#create-agent-connection').click();
  const configuration = page.getByLabel('Private MCP configuration', { exact: true });
  await configuration.waitFor();
  const config = JSON.parse(await configuration.inputValue());
  assert.equal(config.mcpServers.foundkeep.url, base + '/api/mcp', 'Configuration uses the current environment');
  assert.ok(config.mcpServers.foundkeep.headers.Authorization.startsWith('Bearer fk_mcp_'));
  assert.deepEqual(writes, Array(2).fill({ name: 'Research agent', days: 90, scopes: ['library:read', 'files:read'] }));
  assert.equal(await page.locator('#create-agent-connection').isDisabled(), true, 'A visible one-time credential cannot be overwritten by another create');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copiedConfiguration = value; } } }));
  await page.getByRole('button', { name: 'Copy configuration', exact: true }).click();
  assert.ok(await page.evaluate(() => window.copiedConfiguration === document.querySelector('textarea[aria-label="Private MCP configuration"]').value));
  assert.ok(await page.evaluate(() => !Object.values(localStorage).some(value => value.includes('fk_mcp_'))));
  await page.getByRole('button', { name: 'I saved it', exact: true }).click();
  assert.equal(await configuration.count(), 0);
  await page.reload();
  await page.getByRole('heading', { name: 'Research agent', exact: true }).waitFor();
  assert.equal(await configuration.count(), 0, 'A reload never reveals an old credential');
  await page.locator('#agent-instruction').fill('Find the references I saved this week.');
  await page.getByRole('button', { name: 'Save instruction', exact: true }).click();
  await page.getByRole('list', { name: 'Pending instructions' }).getByText('Find the references I saved this week.', { exact: true }).waitFor();
  assert.equal(await page.locator('#agent-instruction').inputValue(), '');
  await page.screenshot({ path: '.impeccable/review/agents/connected-desktop.png', fullPage: true });
  const mcp = () => context.request.post(base + '/api/mcp', { headers: { Origin: base, Authorization: config.mcpServers.foundkeep.headers.Authorization, Accept: 'application/json, text/event-stream' }, data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} } });
  assert.equal((await mcp()).status(), 200, 'The generated connection works');
  await page.getByRole('button', { name: 'Revoke Research agent', exact: true }).click();
  await page.locator('#confirm-cancel').click();
  assert.equal(await page.getByRole('heading', { name: 'Research agent', exact: true }).isVisible(), true);
  await page.getByRole('button', { name: 'Revoke Research agent', exact: true }).click();
  await page.locator('#confirm-accept').click();
  await page.getByRole('heading', { name: 'No agents connected yet.' }).waitFor();
  assert.equal((await mcp()).status(), 401, 'Revocation removes access immediately');
  await page.unroute('**/api/agents');
  await page.locator('#toggle-sidebar').click();
  await page.locator('#open-setup').click();
  await page.waitForURL(base + '/dashboard/apps');
  await page.locator('#open-agents').click();
  await page.waitForURL(base + '/dashboard/agents');
  assert.equal(await page.locator('.library-sidebar').getAttribute('data-collapsed'), 'true');
  await page.goBack();
  await page.waitForURL(base + '/dashboard/apps');
  await page.locator('#open-agents').click();
  await page.waitForURL(base + '/dashboard/agents');
  await page.locator('#create-agent-connection:enabled').waitFor();
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  await page.route('**/api/agents', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    await delayed;
    await route.fulfill({ status: 201, json: { token: 'fk_mcp_' + 'a'.repeat(43) } }).catch(() => {});
  });
  try {
    await page.locator('#create-agent-connection').click();
    await page.locator('#create-agent-connection .work-spinner').waitFor();
    await page.locator('#open-setup').click();
    await page.waitForURL(base + '/dashboard/apps');
    release();
    await page.locator('#open-agents').click();
    await page.waitForURL(base + '/dashboard/agents');
    await page.locator('#create-agent-connection:enabled').waitFor();
    assert.equal(await configuration.count(), 0, 'A delayed credential cannot reappear after leaving its page');
  } finally { release(); }
  assert.deepEqual(errors, []);
});
