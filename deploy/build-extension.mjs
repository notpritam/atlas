#!/usr/bin/env node
// Build installable, isolated unpacked extensions without changing source identity.
import { readFile, writeFile, mkdir, copyFile, mkdtemp, rm, rename } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--environment', '--output'].includes(args[i]) || !args[i + 1] || options[args[i]])
    throw new Error('Usage: node deploy/build-extension.mjs --environment dev|prod [--output directory]');
  options[args[i]] = args[i + 1];
}
const environment = options['--environment'];
if (!['dev', 'prod'].includes(environment)) throw new Error('Choose an explicit extension environment: dev or prod.');
const output = path.resolve(options['--output'] || path.join(root, 'deploy/dist/extensions', environment));
const source = path.join(root, 'apps/extension');
if (output === source || output.startsWith(source + path.sep)) throw new Error('Build outside the extension source directory.');
const name = `foundkeep-extension-${environment}`;
const json = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const manifest = await json('apps/extension/manifest.json');
const customerConfig = await json('apps/web/customer-config.json');
customerConfig.extensionEnvironment = environment;
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(path.join(output, '.build-'));
const stage = path.join(temporary, name);
try {
  for (const file of await json('deploy/extension-files.json')) {
    await mkdir(path.dirname(path.join(stage, file)), { recursive: true });
    await copyFile(path.join(source, file), path.join(stage, file));
  }
  if (environment === 'dev') {
    const identity = await json('deploy/extension-dev-identity.json');
    const id = [...createHash('sha256').update(Buffer.from(identity.key, 'base64')).digest('hex').slice(0, 32)]
      .map(char => String.fromCharCode(97 + parseInt(char, 16))).join('');
    if (id !== identity.id) throw new Error('Dev extension identity does not match its public key.');
    manifest.name = 'Foundkeep Dev — Save what matters';
    manifest.description = 'Development build. Save pages, screenshots, highlights and notes to your separate Foundkeep dev library.';
    manifest.action.default_title = 'Foundkeep Dev';
    manifest.key = identity.key;
    manifest.host_permissions = ['https://dev.foundkeep.app/*'];
    manifest.externally_connectable = { matches: ['https://dev.foundkeep.app/*'] };
    delete manifest.update_url;
    for (const command of Object.values(manifest.commands)) command.description = command.description.replaceAll('Foundkeep', 'Foundkeep Dev');
    await writeFile(path.join(stage, 'src/product.js'), [
      'export const PRODUCT_NAME = "Foundkeep Dev";',
      'export const EXTENSION_ENVIRONMENT = "dev";',
      'export const LOCAL_DATABASE_NAME = "atlas-dev";',
      'export const CUSTOMER_ORIGIN = "https://dev.foundkeep.app";',
      'export const CUSTOMER_ORIGINS = Object.freeze([CUSTOMER_ORIGIN]);',
      '',
    ].join('\n'));
    const readme = await readFile(path.join(stage, 'README.md'), 'utf8');
    await writeFile(path.join(stage, 'README.md'), '# Foundkeep Dev\n\nThis build syncs only to https://dev.foundkeep.app. Install it alongside production; it has its own browser storage and login. Keep this installation when updating to retain local saves.\n\n' + readme.replaceAll('https://foundkeep.app', 'https://dev.foundkeep.app'));
    customerConfig.extensionIds = [identity.id];
  }
  await writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const archive = path.join(temporary, name + '.zip');
  execFileSync('python3', ['-c', `import os,sys,zipfile
source,archive=sys.argv[1:]
with zipfile.ZipFile(archive,'w') as z:
 for folder,dirs,files in os.walk(source):
  dirs.sort()
  for filename in sorted(files):
   full=os.path.join(folder,filename)
   info=zipfile.ZipInfo(os.path.relpath(full,os.path.dirname(source)),date_time=(2026,1,1,0,0,0))
   info.compress_type=zipfile.ZIP_DEFLATED
   info.external_attr=0o100644 << 16
   with open(full,'rb') as f:z.writestr(info,f.read(),compresslevel=9)
`, stage, archive]);
  await rm(path.join(output, name), { recursive: true, force: true });
  await rename(stage, path.join(output, name));
  await rename(archive, path.join(output, name + '.zip'));
  await writeFile(path.join(output, 'customer-config.json'), JSON.stringify(customerConfig, null, 2) + '\n');
  console.log(`${environment}: ${path.join(output, name + '.zip')}`);
} finally { await rm(temporary, { recursive: true, force: true }); }
