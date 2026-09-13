import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, copyFile, symlink, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
test('standalone route generation follows Expo CLI dependencies without transitive hoisting', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'foundkeep-routes-isolated-'));
  try {
    const scripts = path.join(root, 'scripts');
    const expo = path.join(root, 'node_modules/expo');
    const cli = path.join(expo, 'node_modules/@expo/cli');
    const nested = path.join(cli, 'node_modules/@expo');
    await Promise.all([mkdir(scripts, {recursive:true}), mkdir(nested, {recursive:true}), mkdir(path.join(root, 'src/app/capture'), {recursive:true})]);
    const expoPackage = require.resolve('expo/package.json');
    const expoRequire = createRequire(expoPackage);
    const cliPackage = expoRequire.resolve('@expo/cli/package.json');
    const cliRequire = createRequire(cliPackage);
    await copyFile(expoPackage, path.join(expo, 'package.json'));
    await copyFile(cliPackage, path.join(cli, 'package.json'));
    // Real installed SDK code; only its package layout is isolated, with no install.
    await symlink(path.dirname(require.resolve('expo-router/package.json')), path.join(root, 'node_modules/expo-router'), 'dir');
    await symlink(path.dirname(cliRequire.resolve('@expo/router-server/package.json')), path.join(nested, 'router-server'), 'dir');
    const helper = path.join(scripts, 'generate-routes.mjs');
    await copyFile(new URL('./generate-routes.mjs', import.meta.url), helper);
    await writeFile(path.join(root, 'src/app/index.tsx'), 'throw new Error("Routes must not execute during generation");');
    await writeFile(path.join(root, 'src/app/capture/[id].tsx'), 'throw new Error("Routes must not execute during generation");');
    const rootRequire = createRequire(helper);
    assert.throws(() => rootRequire.resolve('@expo/router-server/build/typed-routes/generate'), {code:'MODULE_NOT_FOUND'});
    assert.throws(() => rootRequire.resolve('@expo/cli/package.json'), {code:'MODULE_NOT_FOUND'});
    execFileSync(process.execPath, [helper], {cwd:root, stdio:['ignore','pipe','pipe']});
    const declarations = await readFile(path.join(root, '.expo/types/router.d.ts'), 'utf8');
    assert.match(declarations, /export namespace ExpoRouter/);
    assert.ok(declarations.includes('`/capture/[id]`'));
    assert.match(declarations, /id: string \| number/);
  } finally { await rm(root, {recursive:true, force:true}); }
});
