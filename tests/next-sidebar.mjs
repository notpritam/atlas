import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const base = process.env.BASE_URL || 'http://127.0.0.1:18791';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Use a disposable local backend.');

test('sidebar collapse preserves navigation, persists, and adapts to narrow screens', async t => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
  const password = 'Sidebar-disposable-719386-QA';
  let account;
  t.after(async () => {
    try { if (account) assert.equal((await context.request.delete(base + '/api/account', { headers: { Origin: base, 'X-Atlas-Account': account.id }, data: { password } })).status(), 200); }
    finally { await browser.close(); }
  });
  const registration = await context.request.post(base + '/api/auth/register', { headers: { Origin: base }, data: { email: `sidebar-${crypto.randomUUID()}@example.test`, name: 'Sidebar collector', password } });
  assert.equal(registration.status(), 201, await registration.text());
  account = (await registration.json()).account;
  for (let index = 0; index < 6; index++) {
    const capture = await context.request.post(base + '/api/captures', { headers: { Origin: base, 'X-Atlas-Account': account.id }, data: { clientId: crypto.randomUUID(), type: 'note', noteText: `A saved idea ${index + 1}. ` + 'Something useful to come back to. '.repeat(index * 2), capturedAt: Date.now() - index * 1000 } });
    assert.equal(capture.status(), 201);
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/dashboard');
  await page.locator('#new-note:enabled').waitFor();
  const sidebar = page.locator('.library-sidebar');
  const toggle = page.locator('#toggle-sidebar');
  const main = page.locator('#main');
  const originalWidth = (await main.boundingBox()).width;
  await toggle.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.library-sidebar')?.dataset.collapsed === 'true' && getComputedStyle(document.querySelector('#main')).transform === 'none');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await toggle.getAttribute('aria-label'), 'Expand sidebar');
  assert.ok((await sidebar.boundingBox()).width <= 88);
  assert.ok((await main.boundingBox()).width > originalWidth + 150, 'Collapsing gives the saved content more space');
  assert.equal(await toggle.evaluate(element => element === document.activeElement), true, 'Keyboard focus stays on the control');
  await page.getByRole('link', { name: 'Apps & devices', exact: true }).focus();
  await page.locator('#open-setup .sidebar-nav-label').waitFor({ state: 'visible' });
  await mkdir('.impeccable/review/sidebar', { recursive: true });
  await page.screenshot({ path: '.impeccable/review/sidebar/collapsed-desktop.png', fullPage: true });
  await page.keyboard.press('Enter');
  await page.waitForURL(base + '/dashboard/apps');
  await page.waitForFunction(() => document.querySelector('.library-sidebar')?.dataset.collapsed === 'true');
  assert.equal(await page.locator('#open-setup').getAttribute('aria-current'), 'page');
  await page.locator('#open-settings').click();
  await page.waitForURL(base + '/dashboard/settings');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.library-sidebar')?.dataset.collapsed === 'true');
  await page.locator('#open-plans').click();
  await page.waitForURL(base + '/dashboard/plans');
  await page.goBack();
  await page.waitForURL(base + '/dashboard/settings');
  assert.equal(await sidebar.getAttribute('data-collapsed'), 'true');

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('#workspace-navigation').isVisible(), false, 'The compact phone header hides the navigation row');
  assert.equal(await page.locator('#open-account').isVisible(), true);
  await page.screenshot({ path: '.impeccable/review/sidebar/collapsed-phone.png', fullPage: true });
  await toggle.click();
  await page.locator('#workspace-navigation').waitFor({ state: 'visible' });
  await page.locator('#open-plans').click();
  await page.waitForURL(base + '/dashboard/plans');
  await page.locator('[data-plan="free"]').waitFor();
  await page.waitForTimeout(650);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  for (const width of [320, 390, 820, 1100, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Expanded sidebar fits ${width}px`);
    const button = await toggle.boundingBox();
    assert.ok(button.width >= 44 && button.height >= 44, `Collapse target is reachable at ${width}px`);
    if (width === 390 || width === 1440) await page.screenshot({ path: `.impeccable/review/sidebar/expanded-${width}.png`, fullPage: true });
  }
  await page.locator('#all-captures').click();
  await page.waitForURL(base + '/dashboard');
  await page.locator('.capture-card').first().waitFor();
  await page.locator('[data-type="note"]').click();
  await toggle.click();
  await page.locator('#all-captures').click();
  await page.waitForURL(base + '/dashboard');
  assert.equal(await page.locator('[data-type=""]').getAttribute('aria-pressed'), 'true', 'Library still resets filters in compact mode');
  for (let index = 0; index < 4; index++) await toggle.click();
  await page.waitForTimeout(650);
  assert.equal(await main.evaluate(element => getComputedStyle(element).transform), 'none', 'Interrupted transitions settle');
  assert.ok(await page.locator('[data-capture-id]').evaluateAll(elements => elements.every(element => getComputedStyle(element).transform === 'none')));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await toggle.click();
  assert.equal(await main.evaluate(element => getComputedStyle(element).transform), 'none', 'Reduced motion changes the layout immediately');
  await page.setViewportSize({ width: 820, height: 500 });
  await page.locator('#open-account').scrollIntoViewIfNeeded();
  const accountControl = await page.locator('#open-account').boundingBox();
  assert.ok(accountControl.y >= 0 && accountControl.y + accountControl.height <= 500, 'Account remains reachable by scrolling the sidebar on short screens');
  await page.getByRole('link', { name: 'Privacy & data', exact: true }).scrollIntoViewIfNeeded();
  const privacy = await page.getByRole('link', { name: 'Privacy & data', exact: true }).boundingBox();
  assert.ok(privacy.y >= 0 && privacy.y + privacy.height <= 500, 'Sidebar utilities remain reachable with all workspace destinations on short screens');
  assert.deepEqual(errors, []);

  const privateContext = await browser.newContext({ storageState: await context.storageState(), reducedMotion: 'reduce' });
  await privateContext.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage unavailable', 'SecurityError'); } }));
  const privatePage = await privateContext.newPage();
  privatePage.on('pageerror', error => errors.push(error.message));
  await privatePage.goto(base + '/dashboard');
  await privatePage.locator('#new-note:enabled').waitFor();
  await privatePage.locator('#toggle-sidebar').click();
  assert.equal(await privatePage.locator('.library-sidebar').getAttribute('data-collapsed'), 'true', 'Storage errors do not disable the control');
  await privateContext.close();
  assert.deepEqual(errors, []);
});
