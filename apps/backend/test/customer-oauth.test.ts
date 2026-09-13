import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import { randomBytes } from 'node:crypto';
import { openDb } from '../src/db.ts';
import { customerRoutes } from '../src/customer.ts';
import { challenge, type OAuthGateway, type OAuthIdentity } from '../src/supabase-auth.ts';
import { processAuthCleanup } from '../src/customer-oauth.ts';
const origin='https://foundkeep.app'; const password='correct horse battery staple';
let db:Database;let app:Hono;let identity:OAuthIdentity;let gateway:OAuthGateway;
beforeEach(()=>{
 db=openDb(':memory:');identity={subject:crypto.randomUUID(),email:'social@example.com',name:'Social User'};
 gateway={issuer:'https://personal.supabase.co',providers:['apple','google','github'],authorize:async(_p,callback)=>'https://accounts.google.com/auth?redirect='+encodeURIComponent(callback),identity:async()=>identity,deleteUser:async()=>{}};
 app=new Hono().route('/api',customerRoutes(db,gateway));
});
afterEach(()=>db.close());
async function req(path:string,body?:any,cookie?:string,bearer?:string,method=body?'POST':'GET') {
 const headers:Record<string,string>={origin}; if(body)headers['content-type']='application/json';if(cookie)headers.cookie=cookie;if(bearer)headers.authorization='Bearer '+bearer;
 return app.request(origin+'/api'+path,{method,headers,body:body?JSON.stringify(body):undefined});
}
async function begin(client='web',intent='sign-in',bearer?:string,cookie?:string,provider='google'){
 const verifier=randomBytes(32).toString('base64url');const start=await req('/auth/oauth/start',{provider,client,intent,codeChallenge:challenge(verifier)},cookie,bearer);expect(start.status).toBe(200);const data=await start.json()as any;const flowCookie=start.headers.get('set-cookie')?.split(';')[0];
 const browser=await req(new URL(data.authorizeUrl).pathname.slice(4),undefined,flowCookie);expect(browser.status).toBe(302);
 return {...data,verifier,cookie:flowCookie||browser.headers.get('set-cookie')?.split(';')[0]};
}
async function finish(flow:any){const r=await req('/auth/oauth/callback/'+flow.flow+'?code=valid-supabase-code',undefined,flow.cookie);expect(r.status).toBe(302);const url=new URL(r.headers.get('location')!);return {flow:flow.flow,code:url.searchParams.get('code'),verifier:flow.verifier};}
async function register(){const r=await req('/auth/register',{email:identity.email,name:'Existing',password});expect(r.status).toBe(201);return {cookie:r.headers.get('set-cookie')!.split(';')[0],...(await r.json()as any)};}
test('discovery exposes only names and disabled installations cannot start',async()=>{
 expect(await(await req('/auth/providers')).json()).toEqual({providers:['apple','google','github']});
 const disabled=new Hono().route('/api',customerRoutes(db,{...gateway,providers:[]}));const r=await disabled.request(origin+'/api/auth/providers');expect(await r.text()).toBe('{"providers":[]}');
 const start=await req('/auth/oauth/start',{provider:'evil',client:'web',codeChallenge:'x'.repeat(43)});expect(start.status).toBe(400);
});
test('web login needs browser binding and local proof; handoff is one use',async()=>{
 const flow=await begin();const missing=await req('/auth/oauth/callback/'+flow.flow+'?code=code');expect(missing.status).toBe(401);
 const body=await finish(flow);const wrong=await req('/auth/oauth/exchange',{...body,verifier:'x'.repeat(43)},flow.cookie);expect(wrong.status).toBe(401);
 const r=await req('/auth/oauth/exchange',body,flow.cookie);expect(r.status).toBe(200);expect(r.headers.get('set-cookie')).toContain('HttpOnly');const text=await r.text();expect(text).not.toContain('supabase');expect(text).not.toContain('token');const account=JSON.parse(text).account;expect(account.hasPassword).toBe(false);
 expect((await req('/auth/oauth/exchange',body,flow.cookie)).status).toBe(401);
});
test('native login issues only Foundkeep connection after proof',async()=>{
 const flow=await begin('ios');const body=await finish(flow);const r=await req('/auth/oauth/exchange',body);expect(r.status).toBe(200);const data=await r.json()as any;expect(data.token).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(data.connection.clientKind).toBe('mobile');expect((await req('/mobile/me',undefined,undefined,data.token)).status).toBe(200);
});
test('matching email requires existing password before identity can be connected',async()=>{
 const existing=await register();const flow=await begin();const body=await finish(flow);
 expect((await req('/auth/oauth/exchange',body,flow.cookie)).status).toBe(409);
 expect((db.query('SELECT COUNT(*) n FROM customer_auth_identities').get()as any).n).toBe(0);
 expect((await req('/auth/oauth/exchange',{...body,password:'wrong'},flow.cookie)).status).toBe(401);
 const r=await req('/auth/oauth/exchange',{...body,password},flow.cookie);expect(r.status).toBe(200);expect((await r.json()as any).account.id).toBe(existing.account.id);
});
test('expired and swapped handoffs cannot issue credentials',async()=>{
 const a=await begin();const b=await begin();const body=await finish(a);expect((await req('/auth/oauth/exchange',{...body,flow:b.flow},b.cookie)).status).toBe(401);
 db.query('UPDATE customer_oauth_flows SET expires_at=0 WHERE id=?').run(a.flow);expect((await req('/auth/oauth/exchange',body,a.cookie)).status).toBe(401);
});
test('social deletion needs a fresh proof bound to the same live device and cleans identity remotely',async()=>{
 const flow=await begin('ios');const data=await(await req('/auth/oauth/exchange',await finish(flow))).json()as any;
 expect((await req('/mobile/account',{password:'anything'},undefined,data.token,'DELETE')).status).toBe(401);
 const reauth=await begin('ios','delete',data.token);const proof=await(await req('/auth/oauth/exchange',await finish(reauth),undefined,data.token)).json()as any;expect(proof.reauthToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
 const r=await req('/mobile/account',{reauthToken:proof.reauthToken},undefined,data.token,'DELETE');expect(r.status).toBe(200);expect((db.query('SELECT COUNT(*) n FROM customer_accounts').get()as any).n).toBe(0);
 expect((db.query('SELECT COUNT(*) n FROM customer_auth_cleanup').get()as any).n).toBe(1);
 let deleted='';await processAuthCleanup(db,{...gateway,deleteUser:async id=>{deleted=id;}});expect(deleted).toBe(identity.subject);expect((db.query('SELECT COUNT(*) n FROM customer_auth_cleanup').get()as any).n).toBe(0);
});
test('revoking device during provider reauthentication blocks redemption',async()=>{
 const first=await begin('ios');const data=await(await req('/auth/oauth/exchange',await finish(first))).json()as any;
 const flow=await begin('ios','delete',data.token);const body=await finish(flow);await req('/mobile/logout',{},undefined,data.token);
 expect((await req('/auth/oauth/exchange',body,undefined,data.token)).status).toBe(401);
});
test('iOS social methods require Apple to be configured',async()=>{
 const target=new Hono().route('/api',customerRoutes(db,{...gateway,providers:['google']}));
 expect(await(await target.request(origin+'/api/auth/providers?client=ios')).json()).toEqual({providers:[]});
});
test('deletion invalidates completed sign-ins even after remote cleanup succeeds',async()=>{
 const first=await begin('ios');const data=await(await req('/auth/oauth/exchange',await finish(first))).json()as any;
 const stale=await begin('ios');const staleBody=await finish(stale);
 const proofFlow=await begin('ios','delete',data.token);const proof=await(await req('/auth/oauth/exchange',await finish(proofFlow),undefined,data.token)).json()as any;
 await req('/mobile/account',{reauthToken:proof.reauthToken},undefined,data.token,'DELETE');await processAuthCleanup(db,gateway);
 expect((await req('/auth/oauth/exchange',staleBody)).status).not.toBe(200);expect((db.query('SELECT COUNT(*) n FROM customer_accounts').get()as any).n).toBe(0);
});
test('a provider callback already in flight cannot recreate a deleted identity',async()=>{
 const first=await begin('ios');const data=await(await req('/auth/oauth/exchange',await finish(first))).json()as any;
 const proofFlow=await begin('ios','delete',data.token);const proof=await(await req('/auth/oauth/exchange',await finish(proofFlow),undefined,data.token)).json()as any;
 const stale=await begin('ios');let release!:(value:OAuthIdentity)=>void;
 gateway.identity=()=>new Promise(resolve=>{release=resolve;});
 const callback=req('/auth/oauth/callback/'+stale.flow+'?code=delayed',undefined,stale.cookie);
 await new Promise(resolve=>setTimeout(resolve,0));
 await req('/mobile/account',{reauthToken:proof.reauthToken},undefined,data.token,'DELETE');await processAuthCleanup(db,gateway);
 release(identity);const response=await callback;expect(response.headers.get('location')).toContain('error=oauth_failed');
 expect((db.query('SELECT COUNT(*) n FROM customer_accounts').get()as any).n).toBe(0);
});
test('native hex PKCE verifiers are supported without weakening challenge validation',async()=>{
 const verifier=randomBytes(32).toString('hex');const start=await req('/auth/oauth/start',{provider:'google',client:'ios',codeChallenge:challenge(verifier)});
 const flow=await start.json()as any;const browser=await req('/auth/oauth/authorize/'+flow.flow);flow.cookie=browser.headers.get('set-cookie')?.split(';')[0];flow.verifier=verifier;
 expect((await req('/auth/oauth/exchange',await finish(flow))).status).toBe(200);
});

async function social(provider='google',client='web') {
 const flow=await begin(client,'sign-in',undefined,undefined,provider);
 const response=await req('/auth/oauth/exchange',await finish(flow),flow.cookie);
 return {response,data:await response.json() as any,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
test('verified matching provider emails share one library across web and iOS without a password',async()=>{
 const first=await social();expect(first.response.status).toBe(200);
 const note=await req('/captures',{type:'note',clientId:crypto.randomUUID(),noteText:'Keep this in my one collection',capturedAt:Date.now()},first.cookie);expect(note.status).toBe(201);
 const original=identity.subject;identity={...identity,subject:crypto.randomUUID()};
 const second=await social('apple','ios');expect(second.response.status).toBe(200);expect(second.data.account.id).toBe(first.data.account.id);
 const library=await req('/mobile/captures',undefined,undefined,second.data.token);expect(library.status).toBe(200);expect(await library.text()).toContain('Keep this in my one collection');
 expect((db.query('SELECT COUNT(*) n FROM customer_accounts').get()as any).n).toBe(1);
 expect((db.query('SELECT COUNT(*) n FROM customer_auth_identities').get()as any).n).toBe(2);
 identity={...identity,subject:original};expect((await social()).data.account.id).toBe(first.data.account.id);
});
test('a password collection needs ownership proof only for its first verified provider',async()=>{
 const existing=await register();const flow=await begin();const body=await finish(flow);
 expect((await req('/auth/oauth/exchange',{...body,password},flow.cookie)).status).toBe(200);
 identity={...identity,subject:crypto.randomUUID()};const apple=await social('apple');expect(apple.response.status).toBe(200);expect(apple.data.account.id).toBe(existing.account.id);
});
test('different addresses including Apple private relay remain separate',async()=>{
 const first=await social();identity={...identity,subject:crypto.randomUUID(),email:'private@privaterelay.appleid.com'};
 const second=await social('apple');expect(second.response.status).toBe(200);expect(second.data.account.id).not.toBe(first.data.account.id);
});
test('an established subject never moves accounts when its email changes',async()=>{
 const first=await social();const original=identity.subject;
 identity={...identity,subject:crypto.randomUUID(),email:'other@example.com'};const second=await social('apple');
 identity={...identity,subject:original};expect((await social()).data.account.id).toBe(first.data.account.id);expect(second.data.account.id).not.toBe(first.data.account.id);
});
test('deleting a shared collection removes and tombstones every linked subject',async()=>{
 const first=await social('google','ios');const original=identity.subject;
 identity={...identity,subject:crypto.randomUUID()};const second=await social('apple','ios');expect(second.response.status).toBe(200);
 const pending=await begin();const pendingBody=await finish(pending);
 const flow=await begin('ios','delete',first.data.token);const proof=await(await req('/auth/oauth/exchange',await finish(flow),undefined,first.data.token)).json()as any;
 expect((await req('/mobile/account',{reauthToken:proof.reauthToken},undefined,first.data.token,'DELETE')).status).toBe(200);
 const deleted:string[]=[];await processAuthCleanup(db,{...gateway,deleteUser:async id=>{deleted.push(id);}});
 expect(deleted.sort()).toEqual([original,identity.subject].sort());
 expect((db.query('SELECT COUNT(*) n FROM customer_auth_identities').get()as any).n).toBe(0);
 expect((await req('/auth/oauth/exchange',pendingBody,pending.cookie)).status).not.toBe(200);
 expect((await req('/mobile/me',undefined,undefined,second.data.token)).status).toBe(401);
});

test('verified-email evidence must match the account email and issuer',async()=>{
 const existing=await register();
 db.query('INSERT INTO customer_auth_identities VALUES(?,?,?,?,?,?)').run('https://different.supabase.co',crypto.randomUUID(),existing.account.id,'google',Date.now(),identity.email);
 db.query('INSERT INTO customer_auth_identities VALUES(?,?,?,?,?,?)').run(gateway.issuer,crypto.randomUUID(),existing.account.id,'google',Date.now(),'different@example.com');
 const attempt=await social('apple');expect(attempt.response.status).toBe(409);expect(attempt.data.error).toBe('account_link_required');
});

test('concurrent provider handoffs converge on one account without duplicate data',async()=>{
 const first=await begin();const firstBody=await finish(first);
 identity={...identity,subject:crypto.randomUUID()};const second=await begin('web','sign-in',undefined,undefined,'apple');const secondBody=await finish(second);
 const responses=await Promise.all([req('/auth/oauth/exchange',firstBody,first.cookie),req('/auth/oauth/exchange',secondBody,second.cookie)]);
 expect(responses.map(r=>r.status)).toEqual([200,200]);const accounts=await Promise.all(responses.map(async r=>(await r.json()as any).account.id));expect(accounts[0]).toBe(accounts[1]);
 expect((db.query('SELECT COUNT(*) n FROM customer_accounts').get()as any).n).toBe(1);
});

test('migration retains old identity and account ownership, then permits another provider',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'foundkeep-link-migration-'));const file=join(dir,'test.db');
 try {
  let old=openDb(file,11);const id=crypto.randomUUID();const subject=crypto.randomUUID();
  old.query('INSERT INTO customer_accounts(id,email,name,password_hash,recovery_hash,created_at) VALUES(?,?,?,?,?,?)').run(id,identity.email,'Existing social user','','old-recovery',Date.now());
  old.query('INSERT INTO customer_auth_identities VALUES(?,?,?,?,?)').run(gateway.issuer,subject,id,'google',42);
  old.query('INSERT INTO customer_captures(id,account_id,client_id,type,note_text,storage_bytes,captured_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('old-capture',id,'old-client','note','Existing saved note',100,42,42,42);
  old.close();old=openDb(file);
  expect(old.query('SELECT * FROM customer_auth_identities').get()).toEqual({issuer:gateway.issuer,subject,account_id:id,provider:'google',created_at:42,verified_email:''});
  expect(old.query('PRAGMA foreign_key_check').all()).toEqual([]);
  expect(old.query('SELECT account_id,note_text FROM customer_captures WHERE id=?').get('old-capture')).toEqual({account_id:id,note_text:'Existing saved note'});
  old.query('INSERT INTO customer_auth_identities VALUES(?,?,?,?,?,?)').run(gateway.issuer,crypto.randomUUID(),id,'apple',43,identity.email);
  expect((old.query('SELECT COUNT(*) n FROM customer_accounts').get()as any).n).toBe(1);
  old.query('DELETE FROM customer_accounts WHERE id=?').run(id);expect(old.query('SELECT * FROM customer_auth_identities').all()).toEqual([]);old.close();
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('an old social identity must verify again before another subject can join it',async()=>{
 const first=await social();const original=identity.subject;
 db.query("UPDATE customer_auth_identities SET verified_email='' WHERE subject=?").run(original);
 identity={...identity,subject:crypto.randomUUID()};const other=identity.subject;
 const blocked=await social('apple');expect(blocked.response.status).toBe(409);expect(blocked.data.error).toBe('account_link_unverified');
 identity={...identity,subject:original};expect((await social()).data.account.id).toBe(first.data.account.id);
 identity={...identity,subject:other};expect((await social('apple')).data.account.id).toBe(first.data.account.id);
});

test('Android OAuth uses a native handoff, PKCE, and a mobile-scoped connection',async()=>{
 const flow=await begin('android');const callback=await req('/auth/oauth/callback/'+flow.flow+'?code=android-code',undefined,flow.cookie);expect(callback.status).toBe(302);const location=new URL(callback.headers.get('location')!);expect(location.protocol).toBe('foundkeep:');expect(location.hostname).toBe('oauth');
 const exchanged=await req('/auth/oauth/exchange',{flow:flow.flow,code:location.searchParams.get('code'),verifier:flow.verifier});expect(exchanged.status).toBe(200);const data=await exchanged.json() as any;expect(data.connection.clientKind).toBe('mobile');expect((await req('/mobile/me',undefined,undefined,data.token)).status).toBe(200);
 const target=new Hono().route('/api',customerRoutes(db,{...gateway,providers:['google']}));expect(await(await target.request(origin+'/api/auth/providers?client=android')).json()).toEqual({providers:['google']});
});
