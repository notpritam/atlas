import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
const base = process.env.FOUNDKEEP_WEB_TEST_URL || 'http://127.0.0.1:18791';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Only use an isolated test backend.');
const evidence = process.env.EVIDENCE_DIR || '/tmp/foundkeep-ui-evidence';
const launch = () => chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });

test('landing, auth, FAQ, public collection theme, and anonymous search', async t => {
  const browser = await launch(); t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await mkdir(evidence, { recursive: true });
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  assert.ok((await page.locator('.brand').first().textContent()).includes('FoundKeep'));
  assert.equal(await page.locator('.site-header').getByRole('link', { name: 'Log in', exact: true }).count(), 0);
  assert.equal(await page.locator('.site-header').getByRole('link', { name: 'Start collecting', exact: true }).getAttribute('href'), '/signup');
  assert.equal(await page.locator('#pricing .pricing-plan').count(), 2);
  assert.equal(await page.locator('.hero-platforms a').count(), 3);
  assert.equal(await page.locator('.hero-availability').count(), 0);
  assert.ok((await page.locator('.compact-footer').boundingBox()).height < 150);
  const faq = page.locator('.faq-list details').first();
  await faq.locator('summary').click();
  await page.waitForFunction(() => { const e = document.querySelector('.faq-list details'); return e.open && !e.getAnimations().length; });
  await faq.locator('summary').click();
  await page.waitForFunction(() => !document.querySelector('.faq-list details').open);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Landing overflow at ${width}`);
    if (width !== 320) await page.screenshot({ path: `${evidence}/landing-${width}.png`, fullPage: true });
  }
  await page.goto(base + '/signup');
  assert.equal(await page.locator('.account-header').count(), 0);
  assert.ok(await page.locator('.auth-story .brand').isVisible());
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${evidence}/signup-${width}.png`, fullPage: true });
  }
  await page.goto(base + '/collections');
  await page.evaluate(() => { localStorage.setItem('foundkeep.appearance', 'dark'); document.documentElement.dataset.theme = 'dark'; });
  assert.equal(await page.locator('.discovery-topics.segmented-control').count(), 1);
  const primary = await page.locator('.collection-search .primary').evaluate(e => ({ color: getComputedStyle(e).color, background: getComputedStyle(e).backgroundColor }));
  assert.notEqual(primary.color, primary.background);
  let documents = 0; page.on('request', r => { if (r.isNavigationRequest() && r.resourceType() === 'document') documents++; });
  await page.getByLabel('Search public collections', { exact: true }).fill('design');
  await page.locator('.collection-search button').click();
  await page.waitForURL('**/collections?q=design');
  assert.equal(documents, 0, 'Directory search uses client navigation');
  await page.keyboard.press('Control+k'); await page.locator('[cmdk-input]').waitFor();
  await page.locator('[cmdk-input]').fill('support');
  await page.locator('[cmdk-item]').filter({ hasText: 'Support' }).click();
  await page.waitForURL('**/support'); assert.equal(await page.locator('#global-search').count(), 0);
  await page.goto(base + '/collections');
  for (const width of [1440, 390]) { await page.setViewportSize({ width, height: 1000 }); await page.screenshot({ path: `${evidence}/collections-dark-${width}.png`, fullPage: true }); }
  assert.deepEqual(errors, []);
});

test('dashboard stays mounted, URL filters persist, modal expands, and global search finds private notes', async t => {
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const password = 'Interface-test-only-751982';
  const registered = await context.request.post(base + '/api/auth/register', { headers: { Origin: base }, data: { email: `interface-${crypto.randomUUID()}@example.test`, name: 'Interface test', password } });
  assert.equal(registered.status(), 201, await registered.text());
  const account = (await registered.json()).account;
  t.after(async () => { await context.request.delete(base + '/api/account', { headers: { Origin: base }, data: { password } }); await browser.close(); });
  const note = await context.request.post(base + '/api/captures', { headers: { Origin: base, 'X-Atlas-Account': account.id }, data: { clientId: crypto.randomUUID(), type: 'note', noteText: 'A quiet idea for tomorrow', capturedAt: Date.now(), processingOptions: { ocr: false, summaries: false, tags: false } } });
  assert.equal(note.status(), 201, await note.text());
  const collection = await context.request.post(base + '/api/collections', { headers: { Origin: base }, data: { title: 'Design field notes', slug: `design-${crypto.randomUUID().slice(0, 8)}`, kind: 'personal', visibility: 'public', description: 'Useful ideas to keep close.', submissionPolicy: 'owner', requireApproval: true, tags: ['design'], rules: '' } });
  assert.equal(collection.status(), 201, await collection.text());
  const root = await context.request.get(base + '/', { maxRedirects: 0 });
  assert.equal(root.status(), 307); assert.ok(root.headers().location.endsWith('/dashboard'));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/dashboard'); await page.locator('.capture-note').waitFor();
  await page.locator('#new-note:not([disabled])').waitFor();
  await page.evaluate(() => { window.__sidebar = document.querySelector('#library-sidebar'); window.__documentMarker = 'stable'; });
  let documents = 0; page.on('request', r => { if (r.isNavigationRequest() && r.resourceType() === 'document') documents++; });
  await page.locator('#open-account').click(); await page.waitForURL('**/dashboard/settings');
  assert.equal(await page.locator('#sidebar-account-menu').count(), 0);
  for (const label of ['Browser capture', 'Processing', 'Account']) {
    await page.getByRole('link', { name: label, exact: true }).click();
    await page.waitForURL(base + ({'Browser capture':'/dashboard/settings/capture','Processing':'/dashboard/settings/processing','Account':'/dashboard/settings'}[label]));
    await page.waitForFunction(() => window.__sidebar === document.querySelector('#library-sidebar'));
  }
  assert.equal(documents, 0, 'Settings navigation never loads a new document');
  assert.equal(await page.evaluate(() => window.__documentMarker), 'stable');
  assert.equal(await page.locator('#library-sidebar .navigation-pending').count(), 0);
  await page.keyboard.press('Control+k');
  await page.locator('[cmdk-input]').fill('quiet idea');
  await page.locator('[cmdk-item]').filter({ hasText: 'A quiet idea for tomorrow' }).waitFor();
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/dashboard\?item=/);
  await page.locator('#capture-dialog[open] #detail-title').filter({ hasText: 'A quiet idea' }).waitFor();
  assert.equal(await page.locator('#capture-dialog').evaluate(e => parseFloat(getComputedStyle(e).borderRadius) >= 20), true);
  await page.screenshot({ path: `${evidence}/capture-modal.png` });
  await page.locator('.expand-capture').click(); await page.waitForURL('**/dashboard/saved/**');
  await page.locator('#detail-title').filter({ hasText: 'A quiet idea' }).waitFor();
  await page.getByRole('button', { name: 'Back to library', exact: true }).click(); await page.waitForURL(base + '/dashboard');
  await page.locator('.capture-note .capture-open').click(); await page.locator('#capture-dialog[open]').waitFor();
  await page.keyboard.press('Escape'); await page.locator('#capture-dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.capture-note .capture-open').evaluate(e => e === document.activeElement), true, 'Focus returns to the opening card');
  await page.locator('[data-type=note]').click(); await page.waitForURL('**/dashboard?type=note');
  await page.locator('#open-collections').click(); await page.waitForURL('**/dashboard/collections');
  await page.getByRole('button', { name: 'Created by you', exact: true }).click(); await page.waitForURL('**/dashboard/collections?filter=owned');
  await page.getByRole('button', { name: 'Following', exact: true }).click(); await page.waitForURL('**/dashboard/collections?filter=following');
  await page.goBack(); await page.waitForURL('**/dashboard/collections?filter=owned');
  assert.equal(await page.getByRole('button', { name: 'Created by you', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(documents, 0);
  await page.locator('#all-captures').click(); await page.waitForURL(base + '/dashboard');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Dashboard ${theme} overflow at ${width}`);
      if (width !== 320) await page.screenshot({ path: `${evidence}/dashboard-${theme}-${width}.png` });
    }
  }
  await page.locator('.capture-note .capture-open').click(); await page.locator('#capture-dialog[open]').waitFor();
  const bounds = await page.locator('#capture-dialog').boundingBox(); assert.ok(bounds.x > 0 && bounds.width < 320);
  await page.screenshot({ path: `${evidence}/capture-mobile-dark.png` });
  // A restored page must conceal private native dialogs until the session is verified.
  await page.route('**/api/me', route => route.abort('internetdisconnected'));
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await page.locator('#verification-title').filter({ hasText: 'Reconnect' }).waitFor();
  assert.equal(await page.locator('#capture-dialog').evaluate(e => getComputedStyle(e).visibility), 'hidden');
  await page.unroute('**/api/me');
  await page.locator('#session-verification').getByRole('button', { name: 'Try again' }).click();
  await page.locator('#session-verification').waitFor({ state: 'hidden' });
  await page.locator('#capture-dialog[open]').waitFor();

  await page.keyboard.press('Control+k'); await page.locator('[cmdk-input]').waitFor();
  await page.locator('[cmdk-input]').fill('Settings');
  await page.locator('[cmdk-item]').filter({ hasText: /^Settings/ }).click();
  await page.waitForURL('**/dashboard/settings');
  await page.waitForFunction(() => document.body.style.overflow !== 'hidden');
  assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden', 'Nested modal navigation releases scroll lock');
  assert.deepEqual(errors, []);
});

test('a delayed landing session check cannot override navigation after leaving the page', async t => {
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  let release, started, handled = false;
  const held = new Promise(resolve => { release = resolve; });
  const requested = new Promise(resolve => { started = resolve; });
  t.after(async () => { release(); await browser.close(); });
  await context.route('**/api/auth/session', async route => {
    if (handled) return route.continue();
    handled = true; started(); await held;
    await route.fulfill({ json: { account: { id: 'late-session' } } });
  });
  const page = await context.newPage();
  await page.goto(base); await requested;
  await page.locator('.desktop-nav').getByRole('link', { name: 'Explore', exact: true }).click();
  await page.waitForURL(base + '/collections');
  release();
  // Observe the settled network callback and any navigation it might schedule.
  await page.waitForLoadState('networkidle');
  assert.equal(page.url(), base + '/collections');
});
