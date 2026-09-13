import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,symlink,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateTarget} from '../scripts/seed-dev.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('demo seed rejects production and credential storage in the checkout, including symlinks',async t=>{
 assert.throws(()=>validateTarget('https://foundkeep.app','/tmp/demo'),/restricted/);
 assert.throws(()=>validateTarget('https://dev.foundkeep.app/path','/tmp/demo'),/exact origin/);
 for(const target of [root,path.join(root,'never-created/credentials')])assert.throws(()=>validateTarget('https://dev.foundkeep.app',target),/outside the repository/);
 for(const target of ['/',homedir()])assert.throws(()=>validateTarget('https://dev.foundkeep.app',target),/dedicated private directory/);
 const temp=await mkdtemp('/tmp/foundkeep-collections-guard-');t.after(()=>rm(temp,{recursive:true,force:true}));
 await symlink(root,path.join(temp,'checkout'));
 assert.throws(()=>validateTarget('https://dev.foundkeep.app',path.join(temp,'checkout','new-state')),/outside the repository/);
 assert.throws(()=>validateTarget('https://dev.foundkeep.app',temp+'/checkout/../'+path.basename(root)+'/new-state'),/outside the repository/);
 assert.throws(()=>validateTarget('http://127.0.0.1:8890',temp,true),/disposable loopback/);
 assert.throws(()=>validateTarget('http://127.0.0.1:18791',root,true),/disposable loopback/);
 assert.doesNotThrow(()=>validateTarget('http://127.0.0.1:18791',temp,true));
 assert.doesNotThrow(()=>validateTarget('https://dev.foundkeep.app',path.join(homedir(),'.local/share/foundkeep-dev-demo')));
});
