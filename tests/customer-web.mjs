import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
let browser, server, base, dataDir;
const now = Date.now();
const account = { id: 'test-account', email: 'collector@example.test', name: 'Alex', createdAt: now };
const defaultPreferences = {
  version: 1,
  capture: { region: true, fullPage: true, highlight: true, bookmark: true, image: true, tweet: true, note: true },
  bookmark: { readableText: true, extendedMetadata: true, headings: true },
  notes: { attachSource: true },
  popup: { actionOrder: ['bookmark', 'highlight', 'region', 'fullPage'], showRecent: true, recentCount: 3 },
  sync: { automatic: true },
  organization: { ocr: true, summaries: true, tags: true },
  feedback: { success: true },
  contextMenus: true,
};
const fixtureCaptures = [
  { id: 'photo', type: 'image', sourceTitle: 'An unexpected doorway', sourceUrl: 'https://example.com/architecture', blobUrl: '/api/captures/photo/blob', tags: ['architecture', 'inspiration'] },
  { id: 'highlight', type: 'selection', sourceTitle: 'A thought on collecting', selectionText: 'A good collection starts with noticing. Leave a little room for the unexpected.', sourceUrl: 'https://example.com/field-notes', tags: ['ideas'] },
  { id: 'note', type: 'note', noteText: 'Bring a little more intention to the things we keep. Start with the details worth returning to.', tags: [] },
  { id: 'bookmark', type: 'bookmark', sourceTitle: 'A field guide to seeing', articleText: 'A few observations about everyday places, objects and the details that make them memorable.', sourceUrl: 'https://example.com/field-guide', tags: [], provenance: { schemaVersion: 1, captureMethod: 'popup-save-page', pageUrl: 'https://example.com/field-guide?from=atlas', canonicalUrl: 'https://example.com/field-guide', pageTitle: 'A field guide to seeing', siteName: 'Example Review', description: 'A guide to noticing.', authors: ['Mina Vale'], publishedAt: '2026-08-22T09:00:00.000Z', modifiedAt: null, language: 'en', leadImageUrl: null, faviconUrl: 'https://example.com/favicon.ico', targetUrl: null, headings: ['Look closely', 'Keep context'], capturedAt: new Date(now).toISOString(), extractedAt: new Date(now + 50).toISOString(), extractorVersion: 'atlas-readable/1', contentHash: 'QJ7wKGnJ-txQi4PddSI5BQbzLW-uKr7CemEJGc9uYWQ', extractionStatus: 'complete', extractionError: null } },
  { id: 'image-2', type: 'screenshot', sourceTitle: 'Light, material, rhythm', blobUrl: '/api/captures/image-2/blob', sourceUrl: 'https://example.com/studio', tags: [] },
  { id: 'note-2', type: 'note', noteText: 'Things to come back to: olive greens, concrete textures, and this particular afternoon light.', tags: [] },
].map((capture, index) => ({ clientId: capture.id, status: 'done', capturedAt: now - index * 86400000, ...capture }));
before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'atlas-customer-web-'));
  const code = `import { createApp } from './apps/backend/src/app.ts'; import { openDb } from './apps/backend/src/db.ts'; import { config } from './apps/backend/src/config.ts'; let app; const server = Bun.serve({hostname:'127.0.0.1',port:0,fetch:req=>app.fetch(req,{clientIp:'127.0.0.1'})}); config.customerOrigin=server.url.origin; config.customerOrigins=[server.url.origin]; app=createApp(openDb()); console.log('READY '+server.url.origin);`;
  server = spawn(process.env.BUN_BIN || process.env.BUN_PATH || 'bun', ['--eval', code], { cwd: process.cwd(), env: { ...process.env, ATLAS_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  base = await new Promise((resolve, reject) => {
    let output = ''; const timeout = setTimeout(() => reject(new Error(`Customer test server timed out: ${output}`)), 10000);
    server.stdout.on('data', chunk => { output += chunk; const match = output.match(/READY (http:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    server.stderr.on('data', chunk => { output += chunk; });
    server.on('error', error => { clearTimeout(timeout); reject(error); }); server.on('exit', code => { clearTimeout(timeout); reject(new Error(`Customer test server exited ${code}: ${output}`)); });
  });
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
});
after(async () => { await browser?.close(); server?.kill(); await rm(dataDir, { recursive: true, force: true }); });

async function pageFor(t, { mock = true, captures = fixtureCaptures, extensionAccount = null, extensionAccountsById = null, extensionIds = ['mjfcgmboaijfcaanepdipbgmipnccnpn'], storeUrl = null, extensionInstalled = true, extensionPreferenceRevision = 1, width = 1440, userAgent, handler } = {}) {
  const context = await browser.newContext({ ...(userAgent ? { userAgent } : {}), viewport: { width, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
  t.after(() => context.close());
  const requests = []; const model = { account, captures: [...captures], connections: extensionAccount?.id === account.id ? [{ id: 'connected-browser', name: 'Chrome', createdAt: now, lastSeenAt: now }] : [], usage: null, preferences: structuredClone(defaultPreferences), preferenceRevision: 0 };
  if (mock) await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const body = request.postDataJSON(); requests.push({ path: url.pathname, query: url.searchParams, method: request.method(), body });
    const response = handler ? await handler({ request, url, body, model }) : undefined;
    if (response) return route.fulfill({ status: response.status || 200, contentType: 'application/json', body: JSON.stringify(response.body) });
    const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.endsWith('/blob')) return route.fulfill({ contentType: 'image/webp', path: path.resolve('apps/web/assets/studio-architecture-640.webp') });
    if (url.pathname === '/api/me') return json({ account: model.account, connections: model.connections, usage: { captures: model.captures.length, bytes: 1432020, maxCaptures: 1000, maxBytes: 209715200 } });
    if (url.pathname === '/api/preferences' && request.method() === 'GET') return json({ preferences: model.preferences, revision: model.preferenceRevision, updatedAt: null });
    if (url.pathname === '/api/preferences' && request.method() === 'PUT') { model.preferences = body; model.preferenceRevision += 1; return json({ preferences: model.preferences, revision: model.preferenceRevision, updatedAt: now }); }
    if (url.pathname === '/api/captures' && request.method() === 'GET') {
      const items = model.captures.filter(capture => (!url.searchParams.get('type') || capture.type === url.searchParams.get('type')) && (!url.searchParams.get('q') || JSON.stringify(capture).toLowerCase().includes(url.searchParams.get('q').toLowerCase())));
      return json({ captures: items, nextCursor: null, total: items.length });
    }
    if (url.pathname === '/api/captures' && request.method() === 'POST') { const capture = { id: 'new-note', status: 'pending', ...body }; model.captures.unshift(capture); return json({ capture, duplicate: false }); }
    if (url.pathname.startsWith('/api/captures/')) {
      const id = url.pathname.split('/').at(-1);
      if (request.method() === 'DELETE') { model.captures = model.captures.filter(item => item.id !== id); return json({ ok: true }); }
      const capture = model.captures.find(item => item.id === id);
      return capture ? json({ capture }) : route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not found' }) });
    }
    if (url.pathname === '/api/pairing') return json({ code: 'test-single-use-pairing-code', expiresAt: now + 300000 });
    if (url.pathname === '/api/auth/password') { model.connections = []; return json({ ok: true, recoveryCode: 'new-test-recovery-code' }); }
    if (url.pathname === '/api/auth/register' || url.pathname === '/api/auth/recover') return json({ account, recoveryCode: 'test-recovery-code' });
    if (url.pathname === '/api/auth/login') return json({ account });
    if (url.pathname === '/api/account/export') return json({ captures: model.captures });
    if (url.pathname.startsWith('/api/connections/')) { model.connections = []; return json({ ok: true }); }
    return json({ ok: true });
  });
  await context.route('**/customer-config.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ extensionIds, storeUrl }) }));
  await context.addInitScript(({ extensionAccount, extensionAccountsById, extensionInstalled, extensionPreferenceRevision, account }) => {
    window.__extensionMessages = [];
    if (!extensionInstalled) return;
    let connected = extensionAccount;
    window.chrome = { runtime: { sendMessage(id, message, callback) {
      window.__extensionMessages.push({ id, message });
      if (message.kind === 'atlas-ping') callback({ ok: true, version: '1.5.0', account: extensionAccountsById ? extensionAccountsById[id] || null : connected });
      if (message.kind === 'atlas-connect') { connected = account; callback({ ok: true, account }); }
      if (message.kind === 'atlas-refresh-preferences') callback({ ok: true, revision: extensionPreferenceRevision });
    } } };
  }, { extensionAccount, extensionAccountsById, extensionInstalled, extensionPreferenceRevision, account });
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'No unhandled browser errors'));
  return { page, requests, model, context };
}
async function openLibrary(page) { await page.goto(`${base}/dashboard.html`); await page.locator('#new-note:not([disabled])').waitFor(); await page.locator('#capture-grid[aria-busy="false"]').waitFor({ state: 'attached' }); }

test('customer pages present the FoundKeep identity', async () => {
  for (const file of ['auth.html', 'dashboard.html', 'privacy.html', 'redeem.html', 'support.html', 'terms.html']) {
    const source = await readFile(path.resolve('apps/web', file), 'utf8');
    assert.match(source, /FoundKeep/);
    assert.doesNotMatch(source, />\s*Atlas(?:\s|<)/);
  }
});

test('real API: signup, notes, logout, login, recovery and account deletion', async t => {
  const { page } = await pageFor(t, { mock: false });
  await page.goto(`${base}/auth.html?mode=signup`);
  await page.locator('#name').fill('Browser QA'); await page.locator('#email').fill(`browser-${now}@example.test`); await page.locator('#password').fill('A-long-test-password-2096');
  await page.locator('#auth-submit').click(); await page.locator('#recovery-save').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#continue-dashboard').isDisabled(), true);
  const originalRecovery = await page.locator('#new-recovery-code').textContent(); assert.ok(originalRecovery.length > 20);
  const downloaded = page.waitForEvent('download'); await page.locator('#download-recovery').click(); assert.equal((await downloaded).suggestedFilename(), 'foundkeep-recovery-code.txt');
  await page.locator('#recovery-saved').check(); await page.locator('#continue-dashboard').click(); await page.waitForURL('**/dashboard.html');
  await page.locator('#new-note:not([disabled])').click(); await page.locator('#note-text').fill('This note was saved through the real API.');
  const saved = page.waitForResponse(response => response.url().endsWith('/api/captures') && response.request().method() === 'POST');
  await page.locator('#save-note').click(); assert.equal((await saved).status(), 201);
  await page.locator('.capture-open').waitFor(); assert.match(await page.locator('#capture-grid').textContent(), /real API/);
  await page.locator('.capture-open').click(); await page.locator('#detail-actions').waitFor({ state: 'visible' }); assert.match(await page.locator('#detail-body').textContent(), /real API/);
  await page.locator('#delete-capture').click(); await page.locator('#confirm-accept').click(); await page.locator('#library-state').waitFor({ state: 'visible' });
  await page.locator('#open-account').click(); await page.locator('#logout').click(); await page.locator('#confirm-accept').click(); await page.waitForURL('**/auth.html?mode=login');
  await page.locator('#email').fill(`browser-${now}@example.test`); await page.locator('#password').fill('A-long-test-password-2096'); await page.locator('#auth-submit').click(); await page.waitForURL('**/dashboard.html');
  await page.locator('#new-note:not([disabled])').waitFor(); await page.locator('#open-account').click(); await page.locator('#logout').click(); await page.locator('#confirm-accept').click(); await page.waitForURL('**/auth.html?mode=login');
  await page.locator('[data-mode="recover"]').click(); await page.locator('#email').fill(`browser-${now}@example.test`); await page.locator('#recovery-code').fill(originalRecovery); await page.locator('#password').fill('A-new-recovered-password-2096'); await page.locator('#auth-submit').click(); await page.locator('#recovery-save').waitFor({ state: 'visible' });
  assert.notEqual(await page.locator('#new-recovery-code').textContent(), originalRecovery); await page.locator('#recovery-saved').check(); await page.locator('#continue-dashboard').click(); await page.waitForURL('**/dashboard.html');
  await page.locator('#new-note:not([disabled])').waitFor(); await page.locator('#open-account').click(); await page.locator('#open-delete-account').click(); await page.locator('#delete-password').fill('An-incorrect-password-2096'); await page.locator('#delete-acknowledged').check(); await page.locator('#delete-account-submit').click();
  await page.locator('#delete-account-error').waitFor({ state: 'visible' }); assert.equal(await page.locator('#session-dialog').isVisible(), false, 'Wrong password must not expire a valid session');
  await page.locator('#delete-password').fill('A-new-recovered-password-2096'); await page.locator('#delete-account-submit').click(); await page.waitForURL('**/auth.html?mode=signup&deleted=1');
});

test('real API: a stale dashboard cannot save a draft into a different signed-in account', async t => {
  const { page, context } = await pageFor(t, { mock: false });
  const password = 'Cross-tab-test-password-2096';
  const register = async suffix => {
    const response = await context.request.post(`${base}/api/auth/register`, { headers: { Origin: base }, data: { name: `Account ${suffix}`, email: `cross-tab-${suffix}-${now}@example.test`, password } });
    assert.equal(response.status(), 201); return (await response.json()).account;
  };
  const first = await register('a');
  await openLibrary(page); await page.locator('#new-note').click(); await page.locator('#note-text').fill('This private draft belongs only to account A.');
  const second = await register('b');
  assert.notEqual(first.id, second.id);
  const save = page.waitForResponse(response => response.url().endsWith('/api/captures') && response.request().method() === 'POST');
  await page.locator('#save-note').click();
  const response = await save;
  assert.equal((await response.request().allHeaders())['x-atlas-account'], first.id);
  assert.equal(response.status(), 409); assert.equal((await response.json()).error, 'account_changed');
  await page.locator('#session-dialog').waitFor({ state: 'visible' });
  assert.match(await page.locator('#session-description').textContent(), /changed in another tab/);
  assert.equal(await page.locator('#note-text').inputValue(), ''); assert.equal(await page.locator('.capture-card').count(), 0);
  const currentLibrary = await context.request.get(`${base}/api/captures`);
  assert.equal(currentLibrary.status(), 200); assert.equal((await currentLibrary.json()).total, 0, 'Account B must not receive account A’s draft');
  await context.request.delete(`${base}/api/account`, { headers: { Origin: base }, data: { password } });
  const login = await context.request.post(`${base}/api/auth/login`, { headers: { Origin: base }, data: { email: first.email, password } });
  assert.equal(login.status(), 200);
  const firstLibrary = await context.request.get(`${base}/api/captures`); assert.equal((await firstLibrary.json()).total, 0);
  await context.request.delete(`${base}/api/account`, { headers: { Origin: base }, data: { password } });
});

test('library search, filter and detail render capture text safely', async t => {
  const malicious = { id: 'unsafe', type: 'note', noteText: '<img src=x onerror="window.__xss=true">', sourceTitle: '<script>alert(1)</script>', sourceUrl: 'javascript:window.__xss=true', blobUrl: 'https://evil.example/private', tags: ['<img src=x>'], capturedAt: now, status: 'done' };
  const { page } = await pageFor(t, { captures: [malicious, ...fixtureCaptures] });
  await openLibrary(page); await page.locator('[data-type="note"]').click(); await page.locator('.capture-open').first().click();
  await page.locator('#detail-actions').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#detail-body script,#detail-body img,#detail-body a').count(), 0);
  assert.match(await page.locator('#detail-body').textContent(), /<script>/);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  await page.keyboard.press('Escape'); await page.locator('#search').fill('no-such-capture'); await page.getByRole('heading', { name: 'No finds this time.' }).waitFor();
  await page.getByRole('button', { name: 'Clear filters' }).click(); await page.locator('.capture-open').nth(6).waitFor();
  await page.keyboard.press('/'); assert.equal(await page.evaluate(() => document.activeElement.id), 'search');
});

test('universal files render as collection items with safe previews and origin details', async t => {
  const batchId = '09f0c5db-1b39-44f0-b020-ad11b7d87d9c';
  const captures = [
    { id: 'document-1', clientId: 'document-1', batchId, type: 'document', status: 'done', sourceTitle: 'Quarterly report', sourceUrl: 'https://example.com/report', fileName: 'Quarterly Report.pdf', fileMime: 'application/pdf', fileBytes: 12345, fileUrl: '/api/captures/document-1/file', capturedAt: now, tags: [], provenance: { sourceApplication: 'com.apple.DocumentsApp', originalFileName: 'Quarterly Report.pdf', declaredMime: 'application/pdf', byteSize: 12345 } },
    { id: 'audio-1', clientId: 'audio-1', batchId, type: 'audio', status: 'done', fileName: 'Voice memo.m4a', fileMime: 'audio/mp4', fileBytes: 23456, fileUrl: '/api/captures/audio-1/file', capturedAt: now - 1, tags: [] },
    { id: 'video-1', clientId: 'video-1', batchId, type: 'video', status: 'done', fileName: 'Clip.mp4', fileMime: 'video/mp4', fileBytes: 34567, fileUrl: '/api/captures/video-1/file', capturedAt: now - 2, tags: [] },
    { id: 'file-1', clientId: 'file-1', batchId, type: 'file', status: 'done', fileName: 'Archive.zip', fileMime: 'application/octet-stream', fileBytes: 45678, fileUrl: '/api/captures/file-1/file', capturedAt: now - 3, tags: [] },
  ];
  const { page } = await pageFor(t, { captures });
  await openLibrary(page);
  for (const type of ['video', 'audio', 'document', 'file']) assert.equal(await page.locator(`[data-type="${type}"]`).count(), 1);
  assert.match(await page.locator('#capture-grid').textContent(), /Quarterly Report\.pdf/);
  assert.match(await page.locator('#capture-grid').textContent(), /Voice memo\.m4a/);
  await page.locator('[data-type="document"]').click();
  await page.locator('.capture-open').click();
  await page.locator('#detail-actions').waitFor({ state: 'visible' });
  const detail = await page.locator('#detail-body').textContent();
  assert.match(detail, /12\.1 KB/);
  assert.match(detail, /com\.apple\.DocumentsApp/);
  assert.match(detail, /application\/pdf/);
  const fileLink = page.locator('#detail-body a[href="/api/captures/document-1/file"]');
  assert.equal(await fileLink.count(), 1);
  assert.equal(await fileLink.getAttribute('target'), '_blank');
});

test('bookmark details preserve a readable trail back to the original page', async t => {
  const { page } = await pageFor(t, { captures: [fixtureCaptures.find(capture => capture.id === 'bookmark')] });
  await openLibrary(page); await page.locator('.capture-open').click();
  await page.locator('#capture-origin').waitFor({ state: 'visible' });
  const origin = page.locator('#capture-origin');
  assert.equal(await origin.getAttribute('open'), null);
  assert.equal(await page.locator('#detail-body').evaluate(body => body.querySelector('.detail-section').compareDocumentPosition(body.querySelector('#capture-origin')) & Node.DOCUMENT_POSITION_FOLLOWING), 4);
  await origin.locator(':scope > summary').click();
  assert.match(await origin.textContent(), /Example Review/);
  assert.match(await origin.textContent(), /Mina Vale/);
  assert.match(await origin.textContent(), /Saved from popup/);
  assert.match(await origin.textContent(), /atlas-readable\/1/);
  assert.match(await origin.textContent(), /QJ7wKGnJ/);
  assert.deepEqual(await origin.locator('a').evaluateAll(links => links.map(link => link.href)), [
    'https://example.com/field-guide?from=atlas',
    'https://example.com/field-guide',
    'https://example.com/favicon.ico',
  ]);
});

test('customer controls every extension feature and refreshes the connected browser', async t => {
  const { page, model, requests } = await pageFor(t, { captures: [], extensionAccount: account });
  await openLibrary(page); await page.locator('#open-account').click();
  await page.locator('#preference-form[data-ready="true"]').waitFor();
  await page.locator('[data-preference="capture.region"]').uncheck();
  await page.locator('[data-preference="capture.note"]').uncheck();
  await page.getByText('Sync & automatic context', { exact: true }).click();
  await page.locator('[data-preference="sync.automatic"]').uncheck();
  await page.locator('[data-preference="organization.ocr"]').uncheck();
  await page.getByText('Popup layout', { exact: true }).click();
  await page.locator('[data-preference="popup.recentCount"]').selectOption('5');
  await page.locator('[data-order-action="fullPage"] [data-order-direction="up"]').click();
  await page.locator('#save-preferences').click();
  await page.waitForFunction(() => document.querySelector('#preference-message').textContent.includes('Saved'));
  const write = requests.find(request => request.path === '/api/preferences' && request.method === 'PUT');
  assert.equal(write.body.capture.region, false);
  assert.equal(write.body.capture.note, false);
  assert.equal(write.body.sync.automatic, false);
  assert.equal(write.body.organization.ocr, false);
  assert.equal(write.body.popup.recentCount, 5);
  assert.deepEqual(write.body.popup.actionOrder, ['bookmark', 'highlight', 'fullPage', 'region']);
  assert.deepEqual(model.preferences, write.body);
  const refresh = await page.evaluate(() => window.__extensionMessages.find(item => item.message.kind === 'atlas-refresh-preferences'));
  assert.equal(refresh.message.revision, 1);
  assert.equal(await page.locator('#new-note').isDisabled(), true);
  await page.setViewportSize({ width: 390, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('#account-dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true);
  if (process.env.ATLAS_SETTINGS_SCREENSHOT) await page.screenshot({ path: process.env.ATLAS_SETTINGS_SCREENSHOT, fullPage: false });
});

test('dashboard prefers the installed build already connected to the signed-in account', async t => {
  const oldId = 'mjfcgmboaijfcaanepdipbgmipnccnpn';
  const storeId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const { page } = await pageFor(t, {
    captures: [],
    extensionIds: [oldId, storeId],
    extensionAccountsById: {
      [oldId]: { id: 'different-account', email: 'other@example.test' },
      [storeId]: account,
    },
  });
  await openLibrary(page);
  await page.locator('#open-account').click();
  await page.locator('#preference-form[data-ready="true"]').waitFor();
  await page.locator('#save-preferences').click();
  await page.waitForFunction(() => document.querySelector('#preference-message').textContent.includes('Saved'));
  const refresh = await page.evaluate(() => window.__extensionMessages.find(item => item.message.kind === 'atlas-refresh-preferences'));
  assert.equal(refresh.id, storeId);
});

test('library notes preserve their origin and active processing choices', async t => {
  const { page, model, requests } = await pageFor(t, { captures: [] });
  model.preferences.organization = { ocr: false, summaries: true, tags: false };
  await openLibrary(page); await page.locator('#new-note').click(); await page.locator('#note-text').fill('A note with its capture context.');
  await page.locator('#save-note').click(); await page.locator('#note-dialog').waitFor({ state: 'hidden' });
  const write = requests.find(request => request.path === '/api/captures' && request.method === 'POST');
  assert.deepEqual(write.body.processingOptions, { ocr: false, summaries: true, tags: false });
  assert.equal(write.body.provenance.captureMethod, 'library-note');
  assert.equal(write.body.provenance.schemaVersion, 1);
  assert.equal(write.body.provenance.capturedAt, write.body.capturedAt);
  assert.equal(write.body.provenance.extractedAt, write.body.capturedAt);
  assert.equal(write.body.provenance.pageUrl, null);
  assert.deepEqual(write.body.provenance.authors, []);
  assert.deepEqual(write.body.provenance.headings, []);
});

test('dashboard does not claim an older extension preference revision was applied', async t => {
  const { page } = await pageFor(t, { captures: [], extensionAccount: account, extensionPreferenceRevision: 0 });
  await openLibrary(page); await page.locator('#open-account').click();
  await page.locator('#preference-form[data-ready="true"]').waitFor(); await page.locator('#save-preferences').click();
  await page.waitForFunction(() => document.querySelector('#preference-message').textContent.includes('next time'));
  assert.match(await page.locator('#preference-message').textContent(), /next time the extension refreshes/);
});

test('a failed note save retains its text and idempotency key for retry', async t => {
  let fail = true;
  const { page, requests } = await pageFor(t, { captures: [], handler: ({ url, request }) => {
    if (url.pathname === '/api/captures' && request.method() === 'POST' && fail) { fail = false; return { status: 503, body: { message: 'Temporary service failure. Try again.' } }; }
  } });
  await openLibrary(page); await page.locator('#new-note').click(); await page.locator('#note-text').fill('Keep this draft.'); await page.locator('#save-note').click();
  await page.locator('#note-error').waitFor({ state: 'visible' }); assert.equal(await page.locator('#note-text').inputValue(), 'Keep this draft.');
  await page.locator('#save-note').click(); await page.locator('#note-dialog').waitFor({ state: 'hidden' });
  const writes = requests.filter(request => request.path === '/api/captures' && request.method === 'POST'); assert.equal(writes.length, 2); assert.equal(writes[0].body.clientId, writes[1].body.clientId); assert.equal(typeof writes[1].body.capturedAt, 'number');
});

test('extension account switch requires confirmation before issuing or sending a pairing code', async t => {
  const { page, requests } = await pageFor(t, { captures: [], extensionAccount: { id: 'old-account', email: 'previous@example.test', name: 'Previous' } });
  await openLibrary(page); await page.locator('#open-setup').click(); await page.locator('#connect-extension').click(); await page.locator('#confirm-dialog').waitFor({ state: 'visible' });
  assert.match(await page.locator('#confirm-description').textContent(), /previous@example.test/);
  assert.equal(requests.filter(request => request.path === '/api/pairing').length, 0);
  await page.locator('#confirm-cancel').click(); assert.equal((await page.evaluate(() => window.__extensionMessages.filter(item => item.message.kind === 'atlas-connect'))).length, 0);
  await page.locator('#connect-extension').click(); await page.locator('#confirm-accept').click(); await page.waitForFunction(() => document.querySelector('#extension-status').textContent.includes('Your next capture'));
  const messages = await page.evaluate(() => window.__extensionMessages.filter(item => item.message.kind === 'atlas-connect')); assert.equal(messages.length, 1); assert.equal(messages[0].id, 'mjfcgmboaijfcaanepdipbgmipnccnpn'); assert.equal(messages[0].message.code, 'test-single-use-pairing-code');
  assert.equal(await page.evaluate(() => localStorage.length), 0);
});

test('manual installation and session expiry have usable recovery paths', async t => {
  let expired = false;
  const { page } = await pageFor(t, { captures: [], extensionInstalled: false, handler: ({ url }) => expired && url.pathname.startsWith('/api/') ? { status: 401, body: { message: 'Log in again.' } } : undefined });
  await openLibrary(page); await page.locator('#connect-extension').click(); await page.locator('#manual-install[open]').waitFor();
  assert.match(await page.locator('#manual-install').textContent(), /Developer mode/);
  expired = true; await page.locator('#refresh-library').click(); await page.locator('#session-dialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.capture-card').count(), 0); await page.keyboard.press('Escape'); assert.equal(await page.locator('#session-dialog').isVisible(), true);
  assert.equal(await page.locator('#session-dialog a').first().getAttribute('href'), '/auth.html?mode=login');
});

test('account settings confirm revoke/export/logout and require saving a rotated recovery code', async t => {
  const { page, model, requests } = await pageFor(t);
  model.connections = [{ id: 'browser-1', name: 'Office Chrome', createdAt: now, lastSeenAt: now }];
  await openLibrary(page); await page.locator('#open-account').click(); await page.getByRole('button', { name: 'Revoke Office Chrome' }).click();
  await page.locator('#confirm-cancel').click(); assert.equal(requests.some(request => request.path === '/api/connections/browser-1'), false);
  await page.getByRole('button', { name: 'Revoke Office Chrome' }).click(); await page.locator('#confirm-accept').click(); await page.locator('.device-empty').waitFor();
  await page.locator('#export-account').click(); const download = page.waitForEvent('download'); await page.locator('#confirm-accept').click(); assert.match((await download).suggestedFilename(), /^foundkeep-export-.*\.json$/);
  await page.locator('#current-password').fill('Current-password-123'); await page.locator('#new-password').fill('New-password-123456'); await page.locator('#change-password').click(); await page.locator('#confirm-accept').click();
  await page.locator('#password-recovery-dialog').waitFor({ state: 'visible' }); assert.equal(await page.locator('#finish-password-recovery').isDisabled(), true); await page.keyboard.press('Escape'); assert.equal(await page.locator('#password-recovery-dialog').isVisible(), true);
  await page.locator('#password-recovery-saved').check(); await page.locator('#finish-password-recovery').click(); assert.equal(await page.locator('#password-recovery-code').textContent(), '');
  await page.locator('#logout').click(); await page.locator('#confirm-cancel').click(); assert.equal(requests.some(request => request.path === '/api/auth/logout'), false);
});

test('library pagination retries without dropping loaded captures', async t => {
  let failed = false;
  const { page } = await pageFor(t, { handler: ({ url, request }) => {
    if (url.pathname !== '/api/captures' || request.method() !== 'GET') return;
    if (url.searchParams.get('cursor')) {
      if (!failed) { failed = true; return { status: 503, body: { message: 'Please retry.' } }; }
      return { body: { captures: fixtureCaptures.slice(3), nextCursor: null, total: 6 } };
    }
    return { body: { captures: fixtureCaptures.slice(0, 3), nextCursor: 'page-two', total: 6 } };
  } });
  await openLibrary(page); assert.equal(await page.locator('.capture-card').count(), 3);
  await page.locator('#load-more').click(); await page.locator('#page-message').waitFor({ state: 'visible' }); assert.equal(await page.locator('.capture-card').count(), 3);
  await page.locator('#load-more').click(); await page.locator('.capture-card').nth(5).waitFor(); assert.equal(await page.locator('#load-more').isVisible(), false);
});

test('customer screens fit phone and desktop; save visual review evidence', async t => {
  const { page, model } = await pageFor(t, {
    extensionAccount: account,
    storeUrl: 'https://chromewebstore.google.com/detail/foundkeep/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    handler: ({ url }) => url.pathname === '/api/auth/providers' ? { body: { providers: ['apple', 'google'] } } : undefined,
  });
  await mkdir('.impeccable/review', { recursive: true });
  for (const [surface, route] of [['auth', '/auth.html?mode=signup'], ['dashboard', '/dashboard.html'], ['support', '/support.html'], ['privacy', '/privacy.html'], ['terms', '/terms.html']]) {
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 }); await page.goto(base + route); await page.evaluate(() => document.fonts.ready);
      if (surface === 'auth') await page.getByRole('button', { name: 'Continue with Google' }).waitFor();
      if (surface === 'dashboard') { await page.locator('#capture-grid[aria-busy="false"]').waitFor({ state: 'attached' }); await page.evaluate(() => { for (const image of document.images) image.loading = 'eager'; }); await page.waitForFunction(() => [...document.images].every(image => image.complete)); }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${surface} overflows at ${width}`);
      if (width !== 320) await page.screenshot({ path: `.impeccable/review/customer-${surface}-${width === 1440 ? 'desktop' : 'mobile'}.png`, fullPage: ['auth','dashboard'].includes(surface) });
    }
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 }); await openLibrary(page);
    await page.locator('#open-account').click();
    await page.locator('#account-dialog').screenshot({ path: `.impeccable/review/customer-settings-${width === 1440 ? 'desktop' : 'mobile'}.png` });
    await page.locator('[data-close="account-dialog"]').click();
    await page.locator('.capture-card').filter({ hasText: 'A field guide' }).click();
    await page.locator('#detail-title').filter({ hasText: 'A field guide' }).waitFor();
    await page.locator('#detail-dialog').screenshot({ path: `.impeccable/review/customer-detail-${width === 1440 ? 'desktop' : 'mobile'}.png` });
    await page.locator('[data-close="detail-dialog"]').click();
  }
  await mkdir('deploy/dist/store-assets', { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await openLibrary(page); await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'deploy/dist/store-assets/customer-dashboard.png', fullPage: false });
  model.captures = []; model.connections = [];
  await openLibrary(page); await page.waitForFunction(() => document.querySelector('#extension-status').textContent.includes('Connected as'));
  await page.screenshot({ path: 'deploy/dist/store-assets/customer-browser-setup.png', fullPage: false });
});

test('social sign-in keeps proof locally and strips the callback before exchanging it', async t => {
  const flow = 'a'.repeat(32), code = 'b'.repeat(43);
  let received;
  const { page, context } = await pageFor(t, { handler: ({ url, body }) => {
    if (url.pathname === '/api/auth/providers') return { body: { providers: ['google'] } };
    if (url.pathname === '/api/auth/oauth/start') { received = body; return { body: { flow, authorizeUrl: `${base}/api/auth/oauth/authorize/${flow}` } }; }
    if (url.pathname === '/api/auth/oauth/exchange') return { body: { account } };
  } });
  await context.route(`**/api/auth/oauth/authorize/${flow}`, route => route.fulfill({ contentType: 'text/html', body: '<p>Provider fixture</p>' }));
  await page.goto(`${base}/auth.html?mode=login`); await page.getByRole('button', { name: 'Continue with Google' }).click();
  await page.waitForURL(`**/api/auth/oauth/authorize/${flow}`);
  const pending = await page.evaluate(flow => JSON.parse(sessionStorage.getItem('foundkeep-oauth-' + flow)), flow);
  assert.match(pending.verifier, /^[A-Za-z0-9_-]{43}$/); assert.match(received.codeChallenge, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Object.hasOwn(received, 'verifier'), false);
  const exchanged = page.waitForRequest('**/api/auth/oauth/exchange');
  await page.goto(`${base}/auth.html?flow=${flow}&code=${code}`);
  assert.equal((await exchanged).postDataJSON().verifier, pending.verifier);
  await page.waitForURL('**/dashboard.html');
  assert.equal(await page.evaluate(flow => sessionStorage.getItem('foundkeep-oauth-' + flow), flow), null);
});

test('social callback without local proof cannot silently sign into another collection', async t => {
  const { page, requests } = await pageFor(t);
  await page.goto(`${base}/auth.html?flow=${'a'.repeat(32)}&code=${'b'.repeat(43)}`);
  await page.locator('#oauth-message').waitFor({ state: 'visible' });
  assert.match(await page.locator('#oauth-message').textContent(), /canceled or expired/);
  assert.equal(new URL(page.url()).searchParams.has('code'), false);
  assert.equal(requests.some(r => r.path === '/api/auth/oauth/exchange'), false);
});

test('a social-only dashboard offers reauthentication instead of an unusable password', async t => {
  const { page, model } = await pageFor(t, { handler: ({ url }) => url.pathname === '/api/auth/providers' ? { body: { providers: ['apple'] } } : undefined });
  model.account = { ...account, hasPassword: false };
  await openLibrary(page); await page.locator('#open-account').click();
  assert.equal(await page.locator('#password-settings').isVisible(), false);
  await page.locator('#open-delete-account').click();
  assert.equal(await page.locator('#delete-password').isVisible(), false);
  await page.getByRole('button', { name: 'Verify with Apple' }).waitFor({ state: 'visible' });
});

test('social methods lead sign-in and email is a deliberate secondary choice', async t => {
  const { page } = await pageFor(t, { handler: ({ url }) => url.pathname === '/api/auth/providers' ? { body: { providers: ['apple', 'google'] } } : undefined });
  await page.goto(`${base}/auth.html`);
  await page.getByRole('button', { name: 'Continue with Google' }).waitFor();
  assert.equal(await page.locator('#email').isVisible(), false);
  assert.equal(await page.locator('#oauth-buttons button').first().textContent(), 'Continue with Google');
  await page.locator('#email-signin summary').click();
  assert.equal(await page.locator('#email').isVisible(), true);
  await page.locator('[data-mode="recover"]').click();
  assert.equal(await page.locator('#recovery-code').isVisible(), true);
  assert.equal(await page.locator('#oauth-buttons').isVisible(), false);
  await page.goBack();
  await page.getByRole('button', { name: 'Continue with Google' }).waitFor();
});

test('provider discovery failure leaves working email sign-in', async t => {
  const { page } = await pageFor(t, { handler: ({ url }) => url.pathname === '/api/auth/providers' ? { status: 503, body: { message: 'Unavailable' } } : undefined });
  await page.goto(`${base}/auth.html?mode=login`);
  await page.locator('#email').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#oauth-loading').count(), 1);
  assert.equal(await page.locator('#oauth-loading').isVisible(), false);
  assert.equal(await page.locator('#auth-submit').isEnabled(), true);
});

test('a failed provider start stays visible with email collapsed and can be retried', async t => {
  const { page } = await pageFor(t, { handler: ({ url }) => {
    if (url.pathname === '/api/auth/providers') return { body: { providers: ['google'] } };
    if (url.pathname === '/api/auth/oauth/start') return { status: 503, body: { message: 'Google sign-in is temporarily unavailable. Try again.' } };
  } });
  await page.goto(`${base}/auth.html`);
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await page.locator('#auth-error').waitFor({ state: 'visible' });
  assert.match(await page.locator('#auth-error').textContent(), /temporarily unavailable/);
  assert.equal(await page.locator('#email').isVisible(), false);
  assert.equal(await page.getByRole('button', { name: 'Continue with Google' }).isEnabled(), true);
});

test('apps and devices promotes the missing app and reflects connection changes', async t => {
  const { page, model } = await pageFor(t, { extensionAccount: account });
  await openLibrary(page);
  await page.locator('#device-promotion').waitFor({ state: 'visible' });
  assert.match(await page.locator('#device-promotion-copy').textContent(), /iPhone/);
  await page.locator('#show-devices').click();
  assert.match(await page.locator('#iphone-status').textContent(), /No iPhone/);
  assert.equal(await page.locator('#install-iphone').getAttribute('href'), '/support.html#iphone-beta');
  assert.match(await page.locator('#browser-connection-badge').textContent(), /Connected here/);
  model.connections.push({ id: 'phone', clientKind: 'mobile', name: 'My device', createdAt: now });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => document.querySelector('#iphone-status').textContent.startsWith('iPhone app connected'));
  assert.equal(await page.locator('#install-iphone').isVisible(), true);
  assert.equal(await page.locator('#install-iphone').textContent(), 'Install on another iPhone');
  await page.locator('#hide-setup').click();
  assert.equal(await page.locator('#device-promotion').isVisible(), false);
  model.connections = [];
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('#device-promotion').waitFor({ state: 'visible' });
  await page.locator('#dismiss-device-promotion').click();
  await page.locator('#refresh-library').click();
  assert.equal(await page.locator('#device-promotion').isVisible(), false);
});

test('iPhone onboarding leads with Share and does not ask for Chrome pairing', async t => {
  const { page, model } = await pageFor(t, { captures: [], width: 390, extensionInstalled: false, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' });
  model.connections = [{ id: 'legacy', name: 'FoundKeep for iPhone', createdAt: now }];
  await openLibrary(page);
  assert.equal(await page.locator('.device-options > :first-child').getAttribute('class'), 'device-option iphone-option');
  assert.match(await page.locator('#iphone-status').textContent(), /No iPhone connection confirmed/);
  assert.equal(await page.locator('#connect-extension').isVisible(), false);
  assert.match(await page.locator('#extension-status').textContent(), /for your computer/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
});

test('phone-only account suggests browser on desktop and can revisit setup', async t => {
  const { page, model } = await pageFor(t, { extensionInstalled: false });
  model.connections = [{ id: 'phone', clientKind: 'mobile', name: 'iPhone', createdAt: now }];
  await openLibrary(page);
  assert.match(await page.locator('#device-promotion-copy').textContent(), /computer/);
  await page.locator('#open-setup').click();
  assert.match(await page.locator('#iphone-status').textContent(), /^iPhone app connected/);
  assert.equal(await page.locator('#open-iphone').getAttribute('href'), '/open?path=collection');
  assert.equal(await page.locator('#install-extension').isVisible(), true);
});
