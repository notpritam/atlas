// Real MV3 extensions, browser storage, and two disposable SQLite backends.
// Only the packaged network destinations are redirected to loopback fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

const exec = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(fn) {
  for (let i = 0; i < 100; i++) { if (await fn()) return; await delay(100); }
  throw new Error('Timed out waiting for extension state');
}

test('dev and prod install together, pair separately, and save into isolated databases', { timeout: 90000 }, async t => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'foundkeep-two-environments-'));
  const children = [];
  let context;
  t.after(async () => {
    await context?.close();
    await Promise.all(children.map(child => new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve); child.kill();
    })));
    await rm(temporary, { recursive: true, force: true });
  });
  const environments = [];
  for (const name of ['dev', 'prod']) {
    const output = path.join(temporary, name);
    await exec('node', ['deploy/build-extension.mjs', '--environment', name, '--output', output]);
    const directory = path.join(output, `foundkeep-extension-${name}`);
    const config = JSON.parse(await readFile(path.join(output, 'customer-config.json'), 'utf8'));
    const id = name === 'dev' ? config.extensionIds[0] : 'mjfcgmboaijfcaanepdipbgmipnccnpn';
    const child = spawn('bun', ['-e', `
      import {createApp} from './apps/backend/src/app.ts';
      import {openDb} from './apps/backend/src/db.ts';
      import {config} from './apps/backend/src/config.ts';
      const db=openDb();let app;
      const server=Bun.serve({port:0,hostname:'127.0.0.1',fetch:r=>app.fetch(r)});
      const origin='http://127.0.0.1:'+server.port;
      config.customerOrigins=[origin];config.customerOrigin=origin;
      app=createApp(db);console.log(origin);
      process.on('SIGTERM',()=>{server.stop(true);db.close();process.exit(0)});
    `], { env: { PATH: process.env.PATH, ATLAS_DATA_DIR: path.join(output, 'data'), ATLAS_CUSTOMER_EXTENSION_IDS: id }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    const origin = await new Promise((resolve, reject) => {
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; if (output.includes('\n')) resolve(output.trim()); });
      child.stderr.on('data', chunk => reject(new Error(String(chunk))));
      child.once('error', reject);
      child.once('exit', code => reject(new Error('Backend exited: ' + code)));
    });
    const manifestPath = path.join(directory, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.host_permissions = ['http://127.0.0.1/*'];
    manifest.externally_connectable = { matches: ['http://127.0.0.1/*'] };
    await writeFile(manifestPath, JSON.stringify(manifest));
    const productPath = path.join(directory, 'src/product.js');
    const product = await readFile(productPath, 'utf8');
    await writeFile(productPath, product.replaceAll(name === 'dev' ? 'https://dev.foundkeep.app' : 'https://foundkeep.app', origin));
    environments.push({ name, id, origin, directory });
  }
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    headless: true, channel: 'chromium', executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox', `--disable-extensions-except=${environments.map(env => env.directory).join(',')}`, `--load-extension=${environments.map(env => env.directory).join(',')}`],
  });
  await poll(() => context.serviceWorkers().length === 2);
  for (const environment of environments) {
    const { name, id, origin } = environment;
    const signup = await context.request.post(origin + '/api/auth/register', {
      headers: { Origin: origin }, data: { name: 'Environment tester', email: 'same-person@example.test', password: 'Environment-isolation-93829' },
    });
    assert.equal(signup.status(), 201, await signup.text());
    // Cookie host is the same for both loopback fixtures; retain each session
    // explicitly so the test also verifies separate account/token ownership.
    environment.cookie = signup.headers()['set-cookie'].split(';')[0];
    const request = async (route, method = 'GET', data) => {
      const result = await context.request.fetch(origin + '/api' + route, { method, headers: { Origin: origin, Cookie: environment.cookie }, data });
      assert.ok(result.ok(), await result.text()); return result.json();
    };
    environment.request = request;
    environment.account = (await request('/me')).account;
    environment.page = await context.newPage();
    await context.route(origin + '/__pair', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Pair extension</title>' }));
    await environment.page.goto(origin + '/__pair');
    const pairing = await request('/pairing', 'POST', {});
    const result = await environment.page.evaluate(({ id, code }) => new Promise(resolve => {
      chrome.runtime.sendMessage(id, { kind: 'atlas-connect', code }, value => resolve(value || { ok: false, error: chrome.runtime.lastError?.message }));
    }), { id, code: pairing.code });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.account.id, environment.account.id);
    const otherId = environments.find(other => other.name !== name).id;
    const wrongEnvironment = await environment.page.evaluate(id => new Promise(resolve => {
      chrome.runtime.sendMessage(id, { kind: 'atlas-ping' }, value => resolve(value || { ok: false, error: chrome.runtime.lastError?.message }));
    }), otherId);
    assert.equal(wrongEnvironment.ok, false, 'Cross-environment website cannot access extension account');
    const popup = await context.newPage();
    environment.popup = popup;
    await popup.goto(`chrome-extension://${id}/src/popup.html`);
    assert.equal(await popup.locator('[data-product-name]').textContent(), name === 'dev' ? 'FoundKeep Dev' : 'FoundKeep');
    const installed = await popup.evaluate(() => chrome.runtime.getManifest().version);
    assert.equal(await popup.locator('[data-build-info]').first().getAttribute('data-environment'), name);
    assert.equal(await popup.locator('[data-build-info] strong').first().textContent(), name === 'dev' ? 'DEV' : 'Production');
    assert.ok((await popup.locator('[data-build-info]').first().textContent()).includes(`v${installed}`));
    assert.equal(await popup.locator('.build-destination').first().textContent(), new URL(origin).host);
    const identity = await environment.page.evaluate(id => new Promise(resolve => chrome.runtime.sendMessage(id, { kind: 'atlas-ping' }, resolve)), id);
    assert.equal(identity.environment, name);
    assert.equal(identity.origin, origin);
    assert.equal(identity.version, installed);
    const save = await popup.evaluate(text => chrome.runtime.sendMessage({ kind: 'saveNote', text }), `${name} isolated note`);
    assert.equal(save.ok, true, JSON.stringify(save));
    await poll(async () => (await request('/captures')).captures.some(capture => capture.noteText === `${name} isolated note`));
    const sidebar = await context.newPage();
    await sidebar.goto(`chrome-extension://${id}/src/library.html`);
    assert.equal(await sidebar.locator('.brand').getAttribute('href'), null, 'The sidebar brand stays in place');
    assert.equal(await sidebar.locator('.library-foot a').first().getAttribute('href'), origin + '/dashboard');
    assert.equal(await sidebar.locator('[data-build-info]').first().getAttribute('data-environment'), name);
    assert.ok((await sidebar.locator('[data-build-info]').first().textContent()).includes(`v${installed}`));
    const localLibrary = await context.newPage();
    await localLibrary.goto(`chrome-extension://${id}/src/dashboard.html`);
    assert.equal(await localLibrary.locator('[data-build-info]').getAttribute('data-environment'), name);
    await localLibrary.close();
  }
  assert.notEqual(environments[0].account.id, environments[1].account.id);
  for (const environment of environments) {
    const cloud = (await environment.request('/captures')).captures;
    assert.deepEqual(cloud.map(capture => capture.noteText), [environment.name + ' isolated note']);
    const local = await environment.popup.evaluate(async () => (await import('./db.js')).listCaptures());
    assert.deepEqual(local.map(capture => capture.noteText), [environment.name + ' isolated note']);
    const credential = await environment.popup.evaluate(async () => (await chrome.storage.local.get('atlasCustomer')).atlasCustomer.token);
    const other = environments.find(other => other.name !== environment.name);
    const forbidden = await context.request.get(other.origin + '/api/captures', { headers: { Authorization: 'Bearer ' + credential, Cookie: '' } });
    assert.equal(forbidden.status(), 401, 'An extension token must not work in the other database');
  }
  // Offline dev saves remain in its own outbox while prod continues syncing.
  const [dev, prod] = environments;
  const worker = context.serviceWorkers().find(worker => worker.url().includes(dev.id));
  await worker.evaluate(() => { globalThis.fetch = async () => { throw new TypeError('Offline test'); }; });
  await dev.popup.evaluate(() => chrome.runtime.sendMessage({ kind: 'saveNote', text: 'dev offline note' }));
  const queued = await dev.popup.evaluate(async () => (await import('./db.js')).listCaptures());
  assert.ok(queued.some(capture => capture.noteText === 'dev offline note' && capture.cloudAccountId === dev.account.id));
  await prod.popup.evaluate(() => chrome.runtime.sendMessage({ kind: 'saveNote', text: 'prod still online' }));
  await poll(async () => (await prod.request('/captures')).captures.length === 2);
  assert.deepEqual((await dev.request('/captures')).captures.map(capture => capture.noteText), ['dev isolated note']);

  await context.route('https://x.com/__environment-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><article data-testid="tweet"><a href="/example/status/123"><time>Today</time></a><div data-testid="tweetText">Separate tweet capture</div><div role="group"><button data-testid="reply">Reply</button></div></article>' }));
  const tweet = await context.newPage();
  await tweet.goto('https://x.com/__environment-test');
  await tweet.getByRole('button', { name: 'Save to FoundKeep Dev', exact: true }).waitFor();
  await tweet.getByRole('button', { name: 'Save to FoundKeep', exact: true }).waitFor();
  assert.equal(await tweet.locator('[data-atlas], [data-foundkeep-dev]').count(), 2, 'Both extension buttons must coexist');
});
