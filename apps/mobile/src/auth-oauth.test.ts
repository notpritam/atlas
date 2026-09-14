import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOAuthReturn, validAuthorizeUrl, createPendingOAuth } from './auth-oauth.ts';
const flow='a'.repeat(32),code='b'.repeat(43);
test('only dedicated FoundKeep callback with bounded proof is accepted',()=>{
 assert.deepEqual(parseOAuthReturn(`foundkeep://oauth/complete?flow=${flow}&code=${code}`),{flow,code,error:false});
 for(const url of [`https://evil.example/?flow=${flow}&code=${code}`,`foundkeep://oauth/complete?flow=${flow}&code=${code}&access_token=secret`,`foundkeep://oauth/complete?flow=${flow}&code=${code}#secret`,`foundkeep://oauth/complete?flow=${flow}&flow=${flow}&code=${code}`,'foundkeep://oauth/complete?flow=bad&code=bad'])assert.equal(parseOAuthReturn(url),null);
});
test('authorization URLs cannot be supplied by another host or path',()=>{
 assert.equal(validAuthorizeUrl(`https://foundkeep.app/api/auth/oauth/authorize/${flow}`,flow),true);
 assert.equal(validAuthorizeUrl(`https://evil.example/api/auth/oauth/authorize/${flow}`,flow),false);
 assert.equal(validAuthorizeUrl(`https://foundkeep.app/api/auth/oauth/authorize/${flow}?redirect=evil`,flow),false);
});
test('pending proofs expire and cannot be used for a different or canceled flow',()=>{
 let now=0;const pending=createPendingOAuth(()=>now);
 pending.set({flow,verifier:'v'.repeat(64),intent:'sign-in',provider:'google'});
 assert.equal(pending.get(flow)?.verifier,'v'.repeat(64));assert.equal(pending.get('c'.repeat(32)),null);
 now=600001;assert.equal(pending.get(flow),null);
 pending.set({flow,verifier:'v'.repeat(64),intent:'delete',provider:'apple'});pending.clear();assert.equal(pending.get(flow),null);
});
test('callback ownership transfers without letting a departed screen clear or use the successor proof',()=>{
 const pending=createPendingOAuth(),old=Symbol('old'),next=Symbol('next');
 pending.set({flow,verifier:'v'.repeat(64),intent:'sign-in',provider:'google'},old);
 assert.ok(pending.get(flow,old));assert.ok(pending.claim(flow,next));
 pending.clear(old);assert.ok(pending.get(flow,next));assert.equal(pending.get(flow,old),null);
 pending.clear(next);assert.equal(pending.get(flow),null);
});
test('an announced provider return survives screen removal, while ordinary back cancels immediately',()=>{
 let now=0;const pending=createPendingOAuth(()=>now),old=Symbol('old'),next=Symbol('next');
 const value={flow,verifier:'v'.repeat(64),intent:'sign-in' as const,provider:'google' as const};
 pending.set(value,old);pending.release(old);assert.equal(pending.claim(flow,next),null);
 pending.set(value,old);pending.markReturn(flow);pending.release(old);assert.ok(pending.claim(flow,next));
 pending.release(old);assert.ok(pending.get(flow,next));
 pending.set(value,old);pending.markReturn(flow);pending.release(old);now=5001;assert.equal(pending.claim(flow,next),null);
});
test('duplicate returns cannot extend or revive an unowned transfer window',()=>{
 let now=0;const pending=createPendingOAuth(()=>now),old=Symbol('old'),next=Symbol('next');
 pending.set({flow,verifier:'v'.repeat(64),intent:'sign-in',provider:'google'},old);
 pending.markReturn(flow);pending.release(old);now=4000;pending.markReturn(flow);now=5001;
 assert.equal(pending.claim(flow,next),null);pending.markReturn(flow);assert.equal(pending.claim(flow,next),null);
});
