import {preservedMediaColumns} from './customer-media-preview.ts';
import type {Database} from 'bun:sqlite';
import {z} from 'zod';
import {customerCaptureDto,type CustomerCaptureRow} from './customer.ts';
import type {AgentAccess} from './customer-agent-access.ts';
import {accountPlan} from './customer-plans.ts';
import {captureOrganization,organizationBytes,normalizeCaptureTags} from './customer-organization.ts';
import {moduleFail} from './customer-modules.ts';
import {normalizeProvenance} from './customer-provenance.ts';

const id=z.string().uuid();
const optionalText=(max:number)=>z.string().max(max).nullable().optional();
const sourceUrl=z.string().max(4096).refine(value=>{
  try {const url=new URL(value);return (url.protocol==='http:'||url.protocol==='https:')&&!url.username&&!url.password;}
  catch{return false;}
},'Use a credential-free HTTP or HTTPS URL.').nullable().optional();
const organization={
  folderId:id.nullable().optional(),
  userTags:z.array(z.string().min(1).max(40)).max(20).optional(),
};

export const mcpWriteSpecs={
  create_save:{
    description:'Create an owned note, bookmark, tweet, or selection. Limits: clientId 128, title 1,000, URL 4,096, note/selection 50,000, article 500,000 characters; up to 20 personal tags of 40 characters.',
    scope:'library:write' as const,
    schema:z.object({
      clientId:z.string().min(1).max(128),type:z.enum(['note','bookmark','tweet','selection']),
      sourceTitle:optionalText(1000),sourceUrl,noteText:optionalText(50_000),
      articleText:optionalText(500_000),selectionText:optionalText(50_000),...organization,
    }).strict(),
  },
  update_save:{
    description:'Edit an owned save using its latest revision: title, note, summary, category, generated tags, personal userTags, and folder. tags and userTags are separate editable arrays; [] clears one set and omitted fields are preserved. Each set allows 20 tags of 40 characters. Content and generated-tag edits wait for basic processing and cancel stale hosted work. Original source content is preserved.',
    scope:'library:write' as const,
    schema:z.object({
      id,expectedRevision:z.number().int().nonnegative(),sourceTitle:optionalText(1000),noteText:optionalText(50_000),
      summary:optionalText(2000),category:z.string().trim().min(1).max(80).nullable().optional(),tags:z.array(z.string().min(1).max(40)).max(20).optional(),...organization,
    }).strict().refine(value=>Object.keys(value).some(key=>key!=='id'&&key!=='expectedRevision'),{message:'Include at least one field to update.'}),
  },
} as const;

export type McpWriteName=keyof typeof mcpWriteSpecs;
export type McpWriteLimits={globalMaxBytes:number;globalMaxCaptures:number};

const byteLength=(value:string|null|undefined)=>Buffer.byteLength(value||'','utf8');
const has=(value:Record<string,unknown>,key:string)=>Object.prototype.hasOwnProperty.call(value,key);

function capture(db:Database,owner:string,id:string){
  const row=db.query(`SELECT c.*,${preservedMediaColumns('c')},
    (SELECT name FROM customer_folders WHERE id=c.folder_id AND account_id=c.account_id) folder_name,
    (SELECT 1 FROM customer_derivatives WHERE capture_id=c.id AND account_id=c.account_id AND kind='preview') has_derived_preview,
    (SELECT json_extract(source_json,'$.imageUrl') FROM customer_processing_results WHERE capture_id=c.id AND account_id=c.account_id) generated_image_url
    FROM customer_captures c WHERE c.id=? AND c.account_id=?`).get(id,owner) as CustomerCaptureRow|null;
  if(!row)moduleFail(404,'not_found','Saved item not found.');
  return row;
}

function verifyAccess(expected:AgentAccess,authorize:()=>AgentAccess){
  const current=authorize();
  if(current.id!==expected.id||current.accountId!==expected.accountId)moduleFail(401,'agent_unauthorized','This agent connection changed. Reconnect before writing.');
  return current;
}

function agentProvenance(value:Record<string,any>,capturedAt:number){
  const url=value.sourceUrl??null;
  return {
    schemaVersion:1,captureMethod:'agent-create',pageUrl:url,canonicalUrl:null,pageTitle:value.sourceTitle??null,siteName:null,
    description:null,authors:[],publishedAt:null,modifiedAt:null,language:null,leadImageUrl:null,faviconUrl:null,targetUrl:url,
    headings:[],capturedAt,extractedAt:capturedAt,extractorVersion:1,contentHash:null,
    extractionStatus:url&&!value.articleText?'partial':'complete',extractionError:null,sourceApplication:'foundkeep-mcp',
  };
}

export function cancelHostedJobs(db:Database,owner:string,captureId:string,updatedAt:number){
  const active=db.query("SELECT cycle,credit FROM customer_processing_jobs WHERE account_id=? AND capture_id=? AND status IN ('pending','running','paused')")
    .all(owner,captureId) as {cycle:string;credit:number}[];
  if(!active.length)return;
  db.query("UPDATE customer_processing_jobs SET status='cancelled',credit=0,error=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE account_id=? AND capture_id=? AND status IN ('pending','running','paused')")
    .run(updatedAt,owner,captureId);
  const releases=new Map<string,number>();
  for(const job of active)if(job.credit===1)releases.set(job.cycle,(releases.get(job.cycle)||0)+1);
  for(const [cycle,count] of releases)db.query('UPDATE customer_processing_usage SET reserved=MAX(0,reserved-?) WHERE account_id=? AND cycle=?').run(count,owner,cycle);
}

export function callMcpWrite(db:Database,name:McpWriteName,value:Record<string,any>,expected:AgentAccess,authorize:()=>AgentAccess,limits:McpWriteLimits){
  return db.transaction(()=>{
    const current=verifyAccess(expected,authorize),owner=current.accountId;
    if(name==='create_save'){
      const existing=db.query('SELECT id FROM customer_captures WHERE account_id=? AND client_id=?').get(owner,value.clientId) as {id:string}|null;
      if(existing)return {capture:customerCaptureDto(capture(db,owner,existing.id)),duplicate:true};
      const organizationValue=captureOrganization(db,owner,value);
      const now=Date.now(),provenanceJson=JSON.stringify(normalizeProvenance(agentProvenance(value,now),now));
      const storageBytes=[value.clientId,value.sourceUrl,value.sourceTitle,value.selectionText,value.noteText,value.articleText,provenanceJson]
        .reduce((total,item)=>total+byteLength(item),0)+organizationBytes(organizationValue.folderId,organizationValue.manualTags);
      const usage=db.query('SELECT COUNT(*) captures,COALESCE(SUM(storage_bytes),0) bytes FROM customer_captures WHERE account_id=?').get(owner) as {captures:number;bytes:number};
      const plan=accountPlan(db,owner);
      if(usage.captures>=plan.limits.maxCaptures||usage.bytes+storageBytes>plan.limits.maxBytes)moduleFail(409,'quota_exceeded','Your Foundkeep storage is full. Export or delete some captures to continue.');
      const global=db.query('SELECT COUNT(*) captures,COALESCE(SUM(storage_bytes),0) bytes FROM customer_captures').get() as {captures:number;bytes:number};
      if(global.captures>=limits.globalMaxCaptures||global.bytes+storageBytes>limits.globalMaxBytes)moduleFail(503,'storage_unavailable','Foundkeep storage is temporarily full. Try saving again later.');
      const saveId=crypto.randomUUID();
      db.query(`INSERT INTO customer_captures(id,account_id,client_id,type,status,source_url,source_title,selection_text,note_text,article_text,
        storage_bytes,captured_at,created_at,updated_at,provenance_json,folder_id,manual_tags)
        VALUES(?,?,?,?,'done',?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(saveId,owner,value.clientId,value.type,value.sourceUrl??null,value.sourceTitle??null,value.selectionText??null,
          value.noteText??null,value.articleText??null,storageBytes,now,now,now,provenanceJson,organizationValue.folderId,organizationValue.manualTags);
      enqueuePreservation(db,owner,saveId,value.sourceUrl??null);
      return {capture:customerCaptureDto(capture(db,owner,saveId)),duplicate:false};
    }

    const row=capture(db,owner,value.id);
    if(row.updated_at!==value.expectedRevision)moduleFail(409,'revision_conflict','This save changed. Read it again before editing.');
    const editsDetails=['sourceTitle','noteText','summary','category','tags'].some(key=>has(value,key));
    const basicBusy=row.status==='pending'||row.status==='processing'||row.status==='failed'&&row.enrich_attempts<3;
    if(editsDetails&&basicBusy)moduleFail(409,'capture_busy','This save is still being organized. Read it again after processing finishes.');
    const organizationValue=captureOrganization(db,owner,value,row);
    const sourceTitle=has(value,'sourceTitle')?value.sourceTitle:row.source_title;
    const noteText=has(value,'noteText')?value.noteText:row.note_text;
    const summary=has(value,'summary')?value.summary:row.summary;
    const category=has(value,'category')?value.category:row.category;
    const tags=has(value,'tags')?JSON.stringify(normalizeCaptureTags(value.tags)):row.tags;
    const delta=byteLength(sourceTitle)+byteLength(noteText)+byteLength(summary)+byteLength(category)
      -byteLength(row.source_title)-byteLength(row.note_text)-byteLength(row.summary)-byteLength(row.category)
      +byteLength(tags==='[]'?null:tags)-byteLength(row.tags==='[]'?null:row.tags)
      +organizationBytes(organizationValue.folderId,organizationValue.manualTags)-organizationBytes(row.folder_id,row.manual_tags);
    if(delta>0){
      const plan=accountPlan(db,owner),usage=db.query('SELECT COALESCE(SUM(storage_bytes),0) bytes FROM customer_captures WHERE account_id=?').get(owner) as {bytes:number};
      if(usage.bytes+delta>plan.limits.maxBytes)moduleFail(409,'quota_exceeded','Your Foundkeep storage is full. Export or delete some captures to continue.');
      const global=db.query('SELECT COALESCE(SUM(storage_bytes),0) bytes FROM customer_captures').get() as {bytes:number};
      if(global.bytes+delta>limits.globalMaxBytes)moduleFail(503,'storage_unavailable','Foundkeep storage is temporarily full. Try saving again later.');
    }
    const updatedAt=Math.max(Date.now(),row.updated_at+1);
    if(sourceTitle!==row.source_title||noteText!==row.note_text||summary!==row.summary||category!==row.category||has(value,'tags'))cancelHostedJobs(db,owner,row.id,updatedAt);
    const updated=db.query(`UPDATE customer_captures SET source_title=?,note_text=?,summary=?,category=?,tags=?,folder_id=?,manual_tags=?,
      storage_bytes=MAX(0,storage_bytes+?),updated_at=? WHERE id=? AND account_id=? AND updated_at=?`)
      .run(sourceTitle,noteText,summary,category,tags,organizationValue.folderId,organizationValue.manualTags,delta,updatedAt,row.id,owner,value.expectedRevision);
    if(!updated.changes)moduleFail(409,'revision_conflict','This save changed. Read it again before editing.');
    return {capture:customerCaptureDto(capture(db,owner,row.id))};
  }).immediate();
}
import {enqueuePreservation} from './customer-preservation.ts';
