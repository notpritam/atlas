import {afterEach,beforeEach,expect,test} from 'bun:test';
import {createHash,randomBytes} from 'node:crypto';
import {openDb} from '../src/db.ts';
import {createApp} from '../src/app.ts';
let db:ReturnType<typeof openDb>;
beforeEach(()=>{db=openDb(':memory:');});afterEach(()=>db.close());
test('managed processing evidence is readable with owner mobile tokens and cookies on Free, but never by other owners or anonymous readers',async()=>{
 const tokens=['owner','other'].map(id=>{
  const token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex');
  db.query("INSERT INTO customer_accounts(id,email,name,password_hash,recovery_hash,created_at) VALUES(?,?,'Reader','','',0)").run(id,id+'@example.test');
  db.query("INSERT INTO customer_connections(id,account_id,name,token_hash,client_kind,created_at,expires_at) VALUES(?,?,'Mobile',?,'mobile',0,?)").run(id,id,hash,Date.now()+60000);
  db.query('INSERT INTO customer_sessions(id,account_id,token_hash,created_at,expires_at) VALUES(?,?,?,0,?)').run(id,id,hash,Date.now()+60000);
  return token;
 });
 db.query("INSERT INTO customer_captures(id,account_id,client_id,type,status,note_text,storage_bytes,captured_at,created_at,updated_at) VALUES('save','owner','save','note','done','Private',10,1,1,1)").run();
 db.query("INSERT INTO customer_processing_jobs(id,account_id,capture_id,source_hash,status,reason,cycle,created_at,updated_at,error) VALUES('job','owner','save','hash','failed','manual','2026-09',1,2,'Processing could not finish. Your original is safe.')").run();
 const app=createApp(db);const path='https://foundkeep.app/api/captures/save/processing';
 expect((await app.request(path)).status).toBe(401);
 expect((await app.request(path,{headers:{authorization:'Bearer '+tokens[1]}})).status).toBe(404);
 const response=await app.request(path,{headers:{authorization:'Bearer '+tokens[0]}});
 expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
 expect(await response.json()).toMatchObject({processing:null,job:{id:'job',status:'failed',updatedAt:2}});
 // This is the same endpoint consumed by the cookie-authenticated website.
 const cookie=await app.request(path,{headers:{cookie:'__Host-atlas_session='+tokens[0]+'; atlas_session='+tokens[0]}});
 expect(cookie.status).toBe(200);
});
