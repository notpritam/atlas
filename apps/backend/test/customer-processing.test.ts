import {afterEach,beforeEach,expect,test} from 'bun:test';
import {openDb} from '../src/db.ts';
import {writeSubscription} from '../src/customer-plans.ts';
import {createProcessingService,CONSENT_VERSION} from '../src/customer-processing.ts';
import type {AiInput} from '../src/customer-ai.ts';
import {extractSource} from '../src/customer-source.ts';
let db:ReturnType<typeof openDb>;let owner:string;let capture:string;
const result={summary:'A useful article.',category:'Reading',tags:['research'],relatedIds:[]};
function service(organize:()=>Promise<typeof result>=async()=>result){return createProcessingService(db,{ai:{available:true,model:'test-model',organize},now:()=>Date.now()});}
beforeEach(()=>{
 db=openDb(':memory:');owner=crypto.randomUUID();capture=crypto.randomUUID();
 db.query("INSERT INTO customer_accounts(id,email,name,password_hash,recovery_hash,created_at) VALUES(?,?,'Test','','',0)").run(owner,owner+'@example.com');
 db.query("INSERT INTO customer_captures(id,account_id,client_id,type,status,note_text,manual_tags,storage_bytes,captured_at,created_at,updated_at) VALUES(?,?,?,'note','done','My article','[\"keep-me\"]',100,1,1,1)").run(capture,owner,capture);
 writeSubscription(db,owner,'revenuecat',{status:'active',expiresAt:Date.now()+3600_000,renews:true,sandbox:false});
});
afterEach(()=>db.close());
function enable(s:ReturnType<typeof service>){s.configure(owner,{enabled:true,fetchLinks:false,images:false,consentVersion:CONSENT_VERSION});}
test('processing requires Pro and explicit consent; enqueue reserves once and successful work preserves originals',async()=>{
 const s=service();expect(()=>s.enqueue(owner,capture,'manual')).toThrow('Enable');enable(s);
 const first=s.enqueue(owner,capture,'manual');expect(s.enqueue(owner,capture,'manual').id).toBe(first.id);
 expect(s.settings(owner).usage).toMatchObject({reserved:1,used:0});await s.tick();
 expect(s.settings(owner).usage).toMatchObject({reserved:0,used:1});
 expect(db.query('SELECT note_text,manual_tags,summary FROM customer_captures WHERE id=?').get(capture)).toMatchObject({note_text:'My article',manual_tags:'["keep-me"]',summary:result.summary});
 expect(s.details(owner,capture)).toMatchObject({model:'test-model',sourceHash:expect.any(String)});
 writeSubscription(db,owner,'revenuecat',{status:'inactive',expiresAt:0,renews:false,sandbox:false});
 expect(()=>s.enqueue(owner,capture,'manual')).toThrow('Pro');
});
test('revoked consent while provider awaits cancels without applying results or charging a credit',async()=>{
 let started!:()=>void;let finish!:(value:typeof result)=>void;const entered=new Promise<void>(r=>started=r);
 const s=service(()=>{started();return new Promise(r=>finish=r);});enable(s);s.enqueue(owner,capture,'manual');
 const running=s.tick();await entered;s.configure(owner,{enabled:false});finish(result);await running;
 expect(db.query('SELECT summary FROM customer_captures WHERE id=?').get(capture)).toEqual({summary:null});
 expect(s.settings(owner).usage).toMatchObject({reserved:0,used:0});
});
test('an edit during processing cannot be overwritten; deletion releases reserved credits',async()=>{
 let started!:()=>void;let finish!:(value:typeof result)=>void;const entered=new Promise<void>(r=>started=r);
 const s=service(()=>{started();return new Promise(r=>finish=r);});enable(s);s.enqueue(owner,capture,'manual');
 const running=s.tick();await entered;db.query("UPDATE customer_captures SET note_text='Edited by owner' WHERE id=?").run(capture);finish(result);await running;
 expect(db.query('SELECT summary FROM customer_captures WHERE id=?').get(capture)).toEqual({summary:null});
 expect(s.settings(owner).usage.reserved).toBe(0);s.enqueue(owner,capture,'manual');
 db.query('DELETE FROM customer_captures WHERE id=?').run(capture);expect(s.settings(owner).usage.reserved).toBe(0);
});
test('monthly quota and ownership are enforced before a job is created',()=>{
 const s=service();enable(s);const cycle=new Date().toISOString().slice(0,7);
 db.query('INSERT INTO customer_processing_usage(account_id,cycle,used,reserved) VALUES(?,?,500,0)').run(owner,cycle);
 expect(()=>s.enqueue(owner,capture,'manual')).toThrow('monthly');
 expect(()=>s.enqueue(owner,crypto.randomUUID(),'manual')).toThrow('not found');
 expect((db.query('SELECT COUNT(*) n FROM customer_processing_jobs').get() as any).n).toBe(0);
});
test('crashed leases recover and attempts are bounded without consuming successful-work credits',async()=>{
 const s=service(async()=>{throw new Error('provider private failure');});enable(s);const job=s.enqueue(owner,capture,'manual');
 for(let i=0;i<3;i++){await s.tick();db.query('UPDATE customer_processing_jobs SET updated_at=0,lease_until=0 WHERE id=?').run(job.id);}
 expect(db.query('SELECT status,attempts,error FROM customer_processing_jobs WHERE id=?').get(job.id)).toMatchObject({status:'failed',attempts:3,error:'Processing could not finish. Your original is safe.'});
 expect(s.settings(owner).usage).toMatchObject({used:0,reserved:0});
});
test('withdrawing image or source sharing cancels a queued or running job',async()=>{
 const s=service();enable(s);s.configure(owner,{fetchLinks:true,images:true});s.enqueue(owner,capture,'manual');
 s.configure(owner,{images:false});await s.tick();
 expect(db.query('SELECT status FROM customer_processing_jobs').get()).toEqual({status:'cancelled'});
 expect(s.settings(owner).usage).toMatchObject({reserved:0,used:0});
});
test('managed processing waits for the basic worker to finish its retries',()=>{
 const s=service();enable(s);db.query("UPDATE customer_captures SET status='failed',enrich_attempts=1 WHERE id=?").run(capture);
 expect(()=>s.enqueue(owner,capture,'manual')).toThrow('still being saved');
 db.query('UPDATE customer_captures SET enrich_attempts=3 WHERE id=?').run(capture);
 expect(s.enqueue(owner,capture,'manual').status).toBe('pending');
});

test('automatic processing rotates through accounts beyond one bounded scan',async()=>{
 const s=service();enable(s);
 for(let i=0;i<101;i++){const account='a'+String(i).padStart(4,'0');db.query("INSERT INTO customer_accounts(id,email,name,password_hash,recovery_hash,created_at) VALUES(?,?,'Empty','','',0)").run(account,account+'@example.test');s.configure(account,{enabled:true,consentVersion:CONSENT_VERSION});}
 db.query('UPDATE customer_captures SET created_at=? WHERE id=?').run(Date.now()+1,capture);
 await s.tick();await s.tick();
 expect(s.details(owner,capture)).not.toBeNull();
});

test('scheduled processing waits for its boundary and changing the interval never runs early',async()=>{
 let clock=Date.now();writeSubscription(db,owner,'revenuecat',{status:'active',expiresAt:clock+48*3600_000,renews:true,sandbox:false});const s=createProcessingService(db,{ai:{available:true,model:'test',organize:async()=>result},now:()=>clock});
 s.configure(owner,{enabled:true,consentVersion:CONSENT_VERSION,mode:'scheduled',intervalHours:1});
 db.query('UPDATE customer_captures SET created_at=? WHERE id=?').run(clock,capture);
 expect(s.settings(owner).nextRunAt).toBe(clock+3600_000);await s.tick();expect(s.details(owner,capture)).toBeNull();
 clock+=1800_000;s.configure(owner,{intervalHours:6});const boundary=clock+6*3600_000;
 clock=boundary-1;await s.tick();expect(s.details(owner,capture)).toBeNull();clock=boundary;await s.tick();expect(s.details(owner,capture)).not.toBeNull();
 expect(s.settings(owner).nextRunAt).toBe(boundary+6*3600_000);
});
test('manual mode only runs explicitly requested saves and a custom cap bounds reservations',async()=>{
 const s=service();s.configure(owner,{enabled:true,consentVersion:CONSENT_VERSION,mode:'manual',monthlyLimit:1});db.query('UPDATE customer_captures SET created_at=? WHERE id=?').run(Date.now()+1,capture);
 await s.tick();expect(s.settings(owner).usage.reserved).toBe(0);expect(s.details(owner,capture)).toBeNull();
 s.enqueue(owner,capture,'manual');await s.tick();expect(s.settings(owner).usage).toMatchObject({used:1,reserved:0,monthlyLimit:1});
 db.query("UPDATE customer_captures SET note_text='A new version' WHERE id=?").run(capture);expect(()=>s.enqueue(owner,capture,'manual')).toThrow('monthly');
});
test('pause during provider work releases reservations and resume applies exactly one result',async()=>{
 let started!:()=>void,finish!:(value:typeof result)=>void,calls=0;const entered=new Promise<void>(r=>started=r);
 const s=service(()=>{calls++;if(calls===1){started();return new Promise(r=>finish=r);}return Promise.resolve(result);});enable(s);s.enqueue(owner,capture,'manual');const running=s.tick();await entered;
 s.configure(owner,{mode:'paused'});expect(s.settings(owner).usage).toMatchObject({reserved:0,used:0});expect(()=>s.enqueue(owner,capture,'manual')).toThrow('paused');finish(result);await running;
 expect(s.details(owner,capture)).toBeNull();s.configure(owner,{mode:'manual'});await s.tick();await s.tick();expect(s.settings(owner).usage).toMatchObject({reserved:0,used:1});expect(calls).toBe(2);
});
test('lowering the cap during a provider call prevents charging beyond the new cap',async()=>{
 let started!:()=>void,finish!:(value:typeof result)=>void;const entered=new Promise<void>(r=>started=r);const s=service(()=>{started();return new Promise(r=>finish=r);});enable(s);s.enqueue(owner,capture,'manual');const running=s.tick();await entered;s.configure(owner,{monthlyLimit:0});finish(result);await running;
 expect(s.details(owner,capture)).toBeNull();expect(s.settings(owner).usage).toMatchObject({reserved:0,used:0});expect(()=>s.enqueue(owner,capture,'manual')).toThrow('monthly');
});
test('invalid modes, intervals and caps are rejected and two workers cannot double-claim',async()=>{
 const s=service();enable(s);for(const value of [{mode:'fast'},{intervalHours:2},{monthlyLimit:501},{monthlyLimit:-1},{monthlyLimit:1.1}])expect(()=>s.configure(owner,value)).toThrow();
 let started!:()=>void,finish!:(value:typeof result)=>void;const entered=new Promise<void>(r=>started=r);let calls=0;const first=service(()=>{calls++;started();return new Promise(r=>finish=r);}),second=service(async()=>{calls++;return result;});first.enqueue(owner,capture,'manual');const running=first.tick();await entered;await second.tick();finish(result);await running;expect(calls).toBe(1);expect(first.settings(owner).usage.used).toBe(1);
});

test('unreadable public links do not use a credit or ask the model to invent contents',async()=>{
 let calls=0;const s=createProcessingService(db,{ai:{available:true,model:'test',organize:async()=>{calls++;return result;}},source:async url=>({url,requestedUrl:url,fetchedAt:Date.now(),contentHash:'test',text:'',title:null,description:null,imageUrl:null,author:null,publishedAt:null,siteName:null,extractionStatus:'unavailable'})});enable(s);s.configure(owner,{fetchLinks:true});db.query("UPDATE customer_captures SET note_text=NULL,source_url='https://example.com/private' WHERE id=?").run(capture);s.enqueue(owner,capture,'manual');await s.tick();expect(calls).toBe(0);expect(s.settings(owner).usage).toMatchObject({used:0,reserved:0});
});

test.each([true,false])('a titled link without captured evidence never charges when fetchLinks=%s',async fetchLinks=>{
 let calls=0;const s=createProcessingService(db,{ai:{available:true,model:'test',organize:async()=>{calls++;return result;}},source:async()=>{throw new Error('HTTP 403');}});
 enable(s);s.configure(owner,{fetchLinks});db.query("UPDATE customer_captures SET note_text=NULL,source_title='A private article',source_url='https://example.com/private' WHERE id=?").run(capture);
 const job=s.enqueue(owner,capture,'manual');await s.tick();
 expect(calls).toBe(0);expect(s.details(owner,capture)).toBeNull();expect(s.settings(owner).usage).toMatchObject({used:0,reserved:0});
 expect(db.query('SELECT status FROM customer_processing_jobs WHERE id=?').get(job.id)).toEqual({status:'failed'});
 expect(db.query('SELECT source_title,note_text,summary FROM customer_captures WHERE id=?').get(capture)).toEqual({source_title:'A private article',note_text:null,summary:null});
});
test.each([true,false])('captured text remains usable with explicit unavailable source evidence when fetchLinks=%s',async fetchLinks=>{
 const inputs:AiInput[]=[];const s=createProcessingService(db,{ai:{available:true,model:'test',organize:async input=>{inputs.push(input);return result;}},source:async()=>{throw new Error('HTTP 403');}});
 enable(s);s.configure(owner,{fetchLinks});db.query("UPDATE customer_captures SET source_title='Private article',source_url='https://example.com/private' WHERE id=?").run(capture);
 s.enqueue(owner,capture,'manual');await s.tick();
 expect(inputs).toHaveLength(1);expect(inputs[0]).toMatchObject({text:'My article',sourceEvidence:{status:'unavailable',notice:expect.any(String)}});expect(s.settings(owner).usage).toMatchObject({used:1,reserved:0});
});
test('description previews carry evidence and title-only previews cannot charge',async()=>{
 const inputs:AiInput[]=[];let description='';const s=createProcessingService(db,{ai:{available:true,model:'test',organize:async input=>{inputs.push(input);return result;}},source:async url=>({...extractSource('<title>A lesson</title>'+description,url),requestedUrl:url,fetchedAt:Date.now(),contentHash:'test'})});
 enable(s);s.configure(owner,{fetchLinks:true});db.query("UPDATE customer_captures SET note_text=NULL,source_title='A lesson',source_url='https://youtube.com/watch?v=123' WHERE id=?").run(capture);
 s.enqueue(owner,capture,'manual');await s.tick();expect(inputs).toHaveLength(0);expect(s.settings(owner).usage).toMatchObject({used:0,reserved:0});
 description='<meta name="description" content="Three ways to organize a reading library">';s.enqueue(owner,capture,'manual');await s.tick();
 expect(inputs).toHaveLength(1);expect(inputs[0]).toMatchObject({text:'Three ways to organize a reading library',sourceEvidence:{status:'metadata-only',transcript:'unavailable'}});expect(s.settings(owner).usage.used).toBe(1);
});
test('unsupported blob formats cannot substitute for readable text or supported image evidence',async()=>{
 let calls=0;const s=createProcessingService(db,{ai:{available:true,model:'test',organize:async()=>{calls++;return result;}},media:async()=>({})});enable(s);s.configure(owner,{images:true});
 db.query("UPDATE customer_captures SET note_text=NULL,source_title='Saved file',blob_mime='application/octet-stream',blob_data=? WHERE id=?").run(new Uint8Array([1,2,3]),capture);s.enqueue(owner,capture,'manual');await s.tick();
 expect(calls).toBe(0);expect(s.settings(owner).usage).toMatchObject({used:0,reserved:0});
});
test('edited paused saves retire obsolete jobs so the twenty-first save resumes exactly once',async()=>{
 let calls=0;let clock=Date.now();const s=createProcessingService(db,{ai:{available:true,model:'test',organize:async()=>{calls++;return result;}},now:()=>clock});enable(s);s.configure(owner,{mode:'manual'});
 const ids=[capture];for(let i=1;i<21;i++){const id=crypto.randomUUID();ids.push(id);db.query("INSERT INTO customer_captures(id,account_id,client_id,type,status,note_text,storage_bytes,captured_at,created_at,updated_at) VALUES(?,?,?,'note','done','Saved note',10,1,1,1)").run(id,owner,id);}
 const originalJobs=ids.map(id=>{clock++;return s.enqueue(owner,id,'manual').id;});s.configure(owner,{mode:'paused'});
 for(const id of ids.slice(0,20))db.query("UPDATE customer_captures SET note_text='Edited while paused' WHERE id=?").run(id);
 s.configure(owner,{mode:'manual'});const other=service(async()=>{calls++;return result;});for(let i=0;i<23;i++)await Promise.all([s.tick(),other.tick()]);
 expect(s.details(owner,ids[20]!)).not.toBeNull();expect(calls).toBe(21);expect(s.settings(owner).usage).toMatchObject({used:21,reserved:0});
 expect(db.query("SELECT COUNT(*) n FROM customer_processing_jobs WHERE status='paused'").get()).toEqual({n:0});
 for(const id of originalJobs.slice(0,20))expect(db.query('SELECT status,credit FROM customer_processing_jobs WHERE id=?').get(id)).toEqual({status:'cancelled',credit:0});
 for(const id of ids){expect(s.enqueue(owner,id,'manual').status).toBe('done');expect(db.query("SELECT COUNT(*) n FROM customer_processing_jobs WHERE capture_id=? AND status='done'").get(id)).toEqual({n:1});}
 expect(s.settings(owner).usage).toMatchObject({used:21,reserved:0});
});
