import {afterEach,beforeEach,expect,test} from 'bun:test';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDb} from '../src/db.ts';
import {createApp} from '../src/app.ts';
import {config} from '../src/config.ts';
import {writeSubscription} from '../src/customer-plans.ts';
import {createProcessingService,CONSENT_VERSION} from '../src/customer-processing.ts';
import type {RemoteMediaResult} from '../src/customer-remote-media.ts';
import type {AiInput} from '../src/customer-ai.ts';
let db:ReturnType<typeof openDb>,root:string,previousRoot:string;
const owner='remote-owner',capture='remote-capture',url='https://example.com/movie.mp4';
const data=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom000000000000saved-video')]);
const digest=createHash('sha256').update(data).digest('base64url');
const organized={summary:'A description of the scene.',category:'Films',tags:['nature'],relatedIds:[]};
let inputs:AiInput[],disposed:string[];
beforeEach(()=>{
 db=openDb(':memory:');root=mkdtempSync(join(tmpdir(),'remote-processing-'));previousRoot=config.dataDir;config.dataDir=root;inputs=[];disposed=[];
 for(const id of [owner,'other']){
  db.query("INSERT INTO customer_accounts(id,email,name,password_hash,recovery_hash,created_at) VALUES(?,?,'Test','','',0)").run(id,id+'@example.test');
  db.query('INSERT INTO customer_sessions(id,account_id,token_hash,created_at,expires_at) VALUES(?,?,?,?,?)').run(id,id,createHash('sha256').update((id+'-token').padEnd(43,'x')).digest('hex'),0,Date.now()+3600_000);
  db.query("INSERT INTO customer_connections(id,account_id,name,token_hash,created_at,last_seen_at,expires_at) VALUES(?,?,'Test',?,0,0,?)").run(id,id,createHash('sha256').update((id+'-bearer').padEnd(43,'x')).digest('hex'),Date.now()+3600_000);
 }
 writeSubscription(db,owner,'revenuecat',{status:'active',expiresAt:Date.now()+3600_000,renews:true,sandbox:false});
 db.query("INSERT INTO customer_captures(id,account_id,client_id,type,status,source_url,summary,category,tags,storage_bytes,captured_at,created_at,updated_at) VALUES(?,?,?,'bookmark','done',?,'Keep summary','Personal','[\"mine\"]',100,1,1,1)").run(capture,owner,capture,url);
});
afterEach(()=>{db.close();config.dataDir=previousRoot;rmSync(root,{recursive:true,force:true});});
async function downloaded(extra:Partial<Extract<RemoteMediaResult,{status:'downloaded'}>>={}):Promise<RemoteMediaResult>{
 const path=join(root,crypto.randomUUID()+'.mp4');writeFileSync(path,data);
 return {status:'downloaded',absolutePath:path,sourceUrl:url,mime:'video/mp4',bytes:data.length,sha256:digest,durationSeconds:2,title:'Movie',description:'',author:'',subtitles:[],...extra,dispose:async()=>{disposed.push(path);rmSync(path,{force:true});}};
}
function service(overrides:Record<string,unknown>={}){
 const s=createProcessingService(db,{root,ai:{available:true,model:'test-ai',organize:async input=>{inputs.push(input);return organized;}},source:async()=>{throw new Error('no public HTML');},remote:async()=>downloaded(),media:async()=>({}),...overrides});
 s.configure(owner,{enabled:true,fetchLinks:true,images:false,mode:'manual',consentVersion:CONSENT_VERSION});return s;
}
function saved(){return db.query('SELECT * FROM customer_captures WHERE id=?').get(capture) as any;}
function files(){const base=join(root,'customer-files');return existsSync(base)?readdirSync(base,{recursive:true,withFileTypes:true}).filter(f=>f.isFile()):[];}
async function fileResponse(kind:'cookie'|'mobile',account=owner,range?:string){
 const headers:Record<string,string>=kind==='cookie'?{cookie:'__Host-atlas_session='+(account+'-token').padEnd(43,'x')}:{authorization:'Bearer '+(account+'-bearer').padEnd(43,'x')};
 if(range)headers.range=range;
 return createApp(db).request('https://foundkeep.app/api/'+(kind==='mobile'?'mobile/':'')+'captures/'+capture+'/file',{headers});
}
test('remote bytes survive temporary disposal, retain organization, count real storage and deduplicate the attached source',async()=>{
 const s=service();const job=s.enqueue(owner,capture,'manual');await s.tick();
 expect(saved()).toMatchObject({file_mime:'video/mp4',file_bytes:data.length,summary:'Keep summary',category:'Personal',tags:'["mine"]',source_url:url});
 expect(saved().file_path).toStartWith('customer-files/remote/');expect(readFileSync(join(root,saved().file_path))).toEqual(data);expect(disposed).toHaveLength(1);expect(existsSync(disposed[0]!)).toBe(false);expect(files()).toHaveLength(1);expect(inputs).toHaveLength(0);
 const details=s.details(owner,capture)!;expect(details.model).toBe('media-preservation');expect(details.result.download).toMatchObject({status:'downloaded',sourceUrl:url,bytes:data.length,mime:'video/mp4',sha256:digest,durationSeconds:2,transcriptStatus:'unavailable'});
 const generated=(db.query('SELECT storage_bytes FROM customer_processing_results').get() as any).storage_bytes;
 expect(saved().storage_bytes).toBe(100+data.length+Buffer.byteLength(saved().file_name)+generated);
 expect(s.enqueue(owner,capture,'manual')).toEqual({id:job.id,status:'done'});await s.tick();expect(s.settings(owner).usage).toMatchObject({used:1,reserved:0});
 expect((db.query('SELECT source_hash FROM customer_processing_jobs').get() as any).source_hash).toBe(details.sourceHash);
 for(const kind of ['cookie','mobile'] as const){const response=await fileResponse(kind);expect(response.status).toBe(200);expect(response.headers.get('accept-ranges')).toBe('bytes');expect(Buffer.from(await response.arrayBuffer())).toEqual(data);expect((await fileResponse(kind,'other','bytes=0-4')).status).toBe(404);}
});
test('both authenticated file routes honor bounded, open and suffix ranges and reject malformed/unsatisfiable ranges',async()=>{
 const s=service();s.enqueue(owner,capture,'manual');await s.tick();
 for(const kind of ['cookie','mobile'] as const){
  for(const [range,start,end] of [['bytes=0-3',0,3],['bytes=4-',4,data.length-1],['bytes=-5',data.length-5,data.length-1],['bytes=0-9999',0,data.length-1]] as const){
   const response=await fileResponse(kind,owner,range);expect(response.status).toBe(206);expect(response.headers.get('content-range')).toBe(`bytes ${start}-${end}/${data.length}`);expect(response.headers.get('content-length')).toBe(String(end-start+1));expect(response.headers.get('content-type')).toBe('video/mp4');expect(response.headers.get('content-security-policy')).toContain('sandbox');expect(Buffer.from(await response.arrayBuffer())).toEqual(data.subarray(start,end+1));
  }
  for(const range of ['bytes=9999-','bytes=4-2','bytes=-0','bytes=0-1,3-4','bytes=wat','bytes=9007199254740993-']){const response=await fileResponse(kind,owner,range);expect(response.status).toBe(416);expect(response.headers.get('content-range')).toBe(`bytes */${data.length}`);expect(await response.text()).toBe('');}
 }
});
test.each(['pause','withdraw','disable','edit','organization','delete','pro'])('%s during download cannot attach a file or charge',async action=>{
 const s=service({remote:async()=>{
  if(action==='pause')s.configure(owner,{mode:'paused'});
  if(action==='withdraw')s.configure(owner,{fetchLinks:false});
  if(action==='disable')s.configure(owner,{enabled:false});
  if(action==='edit')db.query("UPDATE customer_captures SET source_url='https://example.com/edited.mp4' WHERE id=?").run(capture);
  if(action==='organization')db.query("UPDATE customer_captures SET summary='Concurrent organization',updated_at=2 WHERE id=?").run(capture);
  if(action==='delete')db.query('DELETE FROM customer_captures WHERE id=?').run(capture);
  if(action==='pro')writeSubscription(db,owner,'revenuecat',{status:'inactive',expiresAt:0,renews:false,sandbox:false});
  return downloaded();
 }});s.enqueue(owner,capture,'manual');await s.tick();expect(saved()?.file_path??null).toBeNull();expect(files()).toHaveLength(0);expect(disposed).toHaveLength(1);expect(inputs).toHaveLength(0);expect(s.settings(owner).usage).toMatchObject({used:0,reserved:0});
});
test.each(['global','account'])('%s quota race after staging removes the file without charging',async scope=>{
 const s=service({globalMaxBytes:scope==='global'?2000:3*1024**3,remote:async()=>downloaded({description:'Actual description'}),ai:{available:true,model:'test',organize:async()=>{db.query('UPDATE customer_captures SET storage_bytes=? WHERE id=?').run(scope==='global'?2000:2*1024**3,capture);return organized;}}});
 s.enqueue(owner,capture,'manual');await s.tick();expect(saved().file_path).toBeNull();expect(files()).toHaveLength(0);expect(s.details(owner,capture)).toBeNull();expect(s.settings(owner).usage).toMatchObject({used:0,reserved:0});
});
test('subtitles and description can organize a preserved file but no video bytes become AI input',async()=>{
 const s=service({remote:async()=>downloaded({description:'Filmed by the author.',subtitles:[{language:'en',automatic:false,text:'The actual spoken words.'}]})});s.enqueue(owner,capture,'manual');await s.tick();expect(saved().summary).toBe(organized.summary);expect(readFileSync(join(root,saved().file_path))).toEqual(data);expect(inputs[0]?.text).toContain('The actual spoken words.');expect(inputs[0]?.sourceEvidence?.transcript).toBe('available');expect(inputs[0]?.analysis).toEqual({text:true,image:false,transcript:true});expect(inputs[0]?.image).toBeUndefined();expect(JSON.stringify(s.details(owner,capture))).not.toContain(root);expect(s.settings(owner).usage.used).toBe(1);
});
test('source refusal with readable text records sanitized evidence; no input still fails without invented transcript',async()=>{
 const s=service({remote:async()=>({status:'unavailable',reason:'/private/tmp/secret signed.cdn?token=secret'})});s.enqueue(owner,capture,'manual');await s.tick();expect(inputs).toHaveLength(0);expect(s.settings(owner).usage.used).toBe(0);
 db.query("UPDATE customer_captures SET note_text='Real saved text' WHERE id=?").run(capture);s.enqueue(owner,capture,'manual');await s.tick();expect(s.details(owner,capture)?.result.download).toMatchObject({status:'unavailable',transcriptStatus:'unavailable'});expect(JSON.stringify(s.details(owner,capture))).not.toContain('secret');expect(saved().file_path).toBeNull();expect(inputs[0]?.text).toBe('Real saved text');
});
test('provider exception removes staging and a retry attaches once',async()=>{
 let fails=true;const s=service({remote:async()=>downloaded({description:'Real description'}),ai:{available:true,model:'test',organize:async()=>{if(fails)throw new Error('private provider details');return organized;}}});const job=s.enqueue(owner,capture,'manual');await s.tick();expect(files()).toHaveLength(0);expect(saved().file_path).toBeNull();expect(s.settings(owner).usage.used).toBe(0);fails=false;db.query('UPDATE customer_processing_jobs SET updated_at=0 WHERE id=?').run(job.id);await s.tick();expect(files()).toHaveLength(1);expect(s.enqueue(owner,capture,'manual').id).toBe(job.id);expect(s.settings(owner).usage).toMatchObject({used:1,reserved:0});
});
test('uploaded originals and ordinary readable blogs never invoke the remote downloader',async()=>{
 const s=service({remote:async()=>{throw new Error('must not download');}});db.query("UPDATE customer_captures SET file_path='customer-files/original',file_mime='video/mp4',file_bytes=7,note_text='Original text' WHERE id=?").run(capture);s.enqueue(owner,capture,'manual');await s.tick();expect(saved().file_path).toBe('customer-files/original');expect(inputs[0]?.preservation).toEqual({status:'existing-file',bytes:7,mime:'video/mp4'});expect(s.settings(owner).usage.used).toBe(1);
 db.query("UPDATE customer_captures SET file_path=NULL,file_mime=NULL,file_bytes=0,source_url='https://example.com/blog' WHERE id=?").run(capture);s.enqueue(owner,capture,'manual');await s.tick();expect(s.settings(owner).usage.used).toBe(2);
});
test('an expired lease cannot overwrite a replacement worker or leave its staged file',async()=>{
 let clock=Date.now(),release!:()=>void,enter!:()=>void;const entered=new Promise<void>(r=>enter=r),held=new Promise<void>(r=>release=r);
 const first=service({now:()=>clock,remote:async()=>{enter();await held;return downloaded();}});first.enqueue(owner,capture,'manual');const work=first.tick();await entered;clock+=400_000;
 const second=service({now:()=>clock});await second.tick();release();await work;expect(files()).toHaveLength(1);expect(readFileSync(join(root,saved().file_path))).toEqual(data);expect(first.settings(owner).usage).toMatchObject({used:1,reserved:0});expect(first.enqueue(owner,capture,'manual').status).toBe('done');
});
test('failed temporary disposal cannot strand the uncommitted staged file',async()=>{
 const s=service({remote:async()=>{const value=await downloaded();if(value.status==='downloaded'){const dispose=value.dispose;value.dispose=async()=>{await dispose();throw new Error('temporary cleanup failure');};}return value;}});s.enqueue(owner,capture,'manual');await s.tick();expect(files()).toHaveLength(0);expect(saved().file_path).toBeNull();expect(s.settings(owner).usage.used).toBe(0);
});
test('media-only preservation keeps hosted connections and nullable summary while assigning only a factual missing category',async()=>{
 db.query("UPDATE customer_captures SET summary=NULL,category=NULL,tags='[]' WHERE id=?").run(capture);
 db.query("INSERT INTO customer_captures(id,account_id,client_id,type,status,note_text,storage_bytes,captured_at,created_at,updated_at) VALUES('linked',?,'linked','note','done','Linked note',10,1,1,1)").run(owner);
 db.query("INSERT INTO customer_capture_links(account_id,source_id,target_id,origin,created_at) VALUES(?,?,'linked','hosted',1)").run(owner,capture);
 const s=service();s.enqueue(owner,capture,'manual');await s.tick();expect(saved()).toMatchObject({summary:null,category:'Video',tags:'[]'});expect(db.query('SELECT target_id FROM customer_capture_links').all()).toEqual([{target_id:'linked'}]);expect(inputs).toHaveLength(0);
});
test.each(['pause','withdraw','edit','delete'])('%s during AI after staging removes every uncommitted file',async action=>{
 const s=service({remote:async()=>downloaded({description:'An actual description'}),ai:{available:true,model:'test',organize:async()=>{
  expect(files()).toHaveLength(1);
  if(action==='pause')s.configure(owner,{mode:'paused'});
  if(action==='withdraw')s.configure(owner,{fetchLinks:false});
  if(action==='edit')db.query("UPDATE customer_captures SET note_text='Edited',updated_at=2 WHERE id=?").run(capture);
  if(action==='delete')db.query('DELETE FROM customer_captures WHERE id=?').run(capture);
  return organized;
 }}});s.enqueue(owner,capture,'manual');await s.tick();expect(files()).toHaveLength(0);expect(saved()?.file_path??null).toBeNull();expect(s.settings(owner).usage).toMatchObject({used:0,reserved:0});
});
test.each(['https://youtube.com/watch?v=test','https://youtu.be/test','https://www.instagram.com/reel/test/','https://www.instagram.com/p/test/','https://x.com/example/status/123','https://twitter.com/example/status/123','https://example.com/identified-video'])('candidate %s persists the downloaded file',async sourceUrl=>{
 db.query('UPDATE customer_captures SET source_url=? WHERE id=?').run(sourceUrl,capture);
 const s=service({source:async()=>({url:sourceUrl,requestedUrl:sourceUrl,fetchedAt:0,contentHash:'fixture',text:'',title:null,description:null,imageUrl:null,author:null,publishedAt:null,siteName:null,contentKind:sourceUrl.includes('identified-video')?'video':'page'})});s.enqueue(owner,capture,'manual');await s.tick();expect(saved().file_bytes).toBe(data.length);expect(s.details(owner,capture)?.result.download.sourceUrl).toBe(sourceUrl);
});
test('private processing details expose the current job for reader refresh and deny other accounts',async()=>{
 const s=service();const job=s.enqueue(owner,capture,'manual');const app=createApp(db);
 const request=(account:string)=>app.request('https://foundkeep.app/api/captures/'+capture+'/processing',{headers:{cookie:'__Host-atlas_session='+(account+'-token').padEnd(43,'x')}});
 expect(await (await request(owner)).json()).toMatchObject({processing:null,job:{id:job.id,status:'pending',error:null,updatedAt:expect.any(Number)}});
 await s.tick();expect(await (await request(owner)).json()).toMatchObject({processing:{model:'media-preservation'},job:{id:job.id,status:'done'}});expect((await request('other')).status).toBe(404);
});
test('withdrawing consent aborts an in-flight downloader through its signal',async()=>{
 let entered!:()=>void;const start=new Promise<void>(r=>entered=r);
 const s=service({remote:async(_url:string,options:{signal:AbortSignal})=>{entered();await new Promise<void>(r=>options.signal.addEventListener('abort',()=>r(),{once:true}));return {status:'cancelled',reason:'Cancelled'};}});
 s.enqueue(owner,capture,'manual');const work=s.tick();await start;s.configure(owner,{fetchLinks:false});await work;expect(saved().file_path).toBeNull();expect(files()).toHaveLength(0);expect(s.settings(owner).usage).toMatchObject({used:0,reserved:0});
});
test('reader follows a retried older source job instead of an obsolete newer job',async()=>{
 let clock=Date.now();const s=service({now:()=>clock,remote:async()=>({status:'unavailable',reason:'Unavailable'}),ai:{available:true,model:'test',organize:async()=>{throw new Error('Provider unavailable');}}});
 const original=s.enqueue(owner,capture,'manual');await s.tick();clock++;
 db.query("UPDATE customer_captures SET note_text='New source' WHERE id=?").run(capture);const edited=s.enqueue(owner,capture,'manual');db.query('UPDATE customer_processing_jobs SET attempts=2 WHERE id=?').run(edited.id);await s.tick();clock++;
 db.query('UPDATE customer_captures SET note_text=NULL WHERE id=?').run(capture);expect(s.enqueue(owner,capture,'manual').id).toBe(original.id);
 const response=await createApp(db).request('https://foundkeep.app/api/captures/'+capture+'/processing',{headers:{cookie:'__Host-atlas_session='+(owner+'-token').padEnd(43,'x')}});expect(await response.json()).toMatchObject({job:{id:original.id,status:'pending'}});
});
test.each(['empty','note','downloaded'])('generic YouTube shell with %s preserves only real evidence and charges only successful work',async mode=>{
 const {extractSource}=await import('../src/customer-source.ts');const html=await Bun.file(new URL('./fixtures/youtube-generic-fi.html',import.meta.url)).text();
 db.query("UPDATE customer_captures SET source_url='https://www.youtube.com/watch?v=YE7VzlLtp-4',note_text=? WHERE id=?").run(mode==='note'?'My actual note about this video':null,capture);
 const s=service({source:async(sourceUrl:string)=>({...extractSource(html,sourceUrl),requestedUrl:sourceUrl,contentHash:'observed-fixture',fetchedAt:Date.now()}),remote:async()=>mode==='downloaded'?downloaded():{status:'unavailable',reason:'Public copy unavailable'}});
 s.enqueue(owner,capture,'manual');await s.tick();
 expect(s.settings(owner).usage).toMatchObject({used:mode==='empty'?0:1,reserved:0});
 if(mode==='empty'){expect(inputs).toHaveLength(0);expect(s.details(owner,capture)).toBeNull();expect(saved().file_path).toBeNull();}
 if(mode==='note'){expect(inputs).toHaveLength(1);expect(inputs[0]?.text).toBe('My actual note about this video');expect(saved().summary).toBe(organized.summary);}
 if(mode==='downloaded'){expect(inputs).toHaveLength(0);expect(s.details(owner,capture)?.model).toBe('media-preservation');expect(saved().summary).toBe('Keep summary');expect(readFileSync(join(root,saved().file_path))).toEqual(data);}
});
test.each(['downloaded','unavailable'])('AI distinguishes %s preservation from actual text, transcript and image analysis',async status=>{
 const s=service({remote:async()=>status==='downloaded'?downloaded({description:'A real source description'}):{status:'unavailable',reason:'Private diagnostic'},media:async()=>({image:{mime:'image/webp',base64:'AAAA'}})});
 db.query("UPDATE customer_captures SET note_text='My saved observation' WHERE id=?").run(capture);s.enqueue(owner,capture,'manual');await s.tick();
 expect(inputs[0]).toMatchObject({preservation:status==='downloaded'?{status,bytes:data.length,mime:'video/mp4'}:{status},analysis:{text:true,transcript:false,image:false}});
 expect(JSON.stringify(inputs[0])).not.toContain('Private diagnostic');expect(inputs[0]?.image).toBeUndefined();
});
test('consented preview is analysis input while preserved video bytes remain separate evidence',async()=>{
 const s=service({media:async()=>({image:{mime:'image/webp',base64:'AAAA'}})});s.configure(owner,{images:true});s.enqueue(owner,capture,'manual');await s.tick();
 expect(inputs[0]).toMatchObject({preservation:{status:'downloaded',bytes:data.length,mime:'video/mp4'},analysis:{text:false,image:true,transcript:false},image:{mime:'image/webp',base64:'AAAA'}});expect(s.settings(owner).usage.used).toBe(1);
});
