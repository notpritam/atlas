import {createRemoteFileSweeper} from './customer-remote-cleanup.ts';
import {config} from './config.ts';
import {removeCustomerFile,type StoredCustomerFile} from './customer-files.ts';
import {preserveRemoteVideo,remoteVideoCandidate,type RemoteDownloader,type Preservation} from './customer-remote-preservation.ts';
import {processCustomerMedia,type MediaResult} from './customer-media.ts';
import {createHash,randomUUID} from 'node:crypto';
import type {Database} from 'bun:sqlite';
import type {Hono} from 'hono';
import type {CustomerEnv} from './customer.ts';
import type {CustomerServices} from './customer-modules.ts';
import {moduleFail} from './customer-modules.ts';
import {accountPlan} from './customer-plans.ts';
import {createCustomerAi,type AiInput,type AiResult,validateAiResult} from './customer-ai.ts';
import {fetchCustomerSource,type SourceSnapshot} from './customer-source.ts';

export const CONSENT_VERSION='2026-09-12';
// Covers source (12s), download (120s), staging (30s), decoders (90s) and AI (45s).
const LEASE_MS=360_000;
const FAILURE='Processing could not finish. Your original is safe.';
type Save={id:string;account_id:string;type:string;source_title:string|null;source_url:string|null;note_text:string|null;selection_text:string|null;article_text:string|null;ocr_text:string|null;blob_data:Uint8Array|null;blob_mime:string|null;file_path:string|null;file_mime:string|null;file_bytes:number;summary:string|null;category:string|null;tags:string;storage_bytes:number;status:string;enrich_attempts:number;created_at:number;provenance_json:string|null;updated_at:number};
type Job={id:string;account_id:string;capture_id:string;source_hash:string;status:string;attempts:number;cycle:string;credit:number;lease_token:string|null;reason:string};
type SettingsRow={enabled:number;fetch_links:number;images:number;consent_version:string|null;enabled_at:number;mode:'instant'|'scheduled'|'manual'|'paused';interval_hours:number;monthly_limit:number;next_run_at:number|null;scheduled_cutoff:number|null};
type Options={root?:string;remote?:RemoteDownloader;ai?:{available:boolean;model:string;organize(input:AiInput):Promise<AiResult>};source?:(url:string)=>Promise<SourceSnapshot>;now?:()=>number;globalMaxBytes?:number;dailyAttempts?:number;media?:(save:Save)=>Promise<MediaResult>};
const bytes=(value:unknown)=>Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value),'utf8');
function fingerprint(row:Save){return createHash('sha256').update(JSON.stringify([row.type,row.source_title,row.source_url,row.note_text,row.selection_text,row.article_text,row.ocr_text,row.file_path,row.file_bytes,row.blob_mime])).update(row.blob_data||new Uint8Array()).digest('hex');}
const derived=(row:Save)=>bytes(row.summary||'')+bytes(row.category||'')+(row.tags&&row.tags!=='[]'?bytes(row.tags):0);
export function createProcessingService(db:Database,options:Options={}){
 const ai=options.ai||createCustomerAi(),now=options.now||Date.now;
 const getSave=(owner:string,id:string)=>db.query('SELECT * FROM customer_captures WHERE id=? AND account_id=?').get(id,owner) as Save|null;
 const prefs=(owner:string)=>db.query('SELECT * FROM customer_automation WHERE account_id=?').get(owner) as SettingsRow|null;
 function settle(job:Job,status:string,error:string|null,success=false){
  const changed=db.query('UPDATE customer_processing_jobs SET status=?,error=?,lease_token=NULL,lease_until=NULL,credit=0,updated_at=? WHERE id=? AND credit=? AND lease_token IS ?').run(status,error,now(),job.id,job.credit,job.lease_token);
  if(changed.changes&&job.credit===1)db.query('UPDATE customer_processing_usage SET reserved=MAX(0,reserved-1),used=used+? WHERE account_id=? AND cycle=?').run(Number(success),job.account_id,job.cycle);
 }
 function settings(owner:string){
  const row=prefs(owner),plan=accountPlan(db,owner,now()),cycle=new Date(now()).toISOString().slice(0,7);
  const usage=db.query('SELECT used,reserved FROM customer_processing_usage WHERE account_id=? AND cycle=?').get(owner,cycle) as {used:number;reserved:number}|null;
  return {available:ai.available,enabled:!!row?.enabled,fetchLinks:!!row?.fetch_links,images:!!row?.images,consentVersion:CONSENT_VERSION,provider:'OpenAI',model:ai.model,pro:plan.pro,mode:row?.mode||'instant',intervalHours:row?.interval_hours||24,monthlyLimit:row?.monthly_limit??plan.limits.monthlyProcessing,nextRunAt:row?.enabled&&row.mode==='scheduled'?row.next_run_at:null,
   usage:{cycle,used:usage?.used||0,reserved:usage?.reserved||0,limit:plan.limits.monthlyProcessing,monthlyLimit:Math.min(row?.monthly_limit??plan.limits.monthlyProcessing,plan.limits.monthlyProcessing)},
   activity:db.query('SELECT id,capture_id AS captureId,status,attempts,error,created_at AS createdAt,updated_at AS updatedAt FROM customer_processing_jobs WHERE account_id=? ORDER BY created_at DESC LIMIT 30').all(owner)};
 }
 function configure(owner:string,value:Record<string,unknown>){
  for(const key of Object.keys(value))if(!['enabled','fetchLinks','images','consentVersion','mode','intervalHours','monthlyLimit'].includes(key))moduleFail(400,'invalid_preferences','Unknown processing preference.');
  for(const key of ['enabled','fetchLinks','images'])if(value[key]!==undefined&&typeof value[key]!=='boolean')moduleFail(400,'invalid_preferences','Use true or false for processing preferences.');
  if(value.mode!==undefined&&!['instant','scheduled','manual','paused'].includes(value.mode as string))moduleFail(400,'invalid_preferences','Choose instant, scheduled, manual, or paused processing.');
  if(value.intervalHours!==undefined&&![1,6,24].includes(value.intervalHours as number))moduleFail(400,'invalid_preferences','Choose a schedule of 1, 6, or 24 hours.');
  if(value.monthlyLimit!==undefined&&(!Number.isInteger(value.monthlyLimit)||Number(value.monthlyLimit)<0||Number(value.monthlyLimit)>500))moduleFail(400,'invalid_preferences','Choose a whole-number monthly cap from 0 to 500 credits.');
  db.transaction(()=>{
   const previous=prefs(owner),enabled=value.enabled===undefined?!!previous?.enabled:!!value.enabled;
   if(enabled&&value.consentVersion!==CONSENT_VERSION&&previous?.consent_version!==CONSENT_VERSION)moduleFail(400,'consent_required','Confirm that selected content can be sent to OpenAI for organization.');
   const mode=String(value.mode??previous?.mode??'instant'),interval=Number(value.intervalHours??previous?.interval_hours??24),limit=Number(value.monthlyLimit??previous?.monthly_limit??500);
   const resetSchedule=enabled&&(!previous?.enabled||previous.mode!==mode||previous.interval_hours!==interval);
   let nextRun:number|null=null;
   if(enabled&&mode==='scheduled'){
    const cutoff=previous?.scheduled_cutoff;
    nextRun=cutoff!=null?previous?.next_run_at??cutoff+interval*3600_000:
     resetSchedule?now()+interval*3600_000:previous?.next_run_at??now()+interval*3600_000;
   }else if(enabled&&mode==='paused')nextRun=previous?.next_run_at??null;
   db.query(`INSERT INTO customer_automation(account_id,enabled,fetch_links,images,consent_version,enabled_at,updated_at,mode,interval_hours,monthly_limit,next_run_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(account_id) DO UPDATE SET enabled=excluded.enabled,fetch_links=excluded.fetch_links,images=excluded.images,consent_version=excluded.consent_version,enabled_at=excluded.enabled_at,updated_at=excluded.updated_at,mode=excluded.mode,interval_hours=excluded.interval_hours,monthly_limit=excluded.monthly_limit,next_run_at=excluded.next_run_at`)
    .run(owner,Number(enabled),Number(value.fetchLinks??!!previous?.fetch_links),Number(value.images??!!previous?.images),enabled?CONSENT_VERSION:previous?.consent_version||null,enabled&&!previous?.enabled?now():previous?.enabled_at??now(),now(),mode,interval,limit,nextRun);
   if(!enabled||mode==='instant'||mode==='manual')db.query('UPDATE customer_automation SET scheduled_cutoff=NULL WHERE account_id=?').run(owner);
   const withdrawn=!enabled||!!previous?.fetch_links&&value.fetchLinks===false||!!previous?.images&&value.images===false;
   const jobs=db.query("SELECT * FROM customer_processing_jobs WHERE account_id=? AND status IN ('pending','running','paused')").all(owner) as Job[];
   for(const job of jobs){
    if(withdrawn)settle(job,'cancelled',null);
    else if(mode==='paused'||limit<(previous?.monthly_limit??500)||job.reason==='new-save'&&(mode==='manual'||resetSchedule&&mode==='scheduled'))settle(job,'paused',null);
   }
  }).immediate();return settings(owner);
 }
 function enqueue(owner:string,id:string,reason:'manual'|'new-save'|'agent'){
  return db.transaction(()=>{
   const row=getSave(owner,id);if(!row)moduleFail(404,'not_found','Saved item not found.');
   if(!accountPlan(db,owner,now()).pro)moduleFail(403,'pro_required','Pro is required for managed processing.');
   const preference=prefs(owner);if(!preference?.enabled||preference.consent_version!==CONSENT_VERSION)moduleFail(409,'consent_required','Enable managed processing before sending content to OpenAI.');
   if(preference.mode==='paused')moduleFail(409,'processing_paused','Processing is paused. Resume it in settings first.');
   if(!ai.available)moduleFail(503,'processing_unavailable','Managed processing is not configured yet.');
   if(row.status!=='done' && !(row.status==='failed' && row.enrich_attempts>=3))moduleFail(409,'capture_busy','This item is still being saved. Try again shortly.');
   const sourceHash=fingerprint(row);
   // Retire held versions in the same transaction as deduplication and reservation.
   // Otherwise edited saves occupy the bounded resume page indefinitely.
   const superseded=db.query("SELECT * FROM customer_processing_jobs WHERE account_id=? AND capture_id=? AND source_hash<>? AND status='paused'").all(owner,id,sourceHash) as Job[];
   for(const job of superseded)settle(job,'cancelled',null);
   let existing=db.query('SELECT * FROM customer_processing_jobs WHERE account_id=? AND capture_id=? AND source_hash=?').get(owner,id,sourceHash) as Job|null;
   if(existing&&!['failed','cancelled','paused'].includes(existing.status))return {id:existing.id,status:existing.status};
   const cycle=new Date(now()).toISOString().slice(0,7);
   db.query('INSERT OR IGNORE INTO customer_processing_usage(account_id,cycle) VALUES(?,?)').run(owner,cycle);
   const limit=Math.min(preference.monthly_limit,accountPlan(db,owner,now()).limits.monthlyProcessing);
   const reserved=db.query('UPDATE customer_processing_usage SET reserved=reserved+1 WHERE account_id=? AND cycle=? AND used+reserved<?').run(owner,cycle,limit);
   if(!reserved.changes)moduleFail(429,'processing_quota','Your monthly processing allowance is full.');
   const jobId=existing?.id||randomUUID();
   if(existing)db.query("UPDATE customer_processing_jobs SET status='pending',attempts=0,credit=1,cycle=?,error=NULL,updated_at=? WHERE id=?").run(cycle,now(),jobId);
   else db.query('INSERT INTO customer_processing_jobs(id,account_id,capture_id,source_hash,reason,cycle,credit,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)').run(jobId,owner,id,sourceHash,reason,cycle,now(),now());
   return {id:jobId,status:'pending'};
  }).immediate();
 }
 function details(owner:string,id:string){
  const row=db.query('SELECT source_hash,model,result_json,source_json,created_at FROM customer_processing_results WHERE account_id=? AND capture_id=?').get(owner,id) as {source_hash:string;model:string;result_json:string;source_json:string|null;created_at:number}|null;
  return row?{derivatives:db.query('SELECT kind,mime,bytes FROM customer_derivatives WHERE account_id=? AND capture_id=?').all(owner,id),sourceHash:row.source_hash,model:row.model,result:JSON.parse(row.result_json),source:row.source_json?JSON.parse(row.source_json):null,processedAt:row.created_at}:null;
 }
 const remoteCleanup=createRemoteFileSweeper(db,options.root||config.dataDir);
 let lastCleanup:number|undefined;
 let running=false;let lastOwner='';
 async function tick(){
  if(running)return 0;running=true;
  try{
   if(lastCleanup===undefined||now()-lastCleanup>=60_000){remoteCleanup.sweep(now());lastCleanup=now();}
   if(!ai.available)return 0;
   // Each owner decision is atomic, including the schedule boundary and reservations.
   const owners=db.query("SELECT account_id FROM customer_automation WHERE enabled=1 AND consent_version=? AND mode<>'paused' AND account_id>? ORDER BY account_id LIMIT 100").all(CONSENT_VERSION,lastOwner) as {account_id:string}[];
   lastOwner=owners.length===100?owners.at(-1)!.account_id:'';
   for(const owner of owners)db.transaction(()=>{
    if(!accountPlan(db,owner.account_id,now()).pro)return;
    const preference=prefs(owner.account_id)!;
    const cutoff=preference.mode==='scheduled'?(preference.scheduled_cutoff??((preference.next_run_at??Infinity)<=now()?preference.next_run_at:null)):null;
    if(cutoff!==null&&preference.scheduled_cutoff===null)db.query('UPDATE customer_automation SET scheduled_cutoff=? WHERE account_id=?').run(cutoff,owner.account_id);
    const automatic=preference.mode==='instant'||cutoff!==null;
    const upper=cutoff??Number.MAX_SAFE_INTEGER;
    // Filter before paging so ineligible automatic jobs cannot block manual work.
    const held=db.query(`SELECT j.capture_id,j.reason FROM customer_processing_jobs j JOIN customer_captures c ON c.id=j.capture_id AND c.account_id=j.account_id
      WHERE j.account_id=? AND j.status='paused' AND (j.reason<>'new-save' OR (? AND c.created_at<=?))
      AND (c.status='done' OR (c.status='failed' AND c.enrich_attempts>=3)) ORDER BY j.created_at,j.id LIMIT 20`).all(owner.account_id,Number(automatic),upper) as {capture_id:string;reason:'manual'|'agent'|'new-save'}[];
    const saves=automatic?db.query(`SELECT id FROM customer_captures c WHERE account_id=? AND created_at>=? AND created_at<=? AND (status='done' OR (status='failed' AND enrich_attempts>=3))
      AND NOT EXISTS(SELECT 1 FROM customer_processing_jobs j WHERE j.capture_id=c.id) ORDER BY created_at,id LIMIT 20`).all(owner.account_id,preference.enabled_at,upper) as {id:string}[]:[];
    const cycle=new Date(now()).toISOString().slice(0,7);
    const usage=db.query('SELECT used,reserved FROM customer_processing_usage WHERE account_id=? AND cycle=?').get(owner.account_id,cycle) as {used:number;reserved:number}|null;
    let remaining=Math.min(preference.monthly_limit,accountPlan(db,owner.account_id,now()).limits.monthlyProcessing)-(usage?.used||0)-(usage?.reserved||0);
    // A full allowance leaves the cohort intact without repeatedly attempting reservations.
    for(const item of [...held.map(job=>({id:job.capture_id,reason:job.reason})),...saves.map(save=>({...save,reason:'new-save' as const}))]){
     if(remaining<=0)break;
     try{enqueue(owner.account_id,item.id,item.reason);remaining--;}catch{break;}
    }
    if(cutoff!==null){
     const waiting=db.query(`SELECT 1 FROM customer_captures c WHERE c.account_id=? AND c.created_at<=? AND (c.status='done' OR (c.status='failed' AND c.enrich_attempts>=3))
       AND ((c.created_at>=? AND NOT EXISTS(SELECT 1 FROM customer_processing_jobs j WHERE j.capture_id=c.id))
         OR EXISTS(SELECT 1 FROM customer_processing_jobs j WHERE j.capture_id=c.id AND j.status='paused' AND j.reason='new-save')) LIMIT 1`).get(owner.account_id,cutoff,preference.enabled_at);
     if(!waiting){
      const interval=preference.interval_hours*3600_000;
      const next=cutoff+(Math.floor(Math.max(0,now()-cutoff)/interval)+1)*interval;
      // Keep the cutoff while queued work settles: a later pause/cap reduction
      // must resume that same cohort, even after every page was reserved.
      const active=db.query(`SELECT 1 FROM customer_processing_jobs j JOIN customer_captures c ON c.id=j.capture_id AND c.account_id=j.account_id
        WHERE j.account_id=? AND j.reason='new-save' AND j.status IN ('pending','running') AND c.created_at<=? LIMIT 1`).get(owner.account_id,cutoff);
      db.query('UPDATE customer_automation SET next_run_at=?,scheduled_cutoff=? WHERE account_id=?').run((preference.next_run_at??0)>cutoff?preference.next_run_at:next,active?cutoff:null,owner.account_id);
     }
    }
   }).immediate();
   const job=db.transaction(()=>{
    const stale=db.query("SELECT * FROM customer_processing_jobs WHERE status='running' AND lease_until<? AND attempts>=3").all(now()) as Job[];for(const row of stale)settle(row,'failed',FAILURE);
    const day=new Date(now()).toISOString().slice(0,10);db.query('INSERT OR IGNORE INTO customer_processing_budget(day) VALUES(?)').run(day);
    const budget=db.query('SELECT attempts FROM customer_processing_budget WHERE day=?').get(day) as {attempts:number};
    if(budget.attempts>=(options.dailyAttempts||Number(process.env.FOUNDKEEP_AI_DAILY_ATTEMPTS)||2000))return null;
    const claim=db.query(`UPDATE customer_processing_jobs SET status='running',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=?
      WHERE id=(SELECT id FROM customer_processing_jobs WHERE attempts<3 AND ((status='pending' AND (attempts=0 OR updated_at<?)) OR (status='running' AND lease_until<?)) ORDER BY created_at LIMIT 1) RETURNING *`)
     .get(randomUUID(),now()+LEASE_MS,now(),now()-120_000,now()) as Job|null;
    if(claim)db.query('UPDATE customer_processing_budget SET attempts=attempts+1 WHERE day=?').run(day);return claim;
   }).immediate();
   if(!job)return 0;
   const revision=getSave(job.account_id,job.capture_id)?.updated_at;
   const controller=new AbortController();
   let staged:StoredCustomerFile|undefined,committed=false;
   const valid=()=>{
    const current=db.query("SELECT * FROM customer_processing_jobs WHERE id=? AND status='running' AND lease_token=? AND lease_until>=?").get(job.id,job.lease_token,now()) as Job|null;
    const row=getSave(job.account_id,job.capture_id),preference=prefs(job.account_id);
    return current&&row&&row.updated_at===revision&&preference?.enabled&&preference.mode!=='paused'&&preference.consent_version===CONSENT_VERSION&&accountPlan(db,job.account_id,now()).pro&&fingerprint(row)===job.source_hash?{row,preference}:null;
   };
   const cancellation=setInterval(()=>{if(!valid())controller.abort();},1000);
   try{
    const initial=valid();if(!initial){db.transaction(()=>settle(job,'cancelled',null)).immediate();return 1;}
    const {row,preference}=initial;let source:SourceSnapshot|null=null;let sourceError:string|null=null;
    if(preference.fetch_links&&row.source_url){try{source=await (options.source||fetchCustomerSource)(row.source_url);}catch{sourceError='The source did not expose readable public content.';}}
    if(!valid()){db.transaction(()=>settle(job,'cancelled',null)).immediate();return 1;}
    let preservation:Preservation|undefined;
    if(preference.fetch_links&&row.source_url&&!row.file_path&&remoteVideoCandidate(row.source_url,source)&&!db.query('SELECT 1 FROM customer_preservation_jobs WHERE capture_id=?').get(row.id)){
     preservation=await preserveRemoteVideo(row.source_url,options.root||config.dataDir,controller.signal,options.remote);
     staged=preservation.file;
    }
    if(!valid()){db.transaction(()=>settle(job,'cancelled',null)).immediate();return 1;}
    const mediaRow=staged?{...row,file_path:staged.relativePath,file_mime:staged.mime,file_bytes:staged.bytes}:row;
    const media=await (options.media?options.media(mediaRow):processCustomerMedia(mediaRow,options.root||config.dataDir));
    if(!valid()){db.transaction(()=>settle(job,'cancelled',null)).immediate();return 1;}
    const candidates=db.query('SELECT id,source_title AS title,summary FROM customer_captures WHERE account_id=? AND id<>? ORDER BY created_at DESC LIMIT 40').all(job.account_id,row.id) as {id:string;title:string|null;summary:string|null}[];
    const input:AiInput={title:row.source_title||source?.title||row.type,url:row.source_url,text:[row.note_text,row.selection_text,row.article_text||source?.text,row.ocr_text,media.text,preservation?.text].filter(Boolean).join('\n\n'),candidates:candidates.map(value=>({id:value.id,title:value.title||'',summary:value.summary||''}))};
    if(source?.extractionStatus)input.sourceEvidence={status:source.extractionStatus,notice:source.notice||null,transcript:source.transcriptStatus||null};
    else if(row.source_url&&!source)input.sourceEvidence={status:'unavailable',notice:sourceError||'Source fetching is disabled. Only the saved content is available.',transcript:null};
    if(preservation?.text)input.sourceEvidence={status:preservation.evidence.transcriptStatus==='available'?'readable':'metadata-only',notice:preservation.evidence.notice,transcript:preservation.evidence.transcriptStatus};
    if(preservation)input.preservation={status:preservation.evidence.status,...(staged?{bytes:staged.bytes,mime:staged.mime}:{})};
    else if(row.file_path)input.preservation={status:'existing-file',bytes:row.file_bytes,mime:row.file_mime||'application/octet-stream'};
    if(preference.images){
     const supportedImage=(image:MediaResult['image'])=>image&&['image/png','image/jpeg','image/webp'].includes(image.mime)&&image.base64.length>0&&image.base64.length<5_600_000;
     if(supportedImage(media.image))input.image=media.image;
     else if(row.blob_data?.byteLength&&row.blob_data.byteLength<=4*1024*1024&&row.blob_mime&&['image/png','image/jpeg','image/webp'].includes(row.blob_mime))input.image={mime:row.blob_mime,base64:Buffer.from(row.blob_data).toString('base64')};
    }
    if(!valid()){db.transaction(()=>settle(job,'cancelled',null)).immediate();return 1;}
    input.analysis={text:!!input.text.trim(),image:!!input.image,transcript:!!(preservation?.text&&preservation.evidence.transcriptStatus==='available'||!row.article_text&&source?.text&&source.transcriptStatus==='available')};
    const mediaOnly=!input.text.trim()&&!input.image&&!!staged;
    if(!input.text.trim()&&!input.image&&!staged){
     db.transaction(()=>settle(job,'failed',(preservation?preservation.evidence.notice+' ':'')+'No readable content was available. Add page text with the extension or a note, then retry.')).immediate();return 1;
    }
    const result=mediaOnly?{summary:row.summary,category:row.category||'Video',tags:JSON.parse(row.tags),relatedIds:[]}:validateAiResult(await ai.organize(input),candidates.map(value=>value.id));
    db.transaction(()=>{
     const current=valid();if(!current){settle(job,'cancelled',null);return;}
     const resultJson=JSON.stringify({...result,sourceError,mediaNote:media.note||null,extractedText:[media.text,preservation?.text].filter(Boolean).join('\n\n')||null,download:preservation?.evidence||null}),sourceJson=source?JSON.stringify(source):null;
     const old=db.query('SELECT storage_bytes FROM customer_processing_results WHERE capture_id=? AND account_id=?').get(row.id,job.account_id) as {storage_bytes:number}|null;
     const generated=bytes(resultJson)+bytes(sourceJson||'');const nextTags=mediaOnly?row.tags:JSON.stringify(result.tags);
     const oldMedia=(db.query('SELECT COALESCE(SUM(bytes),0) bytes FROM customer_derivatives WHERE capture_id=? AND account_id=?').get(row.id,job.account_id) as {bytes:number}).bytes;
     const nextMedia=media.derivatives||[];
     const mediaDelta=nextMedia.reduce((sum,item)=>sum+item.data.byteLength,0)-oldMedia;
     const delta=(staged?staged.bytes+bytes(preservation?.fileName||''):0)+mediaDelta+generated-(old?.storage_bytes||0)+bytes(result.summary||'')+bytes(result.category)+(nextTags==='[]'?0:bytes(nextTags))-derived(current.row);
     const usage=db.query('SELECT COALESCE(SUM(storage_bytes),0) total,COALESCE(SUM(CASE WHEN account_id=? THEN storage_bytes ELSE 0 END),0) owned FROM customer_captures').get(job.account_id) as {total:number;owned:number};
     if(usage.owned+delta>accountPlan(db,job.account_id,now()).limits.maxBytes||usage.total+delta>(options.globalMaxBytes||Number(process.env.ATLAS_CUSTOMER_GLOBAL_MAX_BYTES)||2*1024**3)){settle(job,'failed','Storage is full. Your original is safe.');return;}
     const finalHash=staged?fingerprint({...current.row,file_path:staged.relativePath,file_mime:staged.mime,file_bytes:staged.bytes}):job.source_hash;
     db.query(`INSERT INTO customer_processing_results(capture_id,account_id,source_hash,model,result_json,source_json,storage_bytes,created_at) VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(capture_id) DO UPDATE SET source_hash=excluded.source_hash,model=excluded.model,result_json=excluded.result_json,source_json=excluded.source_json,storage_bytes=excluded.storage_bytes,created_at=excluded.created_at`)
       .run(row.id,job.account_id,finalHash,mediaOnly?'media-preservation':ai.model,resultJson,sourceJson,generated,now());
     db.query('DELETE FROM customer_derivatives WHERE capture_id=? AND account_id=?').run(row.id,job.account_id);
     for(const item of nextMedia)db.query('INSERT INTO customer_derivatives(account_id,capture_id,kind,mime,data,bytes,source_hash,created_at) VALUES(?,?,?,?,?,?,?,?)').run(job.account_id,row.id,item.kind,item.mime,item.data,item.data.byteLength,finalHash,now());
     db.query('UPDATE customer_captures SET summary=?,category=?,tags=?,storage_bytes=MAX(0,storage_bytes+?),updated_at=MAX(updated_at+1,?) WHERE id=? AND account_id=?').run(result.summary,result.category,nextTags,delta,now(),row.id,job.account_id);
     if(staged)db.query('UPDATE customer_captures SET file_path=?,file_name=?,file_mime=?,file_bytes=? WHERE id=? AND account_id=?').run(staged.relativePath,preservation!.fileName!,staged.mime,staged.bytes,row.id,job.account_id);
     if(!mediaOnly){
     db.query("DELETE FROM customer_capture_links WHERE account_id=? AND source_id=? AND origin='hosted'").run(job.account_id,row.id);
     for(const target of result.relatedIds)if(getSave(job.account_id,target))db.query("INSERT OR IGNORE INTO customer_capture_links(account_id,source_id,target_id,origin,created_at) VALUES(?,?,?,'hosted',?)").run(job.account_id,row.id,target,now());
     }
     db.query('UPDATE customer_processing_jobs SET source_hash=? WHERE id=? AND lease_token=?').run(finalHash,job.id,job.lease_token);
     settle(job,'done',null,true);
    }).immediate();
    committed=!!staged&&getSave(job.account_id,row.id)?.file_path===staged.relativePath;
   }catch{
    db.transaction(()=>{
     const current=db.query("SELECT * FROM customer_processing_jobs WHERE id=? AND status='running' AND lease_token=?").get(job.id,job.lease_token) as Job|null;
     if(!current)return;if(!valid()){settle(current,'cancelled',null);return;}if(current.attempts>=3)settle(current,'failed',FAILURE);
     else db.query("UPDATE customer_processing_jobs SET status='pending',error=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?").run(FAILURE,now(),job.id);
    }).immediate();
   }finally{clearInterval(cancellation);controller.abort();if(staged&&!committed)removeCustomerFile(options.root||config.dataDir,staged.relativePath);}
   return 1;
  }finally{running=false;}
 }
 return {settings,configure,enqueue,details,tick};
}
export function registerCustomerProcessing(app:Hono<CustomerEnv>,db:Database,services:CustomerServices){
 const processing=createProcessingService(db);
 app.get('/automation',c=>c.json(processing.settings(services.auth(c).account.id)));
 app.put('/automation',async c=>{services.auth(c);const body=await services.jsonBody(c);return c.json(processing.configure(services.auth(c).account.id,body));});
 app.post('/captures/:id/process',async c=>{services.auth(c);const body=await services.jsonBody(c);if(Object.keys(body).length)moduleFail(400,'invalid_input','This action takes no options.');const owner=services.auth(c).account.id;services.rate('process:'+owner,20,60_000);return c.json(processing.enqueue(owner,c.req.param('id'),'manual'),202);});
 app.get('/captures/:id/processing',c=>{const owner=services.auth(c).account.id;if(!db.query('SELECT 1 FROM customer_captures WHERE id=? AND account_id=?').get(c.req.param('id'),owner))moduleFail(404,'not_found','Saved item not found.');return c.json({processing:processing.details(owner,c.req.param('id')),job:db.query('SELECT id,status,error,updated_at AS updatedAt FROM customer_processing_jobs WHERE account_id=? AND capture_id=? ORDER BY updated_at DESC,rowid DESC LIMIT 1').get(owner,c.req.param('id'))});});
}
