import { capturePreviewSource } from './collection/preview.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { configureEnvironment, resolveEnvironment } from './environment.ts';
import { parseOAuthReturn, validAuthorizeUrl } from './auth-oauth.ts';
import { parseFoundkeepLink } from './linking/deepLinks.ts';
import { createFoundkeepClient } from './api/client.ts';
const flow='a'.repeat(32),code='b'.repeat(43);
test('dev runtime strictly isolates API, OAuth and navigation origins and schemes',async()=>{
 configureEnvironment(resolveEnvironment('dev'),'android');
 try {
  assert.ok(validAuthorizeUrl(`https://dev.foundkeep.app/api/auth/oauth/authorize/${flow}`,flow));
  assert.equal(validAuthorizeUrl(`https://foundkeep.app/api/auth/oauth/authorize/${flow}`,flow),false);
  assert.ok(parseOAuthReturn(`foundkeep://oauth/complete?flow=${flow}&code=${code}`));
  assert.equal(parseOAuthReturn(`foundkeep-dev://oauth/complete?flow=${flow}&code=${code}`),null);
  assert.ok(parseFoundkeepLink('foundkeep://collection'));assert.equal(parseFoundkeepLink('foundkeep-dev://collection'),null);
  assert.ok(parseFoundkeepLink('https://dev.foundkeep.app/open?path=collection'));assert.equal(parseFoundkeepLink('https://foundkeep.app/open?path=collection'),null);
  const preview=capturePreviewSource({id:'test',previewUrl:'https://foundkeep.app/old'},'dev-token','account');assert.ok(preview?.uri.startsWith('https://dev.foundkeep.app/'));
  const calls:{url:string;body:any}[]=[];
  const client=createFoundkeepClient({getToken:async()=>null,fetcher:async(url,init)=>{calls.push({url:String(url),body:init?.body?JSON.parse(String(init.body)):null});return new Response('{}');}});
  await client.oauthProviders();await client.startOAuth({provider:'google',intent:'sign-in',codeChallenge:'proof'});
  assert.equal(calls[0]?.url,'https://dev.foundkeep.app/api/auth/providers?client=android');assert.equal(calls[1]?.body.client,'android');
 } finally {configureEnvironment(resolveEnvironment('prod'),'ios');}
});
test('unknown or inconsistent runtime environment fails closed',()=>{
 assert.throws(()=>resolveEnvironment('staging'));assert.throws(()=>resolveEnvironment(''));assert.throws(()=>configureEnvironment({...resolveEnvironment('dev'),origin:'https://evil.example'},'android'));
 assert.equal(resolveEnvironment(undefined).origin,'https://foundkeep.app');
});
