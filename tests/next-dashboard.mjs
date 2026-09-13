import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:18791').origin;
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Dashboard regression mutations require an isolated loopback test server.');
const evidence = path.resolve(process.env.EVIDENCE_DIR || 'docs/design/next-web/dashboard');
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
const page = await context.newPage();
const errors = []; const results = []; const requests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (request.url().startsWith(base + '/api/')) requests.push(request); });
const password = 'Dashboard-QA-Private-924710';
let cleanupPassword = password;
let created = false;
let account;
const record = name => { results.push({ name, passed: true }); console.log(`PASS ${name}`); };
try {
  const guard = await context.request.get(base + '/dashboard', { maxRedirects: 0 });
  assert.equal(guard.status(), 307); assert.equal(guard.headers().location, '/login'); record('Server redirects an unauthenticated dashboard request');
  const register = await context.request.post(base + '/api/auth/register', { headers: { Origin: base }, data: { name: 'Dashboard QA', email: `dashboard-qa-${Date.now()}@example.test`, password } });
  assert.equal(register.status(), 201, await register.text()); account = (await register.json()).account; created = true;
  const document = await context.request.get(base + '/dashboard');
  assert.match(await document.text(), /Dashboard QA/); record('Initial HTML contains the authenticated account');
  await page.goto(base + '/dashboard'); await page.locator('#new-note:not([disabled])').waitFor();
  assert.equal(await page.locator('#onboarding').count(), 0);
  let failNote = true;
  const noteWrites = [];
  await page.route('**/api/captures', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    noteWrites.push(route.request().postDataJSON());
    if (failNote) { failNote = false; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary QA failure. Retry your note.' }) }); }
    await route.continue();
  });
  await page.locator('#new-note').click(); await page.locator('#note-text').fill('A dashboard QA note, safe to remove.'); await page.locator('#save-note').click();
  await page.locator('#note-error').waitFor({ state: 'visible' }); assert.equal(await page.locator('#note-text').inputValue(), 'A dashboard QA note, safe to remove.');
  await page.locator('#save-note').click(); await page.locator('#note-dialog').waitFor({ state: 'hidden' }); await page.locator('.capture-card').first().waitFor();
  assert.equal(noteWrites.length, 2); assert.equal(noteWrites[0].clientId, noteWrites[1].clientId);
  assert.equal(noteWrites[1].provenance.captureMethod, 'library-note'); assert.deepEqual(noteWrites[1].processingOptions, { ocr: true, summaries: true, tags: true });
  await page.unroute('**/api/captures'); record('Failed note retry retains its draft, identity, provenance and processing choices');
  const image = await readFile(path.resolve('apps/web/assets/studio-architecture-640.webp'));
  const screenshot = await context.request.post(base + '/api/captures', { headers: { Origin: base, 'X-Atlas-Account': account.id }, data: { clientId: crypto.randomUUID(), type: 'screenshot', sourceTitle: 'QA screenshot preview', sourceUrl: 'https://example.test/qa', dataUrl: `data:image/webp;base64,${image.toString('base64')}`, capturedAt: Date.now(), processingOptions: { ocr: false, summaries: false, tags: false } } });
  assert.equal(screenshot.status(), 201, await screenshot.text());
  const noScript = await browser.newContext({ javaScriptEnabled: false, storageState: await context.storageState(), viewport: { width: 1440, height: 1000 } });
  try {
    const noScriptPage = await noScript.newPage(); await noScriptPage.goto(base + '/dashboard');
    const savedImage = noScriptPage.locator('.capture-screenshot img');
    await savedImage.waitFor();
    await noScriptPage.waitForFunction(() => [...document.querySelectorAll('.capture-screenshot img')].every(image => image.complete && image.naturalWidth > 0));
    assert.equal(await savedImage.evaluate(image => image.complete && image.naturalWidth > 0 && getComputedStyle(image).opacity === '1'), true, 'Stored images remain visible in the server-rendered page without JavaScript');
    assert.equal(await noScriptPage.locator('.capture-screenshot .capture-image-skeleton').isVisible(), false);
  } finally { await noScript.close(); }
  record('Server-rendered stored screenshot is visible without JavaScript');
  await page.locator('#refresh-library').click(); await page.locator('.capture-screenshot img').waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.capture-screenshot img')].every(image => image.complete && image.naturalWidth > 0));
  await page.locator('.capture-screenshot .capture-open').click(); await page.locator('#detail-panel .detail-image').waitFor();
  assert.equal(await page.locator('dialog[open]').count(), 0); assert.match(page.url(), /item=/);
  await page.locator('.capture-note .capture-open').click(); await page.locator('#detail-title').filter({ hasText: 'dashboard QA note' }).waitFor();
  assert.equal(await page.locator('.capture-selected').count(), 1); assert.equal(await page.locator('dialog[open]').count(), 0); record('Actual stored screenshot loads and the nonmodal pane switches between cards');
  await page.locator('.expand-capture').click(); await page.waitForURL('**/dashboard/saved/**'); await page.locator('#detail-title').filter({ hasText: 'dashboard QA note' }).waitFor();
  await page.locator('.reading-back').click(); await page.waitForURL(base + '/dashboard'); await page.locator('.capture-open').first().waitFor(); record('Capture expands to its reading route and returns to the collection');
  await page.locator('#search').fill('missing'); await page.getByRole('heading', { name: 'No finds this time.' }).waitFor(); assert.match(page.url(), /q=missing/);
  await page.goBack(); await page.locator('.capture-open').first().waitFor(); assert.equal(await page.locator('#search').inputValue(), '');
  await page.locator('[data-type="note"]').click(); await page.waitForFunction(() => document.querySelectorAll('.capture-card').length === 1); assert.match(page.url(), /type=note/);
  await page.locator('.capture-open').click(); await page.locator('.expand-capture').click(); await page.waitForURL('**/dashboard/saved/**'); assert.equal(new URL(page.url()).searchParams.get('type'), 'note');
  await page.locator('.reading-back').click(); await page.waitForURL('**/dashboard?type=note'); await page.locator('[data-type=""]').click(); record('Search, filters, Back and expanded-reader return preserve URL state');
  await page.locator('#open-account').click(); await page.locator('#sidebar-account-settings').click(); await page.waitForURL('**/dashboard/settings'); await page.getByRole('link', { name: 'Browser capture', exact: true }).click(); await page.locator('#preference-form[data-ready="true"]').waitFor();
  await page.locator('[data-preference="capture.note"]').uncheck(); await page.locator('#save-preferences').click(); await page.locator('#preference-message').filter({ hasText: 'Saved.' }).waitFor();
  await page.locator('#all-captures').click(); await page.waitForURL(base + '/dashboard'); await page.locator('#new-note').waitFor(); assert.equal(await page.locator('#new-note').isDisabled(), true);
  await page.locator('#open-account').click(); await page.locator('#sidebar-account-settings').click(); await page.getByRole('link', { name: 'Browser capture', exact: true }).click(); await page.locator('#preference-form[data-ready="true"]').waitFor(); await page.locator('[data-preference="capture.note"]').check(); await page.locator('#save-preferences').click(); await page.locator('#preference-message').filter({ hasText: 'Saved.' }).waitFor();
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await page.locator('#export-account').click(); const download = page.waitForEvent('download'); await page.locator('#confirm-accept').click(); assert.match((await download).suggestedFilename(), /^foundkeep-export-.*\.json$/);
  await page.locator('#current-password').fill(password); cleanupPassword = 'Dashboard-QA-Rotated-924710'; await page.locator('#new-password').fill(cleanupPassword); await page.locator('#change-password').click(); await page.locator('#confirm-accept').click();
  await page.locator('#password-recovery-dialog').waitFor({ state: 'visible' }); assert.equal(await page.locator('#finish-password-recovery').isDisabled(), true);
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#password-recovery-dialog').isVisible(), true);
  await page.locator('#password-recovery-saved').check(); await page.locator('#finish-password-recovery').click(); assert.equal(await page.locator('#password-recovery-code').textContent(), '');
  await page.locator('#logout').click(); await page.locator('#confirm-cancel').click(); await page.locator('#all-captures').click(); await page.waitForURL(base + '/dashboard'); record('Preferences, confirmed export/logout and recovery acknowledgement work');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Overflow at ${width}`);
    await page.screenshot({ path: path.join(evidence, `dashboard-${width}.png`), fullPage: true });
  }
  record('Dashboard fits desktop, phone and narrow phone widths');
  await page.setViewportSize({ width: 1440, height: 1600 });
  let previewActive = 0, previewMaximum = 0, previewCompleted = 0;
  const remoteCards = Array.from({ length: 8 }, (_, index) => ({ id: `queued-preview-${index}`, type: 'bookmark', sourceTitle: `Queued preview ${index + 1}`, summary: 'A saved reference. '.repeat(index % 3 * 6), width: 640, height: [320, 640, 900][index % 3], previewUrl: `/api/captures/queued-preview-${index}/preview`, capturedAt: Date.now(), status: 'done' }));
  await page.route('**/api/captures?**', async route => { if (new URL(route.request().url()).searchParams.get('q') === 'preview-queue') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ captures: remoteCards, nextCursor: null, total: remoteCards.length }) }); await route.continue(); });
  await page.route('**/api/captures/queued-preview-*/preview', async route => {
    previewActive++; previewMaximum = Math.max(previewMaximum, previewActive);
    await new Promise(resolve => setTimeout(resolve, 350));
    await route.fulfill({ contentType: 'image/webp', body: image });
    previewActive--; previewCompleted++;
  });
  await page.locator('#search').fill('preview-queue');
  await page.waitForFunction(() => document.querySelectorAll('.capture-card').length === 8);
  await page.locator('.capture-card').last().scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelectorAll('.capture-preview-shell img').length === 8 && [...document.querySelectorAll('.capture-preview-shell img')].every(image => image.complete && image.naturalWidth));
  assert.equal(previewCompleted, 8); assert.ok(previewMaximum <= 2, `Remote preview concurrency reached ${previewMaximum}`);
  const packed = await page.locator('#capture-grid > [data-capture-id]').evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, height: box.height }; }));
  assert.ok(new Set(packed.map(item => item.height)).size > 2);
  for (const [index, item] of packed.entries()) {
    const next = packed.slice(index + 1).find(later => Math.abs(item.x - later.x) < 1);
    if (next) assert.ok(Math.abs(next.y - item.y - item.height - 18) < 1, 'cards pack immediately below their column neighbor');
  }
  await page.screenshot({ path: path.join(evidence, 'flowing-gallery.png'), fullPage: true });

  await page.unroute('**/api/captures?**'); await page.unroute('**/api/captures/queued-preview-*/preview');
  await page.locator('#search').fill(''); await page.locator('.capture-note').waitFor();
  record(`Eight delayed previews load through the bounded queue (maximum ${previewMaximum} concurrent)`);
  const mobileLogin = await context.request.post(base + '/api/mobile/login', { data: { email: account.email, password: cleanupPassword, deviceName: 'iPhone QA' } });
  assert.equal(mobileLogin.status(), 200, await mobileLogin.text());
  const mobileToken = (await mobileLogin.json()).token;
  const latest = await context.request.post(base + '/api/captures', { headers: { Authorization: `Bearer ${mobileToken}` }, data: { clientId: crypto.randomUUID(), type: 'bookmark', sourceTitle: 'Latest arrival from iPhone', sourceUrl: 'https://youtube.com/watch?v=qa', capturedAt: 1, processingOptions: { ocr: false, summaries: false, tags: false } } });
  assert.equal(latest.status(), 201, await latest.text());
  await page.getByRole('button', { name: 'Open Bookmark: Latest arrival from iPhone' }).waitFor({ timeout: 22000 });
  assert.match(await page.locator('.capture-card').first().innerText(), /Latest arrival from iPhone/);
  assert.match(await page.locator('.capture-card').first().innerText(), /YouTube/);
  assert.match(await page.locator('.capture-card').first().innerText(), /iPhone/);
  await page.waitForTimeout(300);
  const geometry = await page.locator('#capture-grid > [data-capture-id]').evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return { x: box.x, y: box.y, height: box.height }; }));
  for (const [index, item] of geometry.entries()) for (const later of geometry.slice(index + 1)) if (Math.abs(item.x - later.x) < 1) assert.ok(later.y >= item.y + item.height + 17, 'web masonry preserves the 18px gutter');
  await page.screenshot({ path: path.join(evidence, 'recent-masonry.png'), fullPage: true });
  record('Newest cross-device save appears automatically with platform and saving-device labels');

  await page.setViewportSize({ width: 390, height: 1000 }); await page.locator('.capture-note .capture-open').click(); await page.waitForURL('**/dashboard/saved/**');
  assert.equal(await page.locator('.capture-reading-view').count(), 1); await page.screenshot({ path: path.join(evidence, 'reading-mobile.png'), fullPage: true }); record('Phone card opens the dedicated reading page');
  const dependent = requests.filter(request => !request.url().endsWith('/api/auth/providers') && !/\/(blob|file|preview)$/.test(new URL(request.url()).pathname));
  for (const request of dependent) assert.equal((await request.allHeaders())['x-atlas-account'], account.id, `Missing account guard on ${request.url()}`);
  assert.deepEqual(errors, []); record('Dependent API calls retain their account guard without browser exceptions');
} catch (error) {
  await page.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  if (created) { let removed = await context.request.delete(base + '/api/account', { headers: { Origin: base, 'X-Atlas-Account': account.id }, data: { password: cleanupPassword } }); if (removed.status() !== 200 && cleanupPassword !== password) removed = await context.request.delete(base + '/api/account', { headers: { Origin: base, 'X-Atlas-Account': account.id }, data: { password } }); results.push({ name: 'Delete the disposable QA account', passed: removed.status() === 200, status: removed.status() }); console.log('QA account cleanup status:', removed.status()); }
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify({ base, checkedAt: new Date().toISOString(), results, errors }, null, 2));
  await browser.close();
}
