import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {Database} from 'bun:sqlite';
import type {Hono} from 'hono';
import type {CustomerEnv} from './customer.ts';
import {moduleFail,type CustomerServices} from './customer-modules.ts';
import {organizationName} from './customer-organization.ts';
import {config} from './config.ts';
export const AGENT_SCOPES=['library:read','files:read','library:write'] as const;
export type AgentScope=typeof AGENT_SCOPES[number];
export type AgentAccess={id:string;accountId:string;scopes:AgentScope[]};
const hash=(token:string)=>createHash('sha256').update(token).digest('hex');
export function agentAccess(db:Database,header:string|undefined,scope:AgentScope='library:read'):AgentAccess{
 const token=/^Bearer (fk_mcp_[A-Za-z0-9_-]{43})$/.exec(header||'')?.[1];
 if(!token)moduleFail(401,'agent_unauthorized','A Foundkeep agent token is required.');
 const row=db.query('SELECT id,account_id,scopes_json FROM customer_agent_tokens WHERE token_hash=? AND expires_at>?').get(hash(token),Date.now()) as {id:string;account_id:string;scopes_json:string}|null;
 if(!row)moduleFail(401,'agent_unauthorized','This agent connection expired or was revoked.');
 const scopes=JSON.parse(row.scopes_json) as AgentScope[];
 if(!scopes.includes(scope))moduleFail(403,'agent_scope','This agent connection does not have the required permission.');
 db.query('UPDATE customer_agent_tokens SET last_seen_at=? WHERE id=?').run(Date.now(),row.id);
 return {id:row.id,accountId:row.account_id,scopes};
}
export function createAgentToken(db:Database,owner:string,body:Record<string,unknown>,customerOrigin=config.customerOrigin){
 const name=organizationName(body.name,60,'An agent name');
 if(!Array.isArray(body.scopes)||!body.scopes.includes('library:read')||body.scopes.some(value=>!AGENT_SCOPES.includes(value as AgentScope)))moduleFail(400,'invalid_scope','Choose library read access and any optional permissions.');
 const scopes=[...new Set(body.scopes as string[])];
 const days=body.days??90;if(!Number.isInteger(days)||Number(days)<1||Number(days)>365)moduleFail(400,'invalid_expiry','Choose an expiry between 1 and 365 days.');
 return db.transaction(()=>{
  db.query('DELETE FROM customer_agent_tokens WHERE account_id=? AND expires_at<=?').run(owner,Date.now());
  const count=db.query('SELECT COUNT(*) n FROM customer_agent_tokens WHERE account_id=?').get(owner) as {n:number};
  if(count.n>=10)moduleFail(409,'agent_limit','Revoke an unused agent before connecting another.');
  const token='fk_mcp_'+randomBytes(32).toString('base64url'),id=randomUUID(),expiresAt=Date.now()+Number(days)*86_400_000;
  db.query('INSERT INTO customer_agent_tokens(id,account_id,name,token_hash,scopes_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').run(id,owner,name,hash(token),JSON.stringify(scopes),Date.now(),expiresAt);
  return {id,name,token,expiresAt,endpoint:customerOrigin+'/api/mcp'};
 }).immediate();
}
export function registerAgentAccess(app:Hono<CustomerEnv>,db:Database,services:CustomerServices){
 app.get('/agents',c=>{const owner=services.auth(c).account.id;return c.json({agents:db.query('SELECT id,name,scopes_json,created_at AS createdAt,expires_at AS expiresAt,last_seen_at AS lastSeenAt FROM customer_agent_tokens WHERE account_id=? AND expires_at>? ORDER BY created_at DESC').all(owner,Date.now()).map((raw:any)=>{const {scopes_json,...row}=raw;return {...row,scopes:JSON.parse(scopes_json)};}),nudges:db.query('SELECT id,text,status,created_at AS createdAt FROM customer_agent_nudges WHERE account_id=? ORDER BY created_at DESC LIMIT 20').all(owner)});});
 app.post('/agents',async c=>{services.auth(c,true);const body=await services.jsonBody(c);const owner=services.auth(c,true).account.id;services.rate('agent-token:'+owner,10,60_000);return c.json(createAgentToken(db,owner,body),201);});
 app.delete('/agents/:id',c=>{const owner=services.auth(c,true).account.id;db.query('DELETE FROM customer_agent_tokens WHERE id=? AND account_id=?').run(c.req.param('id'),owner);return c.json({ok:true});});
 app.post('/agents/nudges',async c=>{
  services.auth(c);const body=await services.jsonBody(c);const owner=services.auth(c).account.id;const text=organizationName(body.text,1000,'An instruction');
  services.rate('agent-nudge:'+owner,10,60_000);
  const count=db.query("SELECT COUNT(*) n FROM customer_agent_nudges WHERE account_id=? AND status='pending'").get(owner) as {n:number};if(count.n>=20)moduleFail(409,'nudge_limit','Wait for your agent to finish earlier instructions.');
  const id=randomUUID();db.query('INSERT INTO customer_agent_nudges(id,account_id,text,created_at) VALUES(?,?,?,?)').run(id,owner,text,Date.now());
  db.query("DELETE FROM customer_agent_nudges WHERE account_id=? AND status='done' AND id NOT IN (SELECT id FROM customer_agent_nudges WHERE account_id=? ORDER BY created_at DESC LIMIT 100)").run(owner,owner);
  return c.json({id,status:'pending'},201);
 });
}
