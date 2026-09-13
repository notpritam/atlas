import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const base = process.env.BASE_URL || 'http://127.0.0.1:18791';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Use a disposable local test server.');
const delayGate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };

test('dashboard motion follows real work, respects reduced motion, and survives interrupted navigation', async t => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
  const password = 'Motion-QA-Disposable-924716';
  const registered = await context.request.post(base + '/api/auth/register', { headers: { Origin: base }, data: { email: `motion-${crypto.randomUUID()}@example.test`, name: 'Motion collector', password } });
  assert.equal(registered.status(), 201, await registered.text());
  const gates = [];
  const gate = () => { const value = delayGate(); gates.push(value); return value; };
  t.after(async () => {
    for (const pending of gates) pending.release();
    try { assert.equal((await context.request.delete(base + '/api/account', { headers: { Origin: base }, data: { password } })).status(), 200); }
    finally { await browser.close(); }
  });
  for (let index = 0; index < 4; index++) {
    const response = await context.request.post(base + '/api/captures', { headers: { Origin: base }, data: { clientId: crypto.randomUUID(), type: 'note', noteText: `Saved thought ${index + 1}. ` + 'A useful reference for the next project. '.repeat(index * 3), capturedAt: Date.now() - index * 1000 } });
    assert.equal(response.status(), 201, await response.text());
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/dashboard');
  await page.locator('#new-note:enabled').waitFor();
  await page.locator('#new-note').click();
  await page.waitForFunction(() => document.activeElement?.id === 'note-text');
  await page.locator('#note-text').fill('A smooth interaction worth keeping.');

  const save = gate();
  await page.route('**/api/captures', async route => { if (route.request().method() === 'POST') await save.promise; await route.continue(); });
  await page.locator('#save-note').click();
  await page.locator('#save-note .work-spinner').waitFor();
  assert.equal(await page.locator('#note-form').getAttribute('aria-busy'), 'true');
  assert.equal(await page.locator('#save-note').isDisabled(), true);
  await mkdir('.impeccable/review/dashboard-motion', { recursive: true });
  await page.screenshot({ path: '.impeccable/review/dashboard-motion/saving-note.png' });
  save.release();
  await page.locator('#note-dialog').waitFor({ state: 'hidden' });
  await page.locator('.capture-card').first().waitFor();
  await page.unroute('**/api/captures');
  await page.locator('#refresh-library:enabled').waitFor();

  const refresh = gate();
  await page.route('**/api/captures?*', async route => { await refresh.promise; await route.continue(); });
  await page.locator('#refresh-library').click();
  await page.waitForFunction(() => document.querySelector('#refresh-library')?.getAttribute('aria-busy') === 'true');
  const rotation = () => page.locator('.refresh-glyph').evaluate(element => getComputedStyle(element).transform);
  const first = await rotation();
  await page.waitForTimeout(140);
  assert.notEqual(await rotation(), first, 'Refresh visibly rotates during its request');
  assert.equal(await page.locator('.capture-card').first().isVisible(), true, 'Background refresh preserves the collection');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(80);
  assert.equal(await rotation(), 'none', 'Changing the OS preference stops an in-flight animation');
  refresh.release();
  await page.locator('#refresh-library:enabled').waitFor();
  assert.equal(await page.locator('#refresh-library').getAttribute('aria-busy'), 'false');
  await page.unroute('**/api/captures?*');

  const search = gate();
  await page.route('**/api/captures?*', async route => { await search.promise; await route.continue(); });
  await page.locator('#search').fill('unmatched');
  await page.locator('.skeleton-library').waitFor();
  assert.equal(await page.locator('.skeleton-library .loading-shimmer').first().isVisible(), false, 'Reduced motion keeps skeletons static');
  search.release();
  await page.getByRole('heading', { name: 'No finds this time.' }).waitFor();
  await page.unroute('**/api/captures?*');
  await page.locator('#all-captures').click();
  await page.locator('.capture-card').first().waitFor();

  // Delay the RSC navigation itself to exercise Next's actual pending link state.
  const navigation = gate();
  await page.route('**/dashboard/apps?*', async route => { await navigation.promise; await route.continue(); });
  await page.locator('#open-setup').click();
  await page.locator('#open-setup .navigation-pending').waitFor();
  assert.equal(await page.locator('#open-setup .work-spinner').evaluate(element => getComputedStyle(element).transform), 'none');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('#open-setup .navigation-pending').isVisible(), true, 'Navigation feedback stays visible on phones');
  await page.screenshot({ path: '.impeccable/review/dashboard-motion/navigation-phone.png' });
  navigation.release();
  await page.waitForURL(base + '/dashboard/apps');
  await page.getByRole('heading', { name: 'Apps & devices', exact: true }).waitFor();
  await page.unroute('**/dashboard/apps?*');
  assert.equal(await page.locator('.navigation-pending').count(), 0);

  const plan = gate();
  const planRequested = gate();
  await page.route('**/api/plan', async route => { planRequested.release(); await plan.promise; await route.continue(); });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('#open-plans').click();
  await planRequested.promise;
  await page.locator('.plan-loading .skeleton-plan').waitFor();
  await page.screenshot({ path: '.impeccable/review/dashboard-motion/plans-loading-phone.png' });
  plan.release();
  await page.locator('[data-plan="free"]').waitFor();
  assert.equal(await page.locator('.skeleton-plan').count(), 0);
  await page.unroute('**/api/plan');

  // Leave a loading destination and ensure neither stale content nor a loader resurfaces.
  const abandoned = gate();
  await page.route('**/dashboard/settings?*', async route => { await abandoned.promise; await route.continue(); });
  await page.locator('#open-settings').click();
  await page.locator('#open-settings .navigation-pending').waitFor();
  await page.locator('#all-captures').click();
  await page.waitForURL(base + '/dashboard');
  abandoned.release();
  await page.locator('.capture-card').first().waitFor();
  await page.waitForTimeout(650);
  assert.equal(page.url(), base + '/dashboard');
  assert.equal(await page.locator('.navigation-pending, .section-loading').count(), 0);
  await page.unroute('**/dashboard/settings?*');

  // Rapid panel changes and resizes settle without offsets or hidden cards.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.capture-open').first().click();
  await page.locator('#detail-title').waitFor();
  await page.getByRole('button', { name: 'Close capture', exact: true }).focus();
  await page.keyboard.press('Escape');
  await page.locator('#detail-panel').waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(650);
  const cards = await page.locator('[data-capture-id]').evaluateAll(elements => elements.map(element => ({ transform: getComputedStyle(element).transform, opacity: getComputedStyle(element).opacity })));
  assert.ok(cards.length && cards.every(card => card.transform === 'none' && card.opacity === '1'), 'Interrupted movement settles at the actual masonry positions');
  const bounds = await page.locator('[data-capture-id]').evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }; }));
  assert.equal(bounds.length, 5);
  for (let index = 0; index < bounds.length; index++) for (const other of bounds.slice(index + 1)) {
    const card = bounds[index];
    assert.ok(card.right <= other.left + 1 || other.right <= card.left + 1 || card.bottom <= other.top + 1 || other.bottom <= card.top + 1, 'Cards do not overlap after interrupted reflow');
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: '.impeccable/review/dashboard-motion/library-phone.png' });
  assert.deepEqual(errors, []);
});
