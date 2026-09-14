import {customerNativeUrl} from './customer-native.ts';
import type { Database } from 'bun:sqlite';
import type { Context, Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { randomBytes, createHash } from 'node:crypto';
import type { AccountRow, Auth, CustomerEnv } from './customer.ts';
import { challenge, isProvider, OAuthError, type OAuthGateway, type OAuthIdentity, type OAuthProvider } from './supabase-auth.ts';
type C = Context<CustomerEnv>;
type Deps = {
  origin:string; website(c:C):void; auth(c:C):Auth; account(id:string):AccountRow|null; emailAccount(email:string):AccountRow|null;
  accountDto(row:AccountRow):unknown; session(c:C,id:string):void; issueConnection(id:string,name:string,clientKind:"browser"|"mobile"):unknown;
  jsonBody(c:C,max?:number):Promise<Record<string,unknown>>; verifyPassword(password:string,stored:string):Promise<boolean>;
  publicRate(c:C,action:string,email?:string):void;
};
type Flow = {id:string;issuer:string;provider:OAuthProvider;client:'web'|'ios'|'android'|'agent';intent:'sign-in'|'delete';device_name:string;account_id:string|null;credential_id:string|null;credential_kind:'session'|'connection'|'agent'|null;client_challenge:string;server_verifier:string;browser_hash:string|null;stage:string;code_hash:string|null;identity_json:string|null;expires_at:number};
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
const validSecret=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9_-]{43}$/.test(x);
const validVerifier=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9._~-]{43,128}$/.test(x);
const validFlow=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{32}$/.test(x);
const invalid=()=>new OAuthError('oauth_expired','This sign-in expired or belongs to another device. Start again.',401);

export function registerCustomerOAuth(app:Hono<CustomerEnv>,db:Database,gateway:OAuthGateway,d:Deps){
  const secure=d.origin.startsWith('https://');
  const cookieName=(id:string)=>(secure?'__Host-':'')+'foundkeep_oauth_'+id;
  const cookieOptions={httpOnly:true,secure,sameSite:'Lax' as const,path:'/',maxAge:600};
  const available=(client:unknown)=>client==='ios'&&!gateway.providers.includes('apple')?[]:gateway.providers;
  const readFlow=(id:unknown):Flow=>{
    if(!validFlow(id))throw invalid();
    const flow=db.query('SELECT * FROM customer_oauth_flows WHERE id=? AND expires_at>?').get(id,Date.now())as Flow|null;
    if(!flow||flow.issuer!==gateway.issuer||!available(flow.client).includes(flow.provider))throw invalid();
    return flow;
  };
  // Only a previous provider verification of this exact email authorizes an
  // automatic link. A local password registration alone never proves email.
  const verifiedEmail=(accountId:string,email:string,issuer:string)=>!!db.query(
    'SELECT 1 FROM customer_auth_identities WHERE account_id=? AND issuer=? AND verified_email=? LIMIT 1'
  ).get(accountId,issuer,email);
  function browserBound(c:C,f:Flow){const cookie=getCookie(c,cookieName(f.id));if(!cookie||!f.browser_hash||digest(cookie)!==f.browser_hash)throw invalid();}
  function liveCredential(f:Flow){
    if(f.intent!=='delete')return;
    const table=f.credential_kind==='session'?'customer_sessions':f.credential_kind==='agent'?'customer_agent_tokens':'customer_connections';
    const credential=db.query(`SELECT id FROM ${table} WHERE id=? AND account_id=? AND expires_at>?`).get(f.credential_id,f.account_id,Date.now());
    if(!credential||!d.account(f.account_id!))throw invalid();
  }
  const destination=(f:Flow)=>f.client!=='web'?customerNativeUrl('oauth/complete',d.origin):d.origin+'/auth.html';
  function identityIsActive(issuer:string,subject:string){
    if(db.query('SELECT subject FROM customer_auth_cleanup WHERE issuer=? AND subject=?').get(issuer,subject)||
      db.query('SELECT subject FROM customer_auth_tombstones WHERE issuer=? AND subject=? AND expires_at>?').get(issuer,subject,Date.now())){
      throw new OAuthError('deletion_pending','This sign-in belongs to a deleted account. Start a new sign-in.',409);
    }
  }
  app.get('/auth/providers',c=>c.json({providers:available(c.req.query('client'))}));
  app.post('/auth/oauth/start',async c=>{
    d.publicRate(c,'oauth-start');const b=await d.jsonBody(c);
    if(!isProvider(b.provider)||!['web','ios','android','agent'].includes(String(b.client))||!validSecret(b.codeChallenge)||!['sign-in','delete'].includes(String(b.intent||'sign-in')))throw new OAuthError('invalid_oauth_request','Choose a supported sign-in method.');
    if(b.client==='web'){
      d.website(c);
      if(c.req.header('origin')!==d.origin)throw new OAuthError('canonical_origin_required','Open foundkeep.app to sign in.',400);
    }
    if(!available(b.client).includes(b.provider))throw new OAuthError('provider_unavailable','This sign-in method is not enabled yet.',503);
    const intent=b.intent==='delete'?'delete':'sign-in';const current=intent==='delete'?d.auth(c):null;
    if(b.client==='agent'||current?.kind==='agent'){
      if(b.client!=='agent'||intent!=='delete'||current?.kind!=='agent')throw invalid();
    }else if(current&&((b.client!=='web')!==(current.kind==='connection')))throw invalid();
    db.query('DELETE FROM customer_oauth_flows WHERE expires_at<=?').run(Date.now());
    db.query('DELETE FROM customer_auth_proofs WHERE expires_at<=?').run(Date.now());
    db.query('DELETE FROM customer_auth_tombstones WHERE expires_at<=?').run(Date.now());
    if((db.query('SELECT COUNT(*) n FROM customer_oauth_flows').get()as {n:number}).n>=1000)throw new OAuthError('oauth_busy','Sign-in is busy. Try again shortly.',503);
    const id=randomBytes(16).toString('hex');const cookie=b.client==='web'?secret():null;
    const deviceName=typeof b.deviceName==='string'?b.deviceName.trim().slice(0,72):b.client==='android'?'Android':'iPhone';
    db.query(`INSERT INTO customer_oauth_flows(id,issuer,provider,client,intent,device_name,account_id,credential_id,credential_kind,client_challenge,server_verifier,browser_hash,stage,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id,gateway.issuer,b.provider,String(b.client),intent,deviceName||'iPhone',current?.account.id||null,current?.credentialId||null,current?.kind||null,b.codeChallenge,secret(),cookie?digest(cookie):null,'created',Date.now()+600_000);
    if(cookie)setCookie(c,cookieName(id),cookie,cookieOptions);
    return c.json({flow:id,authorizeUrl:d.origin+'/api/auth/oauth/authorize/'+id});
  });
  app.get('/auth/oauth/authorize/:flow',async c=>{
    const f=readFlow(c.req.param('flow'));if(f.stage!=='created')throw invalid();
    liveCredential(f);
    let cookie:string|null=null;
    if(f.client==='web')browserBound(c,f);else cookie=secret();
    const changed=db.query("UPDATE customer_oauth_flows SET stage='authorized',browser_hash=? WHERE id=? AND stage='created'").run(cookie?digest(cookie):f.browser_hash,f.id);
    if(!changed.changes)throw invalid();
    if(cookie)setCookie(c,cookieName(f.id),cookie,cookieOptions);
    try{return c.redirect(await gateway.authorize(f.provider,d.origin+'/api/auth/oauth/callback/'+f.id,f.server_verifier),302);}
    catch{db.query('DELETE FROM customer_oauth_flows WHERE id=?').run(f.id);deleteCookie(c,cookieName(f.id),cookieOptions);return c.redirect(destination(f)+'?flow='+f.id+'&error=oauth_failed',302);}
  });
  app.get('/auth/oauth/callback/:flow',async c=>{
    const f=readFlow(c.req.param('flow'));browserBound(c,f);liveCredential(f);if(f.stage!=='authorized')throw invalid();
    const claimed=db.query("UPDATE customer_oauth_flows SET stage='exchanging',server_verifier='' WHERE id=? AND stage='authorized'").run(f.id);if(!claimed.changes)throw invalid();
    try{
      const code=c.req.query('code');if(!code||code.length>2048||c.req.query('error'))throw invalid();
      const identity=await gateway.identity(code,f.server_verifier,f.provider);liveCredential(f);
      identityIsActive(f.issuer,identity.subject);
      const handoff=secret();const changed=db.query("UPDATE customer_oauth_flows SET stage='complete',identity_json=?,code_hash=?,expires_at=? WHERE id=? AND stage='exchanging' AND expires_at>?").run(JSON.stringify(identity),digest(handoff),Date.now()+90_000,f.id,Date.now());if(!changed.changes)throw invalid();
      if(f.client==='agent'){
        deleteCookie(c,cookieName(f.id),cookieOptions);
        c.header('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
        return c.html('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FoundKeep identity check</title><h1>Identity confirmed</h1><p>Return to your agent to finish the account action you requested. You can close this tab.</p></html>');
      }
      return c.redirect(destination(f)+'?flow='+f.id+'&code='+handoff,302);
    }catch{
      db.query('DELETE FROM customer_oauth_flows WHERE id=?').run(f.id);deleteCookie(c,cookieName(f.id),cookieOptions);
      if(f.client==='agent'){
        c.header('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
        return c.html('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FoundKeep identity check</title><h1>Identity check could not finish</h1><p>Return to your agent and start the check again. Your account has not been deleted.</p></html>',400);
      }
      return c.redirect(destination(f)+'?flow='+f.id+'&error=oauth_failed',302);
    }
  });
  app.post('/auth/oauth/exchange',async c=>{
    d.publicRate(c,'oauth-exchange');const b=await d.jsonBody(c);const f=readFlow(b.flow);
    if(f.client==='web'){d.website(c);browserBound(c,f);}
    const handoffValid=f.client==='agent'||validSecret(b.code)&&digest(b.code)===f.code_hash;
    if(f.stage!=='complete'||!handoffValid||!validVerifier(b.verifier)||challenge(b.verifier)!==f.client_challenge||!f.identity_json)throw invalid();
    const identity=JSON.parse(f.identity_json)as OAuthIdentity;liveCredential(f);
    const mapped=db.query('SELECT account_id FROM customer_auth_identities WHERE issuer=? AND subject=?').get(f.issuer,identity.subject)as {account_id:string}|null;
    if(f.intent==='delete'){
      const current=d.auth(c);
      if(!mapped||mapped.account_id!==f.account_id||current.account.id!==f.account_id||current.credentialId!==f.credential_id||current.kind!==f.credential_kind)throw invalid();
      const proof=secret();db.transaction(()=>{
        consumeFlow(f);db.query('INSERT INTO customer_auth_proofs(token_hash,account_id,credential_id,credential_kind,expires_at) VALUES(?,?,?,?,?)').run(digest(proof),current.account.id,current.credentialId,current.kind,Date.now()+120_000);
      })();deleteCookie(c,cookieName(f.id),cookieOptions);return c.json({reauthToken:proof});
    }
    const collision=mapped?null:d.emailAccount(identity.email);
    let passwordProven=false;
    if(collision&&!verifiedEmail(collision.id,identity.email,f.issuer)){
      if(!collision.password_hash)throw new OAuthError('account_link_unverified','Sign in once with your original provider to verify this collection, then try this sign-in method again.',409);
      if(typeof b.password!=='string'||!b.password)throw new OAuthError('account_link_required','This email already has a Foundkeep collection. Enter its current password to connect this sign-in method.',409);
      d.publicRate(c,'oauth-link',identity.email);
      if(b.password.length>128||!(await d.verifyPassword(b.password,collision.password_hash)))throw new OAuthError('invalid_credentials','The existing Foundkeep password is incorrect.',401);
      passwordProven=true;
    }
    const result=db.transaction(()=>{
      const fresh=readFlow(f.id);if(fresh.stage!=='complete')throw invalid();
      identityIsActive(f.issuer,identity.subject);
      const linked=db.query('SELECT account_id FROM customer_auth_identities WHERE issuer=? AND subject=?').get(f.issuer,identity.subject)as {account_id:string}|null;
      let owner:AccountRow|null=linked?d.account(linked.account_id):null;
      if(!owner){
        const existing=d.emailAccount(identity.email);
        if(existing){
          // Recheck inside the write transaction after any password hashing.
          if(!verifiedEmail(existing.id,identity.email,f.issuer)&&
            (!passwordProven||!collision||existing.id!==collision.id||existing.password_hash!==collision.password_hash))throw invalid();
          owner=existing;
        }else{
          // A verified provider owns identity. Empty password hash explicitly
          // marks a social-only account; it is never a usable password.
          const id=crypto.randomUUID();db.query('INSERT INTO customer_accounts(id,email,name,password_hash,recovery_hash,created_at) VALUES(?,?,?,?,?,?)').run(id,identity.email,identity.name,'',digest(secret()),Date.now());owner=d.account(id)!;
        }
        db.query('INSERT INTO customer_auth_identities(issuer,subject,account_id,provider,created_at,verified_email) VALUES(?,?,?,?,?,?)').run(f.issuer,identity.subject,owner.id,f.provider,Date.now(),identity.email);
      }
      if(owner.email===identity.email)db.query('UPDATE customer_auth_identities SET verified_email=? WHERE issuer=? AND subject=? AND account_id=?').run(identity.email,f.issuer,identity.subject,owner.id);
      consumeFlow(f);
      if(f.client==='web'){d.session(c,owner.id);return {account:d.accountDto(owner)};}
      return {account:d.accountDto(owner),...d.issueConnection(owner.id,'Foundkeep for '+f.device_name,'mobile')as object};
    })();
    deleteCookie(c,cookieName(f.id),cookieOptions);return c.json(result);
  });
  function consumeFlow(f:Flow){const r=db.query("DELETE FROM customer_oauth_flows WHERE id=? AND stage='complete' AND expires_at>?").run(f.id,Date.now());if(!r.changes)throw invalid();}
}
export function consumeDeletionProof(db:Database,current:Auth,proof:string){
  if(!validSecret(proof))throw invalid();
  const r=db.query('DELETE FROM customer_auth_proofs WHERE token_hash=? AND account_id=? AND credential_id=? AND credential_kind=? AND expires_at>?').run(digest(proof),current.account.id,current.credentialId,current.kind,Date.now());
  if(!r.changes)throw invalid();
}
export function queueIdentityDeletion(db:Database,accountId:string){
  db.query('INSERT OR IGNORE INTO customer_auth_cleanup(issuer,subject,created_at) SELECT issuer,subject,? FROM customer_auth_identities WHERE account_id=?').run(Date.now(),accountId);
  // Keep a bounded deletion marker after remote cleanup finishes: a callback
  // already awaiting its provider response must not recreate the old account.
  db.query('INSERT OR REPLACE INTO customer_auth_tombstones(issuer,subject,expires_at) SELECT issuer,subject,? FROM customer_auth_identities WHERE account_id=?').run(Date.now()+86_400_000,accountId);
  db.query(`DELETE FROM customer_oauth_flows WHERE EXISTS (
    SELECT 1 FROM customer_auth_identities i WHERE i.account_id=?
    AND i.issuer=customer_oauth_flows.issuer AND i.subject=json_extract(customer_oauth_flows.identity_json,'$.subject')
  )`).run(accountId);
  db.query('DELETE FROM customer_oauth_flows WHERE account_id=?').run(accountId);
}
export async function processAuthCleanup(db:Database,gateway:OAuthGateway){
  db.query('DELETE FROM customer_oauth_flows WHERE expires_at<=?').run(Date.now());
  db.query('DELETE FROM customer_auth_proofs WHERE expires_at<=?').run(Date.now());
  db.query('DELETE FROM customer_auth_tombstones WHERE expires_at<=?').run(Date.now());
  if(!gateway.issuer)return;
  const rows=db.query('SELECT subject,attempts FROM customer_auth_cleanup WHERE issuer=? AND retry_at<=? ORDER BY created_at LIMIT 10').all(gateway.issuer,Date.now())as {subject:string;attempts:number}[];
  for(const row of rows){
    try{await gateway.deleteUser(row.subject);db.query('DELETE FROM customer_auth_cleanup WHERE issuer=? AND subject=?').run(gateway.issuer,row.subject);}
    catch{db.query('UPDATE customer_auth_cleanup SET attempts=attempts+1,retry_at=? WHERE issuer=? AND subject=?').run(Date.now()+Math.min(3_600_000,30_000*2**Math.min(row.attempts,7)),gateway.issuer,row.subject);}
  }
}
