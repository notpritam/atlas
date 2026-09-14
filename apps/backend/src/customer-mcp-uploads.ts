import {z} from 'zod';
import {createHash} from 'node:crypto';
import {appendFileSync,closeSync,mkdtempSync,openSync,readSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Database} from 'bun:sqlite';
import type {AgentAccess} from './customer-agent-access.ts';
import type {AgentRequest} from './customer-mcp-catalog.ts';
import {moduleFail} from './customer-modules.ts';
import {MAX_CUSTOMER_FILE_BYTES} from './customer-files.ts';
import {captureOrganization} from './customer-organization.ts';
import {accountPlan} from './customer-plans.ts';
import {customerCaptureDto,type CustomerCaptureRow} from './customer.ts';
import {config} from './config.ts';

const MAX_CHUNK=256*1024,TTL=30*60_000;
const uploadId=z.string().uuid();
export const mcpUploadSpecs={
 begin_file_upload:{description:'Begin an owned file upload of up to 50 MiB. Supply byte size and SHA-256 of the complete file. Then append base64 chunks and finish. Staging expires in 30 minutes or on server restart; retry with the same clientId to avoid duplicate saves. Metadata must fit 16 KiB.',scope:'library:write' as const,schema:z.object({clientId:z.string().min(1).max(128),type:z.enum(['image','video','audio','document','file']),fileName:z.string().min(1).max(500),bytes:z.number().int().min(1).max(MAX_CUSTOMER_FILE_BYTES),sha256:z.string().regex(/^[a-f0-9]{64}$/),sourceTitle:z.string().max(1000).nullable().optional(),sourceUrl:z.string().max(4096).nullable().optional(),noteText:z.string().max(50000).nullable().optional(),folderId:z.string().uuid().nullable().optional(),userTags:z.array(z.string().min(1).max(40)).max(20).optional()}).strict()},
 append_file_upload:{description:'Append up to 256 KiB of canonical base64 at the exact received-byte offset. Retrying the same bytes at an earlier offset is safe; different bytes are rejected.',scope:'library:write' as const,schema:z.object({uploadId,offset:z.number().int().min(0).max(MAX_CUSTOMER_FILE_BYTES),base64:z.string().min(4).max(Math.ceil(MAX_CHUNK/3)*4)}).strict()},
 finish_file_upload:{description:'Verify the complete file checksum and save it through the same owned file-ingestion pipeline as mobile. Storage/type limits apply. Source bytes are never executed.',scope:'library:write' as const,schema:z.object({uploadId}).strict()},
 cancel_file_upload:{description:'Discard an unfinished staged upload. A file already saved in the library is kept.',scope:'library:write' as const,schema:z.object({uploadId}).strict()},
};
type Upload={db:Database;owner:string;agent:string;directory:string;path:string;metadata:Record<string,unknown>;size:number;sha256:string;received:number;expiresAt:number;busy:boolean};
const uploads=new Map<string,Upload>();
function remove(id:string){const upload=uploads.get(id);if(upload){uploads.delete(id);rmSync(upload.directory,{recursive:true,force:true});}}
export function discardAgentUploads(db:Database,owner:string){for(const [id,upload] of uploads)if(upload.db===db&&upload.owner===owner)remove(id);}
function sweep(){for(const [id,upload] of uploads)if(!upload.busy&&upload.expiresAt<Date.now())remove(id);}
const timer=setInterval(sweep,60_000);timer.unref();
function checksum(path:string){const fd=openSync(path,'r'),buffer=Buffer.allocUnsafe(64*1024),hash=createHash('sha256');try{let count;while((count=readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,count));return hash.digest('hex');}finally{closeSync(fd);}}

export async function callMcpUpload(db:Database,name:keyof typeof mcpUploadSpecs,value:Record<string,any>,dispatch:AgentRequest,authorize:()=>AgentAccess,globalMaxBytes:number){
 const current=authorize();sweep();
 if(name==='begin_file_upload'){
  const existing=db.query('SELECT * FROM customer_captures WHERE account_id=? AND client_id=?').get(current.accountId,value.clientId) as CustomerCaptureRow|null;
  if(existing)return {capture:customerCaptureDto(existing),duplicate:true};
  captureOrganization(db,current.accountId,value);
  if(value.sourceUrl){try{const url=new URL(value.sourceUrl);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw 0;}catch{moduleFail(400,'invalid_url','Use a credential-free HTTP or HTTPS source URL.');}}
  const {bytes,sha256,...metadata}=value;
  if(Buffer.byteLength(JSON.stringify(metadata),'utf8')>16*1024)moduleFail(400,'metadata_too_large','File metadata must fit 16 KiB. Add a longer annotation after saving.');
  const pending=[...uploads.values()].filter(upload=>upload.db===db),owned=pending.filter(upload=>upload.owner===current.accountId);
  const usage=db.query('SELECT COALESCE(SUM(storage_bytes),0) total,COALESCE(SUM(CASE WHEN account_id=? THEN storage_bytes ELSE 0 END),0) owned FROM customer_captures').get(current.accountId) as {total:number;owned:number};
  const staged=pending.reduce((n,upload)=>n+upload.size,0),ownedStaged=owned.reduce((n,upload)=>n+upload.size,0);
  if(owned.length>=2||uploads.size>=20||staged+bytes>200*1024**2)moduleFail(429,'upload_limit','Finish or cancel an earlier file upload first.');
  if(usage.owned+ownedStaged+bytes>accountPlan(db,current.accountId).limits.maxBytes||usage.total+staged+bytes>globalMaxBytes)moduleFail(413,'storage_full','There is not enough space for this file.');
  const id=crypto.randomUUID(),directory=mkdtempSync(join(tmpdir(),'foundkeep-mcp-upload-')),path=join(directory,'source');
  writeFileSync(path,new Uint8Array(),{mode:0o600,flag:'wx'});
  const expiresAt=Date.now()+TTL;
  uploads.set(id,{db,owner:current.accountId,agent:current.id,directory,path,metadata,size:bytes,sha256,received:0,expiresAt,busy:false});
  return {uploadId:id,received:0,bytes,maxChunkBytes:MAX_CHUNK,expiresAt};
 }
 const upload=uploads.get(value.uploadId);
 if(!upload||upload.db!==db||upload.owner!==current.accountId||upload.agent!==current.id)moduleFail(404,'upload_not_found','This upload is unavailable or expired. Begin again with the same clientId.');
 if(upload.busy)moduleFail(409,'upload_busy','This file is being committed. Wait before retrying.');
 if(name==='cancel_file_upload'){remove(value.uploadId);return {cancelled:true};}
 if(name==='append_file_upload'){
  const data=Buffer.from(value.base64,'base64');
  if(!data.length||data.length>MAX_CHUNK||data.toString('base64')!==value.base64)moduleFail(400,'invalid_chunk','Use canonical base64 for up to 256 KiB.');
  if(value.offset>upload.received||value.offset+data.length>upload.size)moduleFail(409,'invalid_offset','Use the current upload offset and declared file size.');
  if(value.offset<upload.received){
   if(value.offset+data.length>upload.received)moduleFail(409,'invalid_offset','A retried chunk must be fully within previously received bytes.');
   const previous=Buffer.alloc(data.length),fd=openSync(upload.path,'r');
   try{readSync(fd,previous,0,previous.length,value.offset);}finally{closeSync(fd);}
   if(!previous.equals(data))moduleFail(409,'chunk_changed','This offset already contains different bytes. Start a new upload.');
  }else{appendFileSync(upload.path,data);upload.received+=data.length;}
  return {uploadId:value.uploadId,received:upload.received,bytes:upload.size};
 }
 if(upload.received!==upload.size)moduleFail(409,'upload_incomplete','Upload every byte before finishing.');
 if(checksum(upload.path)!==upload.sha256)moduleFail(400,'checksum_mismatch','The file does not match its SHA-256. Cancel and upload it again.');
 upload.busy=true;
 try{
  const response=await dispatch(new Request(new URL('/mobile/captures/file',config.customerOrigin).href,{method:'POST',headers:{'Content-Type':'application/octet-stream','Content-Length':String(upload.size),'X-Foundkeep-Capture':Buffer.from(JSON.stringify(upload.metadata)).toString('base64url')},body:Bun.file(upload.path).stream()}),authorize);
  const result=await response.json() as any;
  if(!response.ok)moduleFail(([400,401,403,404,409,413,429,503].includes(response.status)?response.status:400) as any,result.error||'upload_failed',result.message||'The file could not be saved.');
  remove(value.uploadId);return result;
 }finally{upload.busy=false;}
}
