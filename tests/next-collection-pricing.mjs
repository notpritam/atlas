import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
const base = process.env.FOUNDKEEP_WEB_TEST_URL || 'http://127.0.0.1:18791';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use a disposable backend.');
const evidence = '/tmp/foundkeep-followup-evidence';
const launch = () => chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });

async function contrast(locator) {
  return locator.evaluateAll(elements => {
    const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = color => rgb(color).map(n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }).reduce((v, n, i) => v + n * [.2126, .7152, .0722][i], 0);
    return elements.filter(e => e.getClientRects().length && e.textContent.trim()).map(e => {
      let parent = e, background;
      do { background = getComputedStyle(parent).backgroundColor; parent = parent.parentElement; } while (parent && (background === 'transparent' || background === 'rgba(0, 0, 0, 0)'));
      const a = luminance(getComputedStyle(e).color), b = luminance(background);
      return { text: e.textContent.trim().slice(0, 65), ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
  });
}

test('collection filters stay under the header while scrolling and preserve client navigation', async t => {
  const browser = await launch(), owner = await browser.newContext();
  const password = 'Sticky-controls-only-729103';
  const response = await owner.request.post(base + '/api/auth/register', { headers: { Origin: base }, data: { email: `sticky-${crypto.randomUUID()}@example.test`, name: 'Controls test', password } });
  assert.equal(response.status(), 201);
  t.after(async () => { await owner.request.delete(base + '/api/account', { headers: { Origin: base }, data: { password } }); await browser.close(); });
  const created = await owner.request.post(base + '/api/collections', { headers: { Origin: base }, data: { title: 'A collection worth returning to', slug: 'sticky-' + crypto.randomUUID(), visibility: 'public' } });
  assert.equal(created.status(), 201); const c = (await created.json()).collection;
  for (let i = 0; i < 24; i++) {
    const r = await owner.request.post(base + `/api/collections/${c.id}/entries`, { headers: { Origin: base }, data: { clientId: crypto.randomUUID(), title: `Useful idea ${i}`, body: 'A thoughtful note to keep alongside the original reference. '.repeat(12), tags: [i % 2 ? 'ideas' : 'reading'] } });
    assert.equal(r.status(), 201);
  }
  const guest = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }), page = await guest.newPage(), errors = [];
  page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message)); await mkdir(evidence, { recursive: true });
  const path = '/collection/' + c.slug;
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 640]]) {
    await page.setViewportSize({ width, height }); await page.goto(base + path); await page.locator('.collection-entries[data-layout=masonry]').waitFor();
    await page.evaluate(() => { const controls = document.querySelector('.collection-controls'); scrollTo(0, controls.getBoundingClientRect().top + scrollY + 320); });
    await page.waitForFunction(() => Math.abs(document.querySelector('.collection-controls').getBoundingClientRect().top - document.querySelector('.public-collection-nav').getBoundingClientRect().bottom) < 2);
    const bounds = await page.locator('.collection-controls').boundingBox(); assert.ok(bounds.y >= 0 && bounds.y + bounds.height < height * .6, `Controls fit at ${width}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (width !== 320) await page.screenshot({ path: `${evidence}/sticky-${width}.png` });
    let documents = 0; const documentRequest = r => { if (r.isNavigationRequest() && r.resourceType() === 'document') documents++; }; page.on('request', documentRequest);
    await page.locator('.collection-topic-filters a').filter({ hasText: 'ideas' }).click(); await page.waitForURL('**/collection/*?tag=ideas#collection-finds');
    await page.locator('.collection-topic-filters [aria-current=page]').filter({ hasText: 'ideas' }).waitFor();
    assert.ok(await page.evaluate(() => scrollY > 100), 'Filtering does not jump to the hero');
    await page.getByLabel('Search this collection', { exact: true }).fill('Useful idea'); await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForURL(/q=Useful\+idea.*tag=ideas/); assert.equal(documents, 0); page.removeListener('request', documentRequest);
    await page.goBack(); await page.waitForURL('**/collection/*?tag=ideas#collection-finds');
  }
  assert.deepEqual(errors, []);
});

test('pricing distinguishes Pro and Apps & devices keep contrast in both themes', async t => {
  const browser = await launch(), context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' }), page = await context.newPage(), errors = [];
  page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message)); let accountCreated = false; t.after(async () => { try { if (accountCreated) await context.request.delete(base + '/api/account', { headers: { Origin: base }, data: { password } }); } finally { await browser.close(); } }); await mkdir(evidence, { recursive: true });
  await page.goto(base); await page.locator('#pricing').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('#pricing .plan-card-surface[data-featured=true]').count(), 1);
  assert.equal(await page.getByRole('definition').filter({ hasText: '500 credits' }).count(), 1);
  await page.locator('#pricing').screenshot({ path: `${evidence}/pricing-landing.png` });
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#pricing').screenshot({ path: `${evidence}/pricing-landing-mobile.png` });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const password = 'Contrast-check-only-820471';
  const registration = await context.request.post(base + '/api/auth/register', { headers: { Origin: base }, data: { email: `contrast-${crypto.randomUUID()}@example.test`, name: 'Contrast check', password } });
  assert.equal(registration.status(), 201); accountCreated = true;
  // Exercise manual-install instructions with the same configuration as permanent dev.
  await page.route('**/customer-config.json', async route => { const r = await route.fetch(); const config = await r.json(); await route.fulfill({ response: r, json: { ...config, extensionEnvironment: 'dev' } }); });
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(base + '/dashboard/apps'); await page.locator('#install-extension').waitFor();
    await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
    await page.locator('#manual-install').evaluate(e => e.open = true);
    for (const result of await contrast(page.locator('.apps-setup code,.apps-setup .device-badge,.apps-setup a:not(.button),.account-page-note a'))) assert.ok(result.ratio >= 4.5, `${theme}: ${JSON.stringify(result)}`);
    await page.screenshot({ path: `${evidence}/apps-${theme}.png` });
    await page.locator('#open-plans').click(); await page.waitForURL(base + '/dashboard/plans'); await page.locator('[data-plan=pro]').waitFor();
    const pro = page.locator('[data-plan=pro]'), free = page.locator('[data-plan=free]');
    assert.notEqual(await pro.evaluate(e => getComputedStyle(e).backgroundColor), await free.evaluate(e => getComputedStyle(e).backgroundColor));
    for (const result of await contrast(pro.locator('h3,.plan-description,.plan-highlights dt,.plan-highlights dd,.plan-benefits strong,.plan-benefit-description,.plan-price-note,.plan-extra-label'))) assert.ok(result.ratio >= 4.5, `${theme}: ${JSON.stringify(result)}`);
    await page.locator('.plan-grid').screenshot({ path: `${evidence}/plans-${theme}.png` });
    await page.setViewportSize({ width: 320, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  assert.deepEqual(errors, []);
});
