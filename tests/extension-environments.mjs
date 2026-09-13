import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
export function extensionId(key) {
  return [...createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32)]
    .map(char => String.fromCharCode(97 + parseInt(char, 16))).join('');
}

test('dev and prod packages have stable separate identities and fixed destinations', async t => {
  const output = await mkdtemp(path.join(tmpdir(), 'foundkeep-builds-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const sourceManifest = await readFile('apps/extension/manifest.json', 'utf8');
  const sourceProduct = await readFile('apps/extension/src/product.js', 'utf8');
  const identities = [];
  for (const environment of ['dev', 'prod']) {
    const directory = path.join(output, environment);
    await exec('node', ['deploy/build-extension.mjs', '--environment', environment, '--output', directory]);
    const build = path.join(directory, `foundkeep-extension-${environment}`);
    const manifest = JSON.parse(await readFile(path.join(build, 'manifest.json'), 'utf8'));
    const product = await import(pathToFileURL(path.join(build, 'src/product.js')).href);
    const origin = environment === 'dev' ? 'https://dev.foundkeep.app' : 'https://foundkeep.app';
    assert.equal(product.CUSTOMER_ORIGIN, origin);
    assert.equal(product.LOCAL_DATABASE_NAME, environment === 'dev' ? 'atlas-dev' : 'atlas');
    assert.deepEqual(manifest.host_permissions, [origin + '/*']);
    assert.deepEqual(manifest.externally_connectable.matches,
      environment === 'dev' ? [origin + '/*'] : [origin + '/*', 'https://atlas.notpritam.in/*']);
    const id = extensionId(manifest.key);
    identities.push(id);
    const config = JSON.parse(await readFile(path.join(directory, 'customer-config.json'), 'utf8'));
    assert.ok(config.extensionIds.includes(id));
    assert.equal(config.extensionEnvironment, environment);
    if (environment === 'dev') {
      assert.deepEqual(config.extensionIds, [id]);
      assert.equal(manifest.name, 'Foundkeep Dev — Save what matters');
      assert.equal(manifest.update_url, undefined, 'Dev must never follow the production update feed');
    } else {
      assert.equal(id, 'mjfcgmboaijfcaanepdipbgmipnccnpn', 'Keep existing production browser data');
      assert.equal(manifest.update_url, JSON.parse(sourceManifest).update_url);
    }
    const archive = path.join(directory, `foundkeep-extension-${environment}.zip`);
    const hash = () => readFile(archive).then(bytes => createHash('sha256').update(bytes).digest('hex'));
    const before = await hash();
    await exec('node', ['deploy/build-extension.mjs', '--environment', environment, '--output', directory]);
    assert.equal(await hash(), before, 'Rebuilding must preserve identity and deterministic packaging');
    const { stdout } = await exec('unzip', ['-Z1', archive]);
    assert.ok(stdout.includes('src/background.js'));
    assert.doesNotMatch(stdout, /\.(?:pem|key)$|node_modules|\.env/m);
  }
  assert.notEqual(identities[0], identities[1]);
  assert.equal(await readFile('apps/extension/manifest.json', 'utf8'), sourceManifest);
  assert.equal(await readFile('apps/extension/src/product.js', 'utf8'), sourceProduct);
  await assert.rejects(exec('node', ['deploy/build-extension.mjs', '--environment', 'staging', '--output', output]));
});

test('a dev backend authorizes only its configured extension and rejects production pairing', async () => {
  const { stdout } = await exec('bun', ['-e', `
    import {createApp} from './apps/backend/src/app.ts';
    import {openDb} from './apps/backend/src/db.ts';
    const db=openDb(':memory:');const app=createApp(db);
    const responses=[];
    for(const id of ['fngoidplpdpoamenhgpabbheghpkdkcb','mjfcgmboaijfcaanepdipbgmipnccnpn','cficnecbdbiddngllpfbacabgbcjinmk']) {
      const r=await app.request('/api/pairing/claim',{method:'POST',headers:{Origin:'chrome-extension://'+id,'Content-Type':'application/json'},body:'{}'});
      responses.push({id,status:r.status,origin:r.headers.get('Access-Control-Allow-Origin')});
    }
    console.log(JSON.stringify(responses));db.close();
  `], { env: { ...process.env, ATLAS_CUSTOMER_ORIGINS: 'https://dev.foundkeep.app', ATLAS_CUSTOMER_EXTENSION_IDS: 'fngoidplpdpoamenhgpabbheghpkdkcb' } });
  const [dev, ...prod] = JSON.parse(stdout);
  assert.notEqual(dev.status, 403);
  assert.equal(dev.origin, 'chrome-extension://fngoidplpdpoamenhgpabbheghpkdkcb');
  for (const result of prod) { assert.equal(result.status, 403); assert.equal(result.origin, null); }
});

test('dev dashboard never falls back to detecting or installing production extensions', async () => {
  const { stdout } = await exec('bun', ['-e', `
    globalThis.window={location:{hostname:'dev.foundkeep.app'}};
    globalThis.fetch=async()=>{throw new Error('offline')};
    const {customerConfig}=await import('./apps/site/lib/platforms.ts');
    console.log(JSON.stringify(await customerConfig()));
  `]);
  const config = JSON.parse(stdout);
  assert.equal(config.extensionEnvironment, 'dev');
  assert.deepEqual(config.extensionIds, []);
});
