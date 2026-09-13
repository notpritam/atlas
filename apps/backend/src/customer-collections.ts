import type {Hono} from 'hono';
import type {Database} from 'bun:sqlite';
import type {Auth,CustomerEnv} from './customer';
import {moduleFail as fail,type CustomerServices,type CustomerContext as C} from './customer-modules';
import {accountPlan} from './customer-plans';

type Collection={id:string;owner_id:string;slug:string;title:string;description:string;tags:string;rules:string;kind:'personal'|'group';visibility:'public'|'private';submission_policy:'owner'|'members'|'anyone';require_approval:number;created_at:number;updated_at:number};
type Role='owner'|'moderator'|'contributor'|'viewer'|null;
type Entry={id:string;collection_id:string;contributor_id:string;capture_id:string|null;client_id:string;title:string;url:string|null;body:string;tags:string;share_image:number;status:'pending'|'approved'|'rejected';created_at:number;updated_at:number};
const raster=new Set(['image/png','image/jpeg','image/webp','image/gif']);
function text(value:unknown,max:number,label:string,required=false) {
 if(value===undefined&&!required)return '';
 if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)||(required&&!value.trim()))fail(400,'invalid_collection',`${label} must contain ${required?'1 to':'at most'} ${max} characters.`);
 return value.trim();
}
function choice<T extends string>(value:unknown,allowed:readonly T[],fallback:T):T {if(value===undefined)return fallback;if(!allowed.includes(value as T))fail(400,'invalid_collection','Choose a valid collection setting.');return value as T;}
function flag(value:unknown,fallback:boolean) {if(value===undefined)return fallback;if(typeof value!=='boolean')fail(400,'invalid_collection','Choose yes or no.');return value;}
function tags(value:unknown) {if(value===undefined)return '[]';if(!Array.isArray(value)||value.length>10)fail(400,'invalid_collection','Choose up to 10 tags.');return JSON.stringify([...new Set(value.map(v=>text(v,40,'Tag',true)))]);}
function source(value:unknown) {if(value===undefined||value===null||value==='')return null;const raw=text(value,2048,'Source URL',true);try{const u=new URL(raw);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw 0;return u.href;}catch{fail(400,'invalid_collection','Use a full http or https link without embedded credentials.');}}
function pagination(c:C) {const raw=c.req.query('cursor')||'0';if(!/^\d{1,6}$/.test(raw)||Number(raw)>100000)fail(400,'invalid_cursor','Use a valid page cursor.');return Number(raw);}

export function registerCustomerCollections(app:Hono<CustomerEnv>,db:Database,services:CustomerServices,optionalAuth:(c:C)=>Auth|null) {
 const {auth,jsonBody}=services;
 const get=(id:string)=>db.query('SELECT * FROM customer_collections WHERE id=?').get(id) as Collection|null;
 const role=(row:Collection,accountId?:string):Role=>!accountId?null:row.owner_id===accountId?'owner':(db.query('SELECT role FROM customer_collection_members WHERE collection_id=? AND account_id=? AND accepted=1').get(row.id,accountId) as {role:Role}|null)?.role||null;
 const moderator=(r:Role)=>r==='owner'||r==='moderator';
 function read(id:string,accountId?:string) {const row=get(id);if(!row||(row.visibility!=='public'&&!role(row,accountId)))fail(404,'collection_not_found','Collection not found.');return row;}
 function owned(id:string,accountId:string) {const row=read(id,accountId);if(row.owner_id!==accountId)fail(403,'collection_owner_required','Only the owner can change this collection.');return row;}
 function canSubmit(row:Collection,r:Role) {return moderator(r)||(row.submission_policy==='members'&&r==='contributor')||(row.visibility==='public'&&row.submission_policy==='anyone'&&r!=='viewer');}
 function publication(row:Collection,accountId:string) {const r=role(row,accountId);if(!canSubmit(row,r))fail(403,'collection_contribution_closed','This collection is not accepting contributions from your account.');return row.require_approval&&!moderator(r)?'pending':'approved';}
 function pro(accountId:string) {if(!accountPlan(db,accountId).pro)fail(403,'pro_required','Pro is required to create groups and invite group members. Joining and following are free.');}
 function card(row:Collection,accountId?:string) {
  const r=role(row,accountId),counts=db.query("SELECT COUNT(*) count FROM customer_collection_entries WHERE collection_id=? AND status='approved'").get(row.id) as {count:number};
  return {id:row.id,slug:row.slug,title:row.title,description:row.description,tags:JSON.parse(row.tags),rules:row.rules,kind:row.kind,visibility:row.visibility,submissionPolicy:row.submission_policy,requireApproval:!!row.require_approval,createdAt:row.created_at,updatedAt:row.updated_at,
   ownerName:(db.query('SELECT name FROM customer_accounts WHERE id=?').get(row.owner_id) as {name:string}).name,
   entries:counts.count,followers:(db.query('SELECT COUNT(*) count FROM customer_collection_follows WHERE collection_id=?').get(row.id) as {count:number}).count,
   role:r,canSubmit:!!accountId&&canSubmit(row,r),canModerate:moderator(r),following:!!accountId&&!!db.query('SELECT 1 FROM customer_collection_follows WHERE collection_id=? AND account_id=?').get(row.id,accountId)};
 }
 function entryDto(row:Entry,accountId?:string,canModerate=false) {
  return {id:row.id,title:row.title,url:row.url,body:row.body,tags:JSON.parse(row.tags),status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,
   authorName:(db.query('SELECT name FROM customer_accounts WHERE id=?').get(row.contributor_id) as {name:string})?.name||'Collector',
   imageUrl:row.share_image?`/api/collections/${row.collection_id}/entries/${row.id}/image`:null,
   canRemove:canModerate||row.contributor_id===accountId,canMove:row.contributor_id===accountId};
 }
 function detail(c:C,row:Collection,accountId?:string) {
  const r=role(row,accountId),moderate=moderator(r),offset=pagination(c),queue=c.req.query('view')==='pending';
  if(queue&&!moderate)fail(403,'moderation_required','Only collection moderators can open the approval queue.');
  const predicate=queue?"status='pending'":moderate?'1=1':"(status='approved' OR contributor_id=?)";
  const rows=db.query(`SELECT * FROM customer_collection_entries WHERE collection_id=? AND ${predicate} ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET ?`).all(row.id,...(!queue&&!moderate?[accountId||'']:[]),offset) as Entry[];
  const pending=moderate?(db.query("SELECT COUNT(*) count FROM customer_collection_entries WHERE collection_id=? AND status='pending'").get(row.id) as {count:number}).count:0;
  return {collection:card(row,accountId),entries:rows.slice(0,24).map(e=>entryDto(e,accountId,moderate)),nextCursor:rows.length>24?String(offset+24):null,pending};
 }
 // Reauthenticate after reading a body: a logout, account switch, or revocation
 // while an upload is in flight must never authorize a later mutation.
 async function write(c:C,fn:(current:Auth,body:Record<string,unknown>)=>Response) {
  const initial=auth(c),body=await jsonBody(c,24576),current=auth(c);
  if(initial.account.id!==current.account.id||initial.credentialId!==current.credentialId)fail(401,'unauthorized','Your account changed. Sign in again.');
  services.rate('collections-write:'+current.account.id,120,60000);
  return db.transaction(()=>fn(current,body))();
 }
 function fields(body:Record<string,unknown>,current?:Collection) {
  const visibility=choice(body.visibility,['private','public'],current?.visibility||'private');
  const submissionPolicy=choice(body.submissionPolicy,['owner','members','anyone'],current?.submission_policy||'owner');
  if(visibility==='private'&&submissionPolicy==='anyone')fail(400,'invalid_collection','Private collections accept invited contributors only.');
  const kind=current?.kind||choice(body.kind,['personal','group'],'personal');
  if(kind==='personal'&&submissionPolicy==='members')fail(400,'invalid_collection','Choose a group collection to invite contributors.');
  return {title:'title' in body||!current?text(body.title,100,'Title',true):current.title,description:'description' in body?text(body.description,1000,'Description'):current?.description||'',tags:'tags' in body?tags(body.tags):current?.tags||'[]',rules:'rules' in body?text(body.rules,2000,'Rules'):current?.rules||'',visibility,submissionPolicy,requireApproval:flag(body.requireApproval,current?!!current.require_approval:true),kind};
 }
 app.get('/public/collections',c=>{
  const q=text(c.req.query('q')||'',100,'Search'),offset=pagination(c),pattern='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
  const rows=db.query("SELECT * FROM customer_collections WHERE visibility='public' AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\') ORDER BY updated_at DESC,id DESC LIMIT 25 OFFSET ?").all(pattern,pattern,pattern,offset) as Collection[];
  return c.json({collections:rows.slice(0,24).map(row=>card(row)),nextCursor:rows.length>24?String(offset+24):null});
 });
 app.get('/public/collections/:slug',c=>{const row=db.query("SELECT * FROM customer_collections WHERE slug=? AND visibility='public'").get(c.req.param('slug')) as Collection|null;if(!row)fail(404,'collection_not_found','Collection not found.');return c.json(detail(c,row));});
 app.get('/collections',c=>{
  const current=auth(c),id=current.account.id;
  const rows=db.query(`SELECT DISTINCT c.* FROM customer_collections c LEFT JOIN customer_collection_members m ON m.collection_id=c.id AND m.account_id=? AND m.accepted=1 LEFT JOIN customer_collection_follows f ON f.collection_id=c.id AND f.account_id=?
   WHERE c.owner_id=? OR m.account_id IS NOT NULL OR (f.account_id IS NOT NULL AND c.visibility='public') ORDER BY c.updated_at DESC,c.id LIMIT 300`).all(id,id,id) as Collection[];
  const invitations=db.query(`SELECT c.id,c.title,c.slug,m.role FROM customer_collection_members m JOIN customer_collections c ON c.id=m.collection_id WHERE m.account_id=? AND m.accepted=0 ORDER BY m.created_at DESC LIMIT 100`).all(id);
  return c.json({collections:rows.map(row=>card(row,id)),invitations,canCreateGroup:accountPlan(db,id).pro});
 });
 app.post('/collections',c=>write(c,({account},body)=>{
  const f=fields(body);if(f.kind==='group')pro(account.id);
  const slug=text(body.slug,64,'Collection URL',true);if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length<3)fail(400,'invalid_slug','Use 3–64 lowercase letters, numbers and single hyphens.');
  if(db.query('SELECT 1 FROM customer_collections WHERE slug=?').get(slug))fail(409,'slug_taken','That collection URL is already in use. Choose another.');
  if((db.query('SELECT COUNT(*) count FROM customer_collections WHERE owner_id=?').get(account.id) as {count:number}).count>=100)fail(409,'collection_limit','You can own up to 100 collections.');
  const id=crypto.randomUUID(),now=Date.now();
  db.query('INSERT INTO customer_collections(id,owner_id,slug,title,description,tags,rules,kind,visibility,submission_policy,require_approval,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,account.id,slug,f.title,f.description,f.tags,f.rules,f.kind,f.visibility,f.submissionPolicy,Number(f.requireApproval),now,now);
  return c.json({collection:card(get(id)!,account.id)},201);
 }));
 app.get('/collections/by-slug/:slug',c=>{const current=optionalAuth(c),row=db.query('SELECT id FROM customer_collections WHERE slug=?').get(c.req.param('slug')) as {id:string}|null;if(!row)fail(404,'collection_not_found','Collection not found.');return c.json(detail(c,read(row.id,current?.account.id),current?.account.id));});
 app.get('/collections/:id',c=>{const current=auth(c);return c.json(detail(c,read(c.req.param('id'),current.account.id),current.account.id));});
 app.patch('/collections/:id',c=>write(c,({account},body)=>{const row=owned(c.req.param('id'),account.id),f=fields(body,row);db.query('UPDATE customer_collections SET title=?,description=?,tags=?,rules=?,visibility=?,submission_policy=?,require_approval=?,updated_at=? WHERE id=?').run(f.title,f.description,f.tags,f.rules,f.visibility,f.submissionPolicy,Number(f.requireApproval),Date.now(),row.id);return c.json({collection:card(get(row.id)!,account.id)});}));
 app.delete('/collections/:id',c=>{const current=auth(c),row=owned(c.req.param('id'),current.account.id);db.query('DELETE FROM customer_collections WHERE id=?').run(row.id);return c.json({ok:true});});
 app.post('/collections/:id/follow',c=>write(c,({account})=>{const row=read(c.req.param('id'),account.id);db.query('INSERT OR IGNORE INTO customer_collection_follows(collection_id,account_id,created_at) VALUES(?,?,?)').run(row.id,account.id,Date.now());return c.json({following:true});}));
 app.delete('/collections/:id/follow',c=>{const current=auth(c);db.query('DELETE FROM customer_collection_follows WHERE collection_id=? AND account_id=?').run(c.req.param('id'),current.account.id);return c.json({following:false});});
 app.get('/collections/:id/members',c=>{const current=auth(c),row=owned(c.req.param('id'),current.account.id);return c.json({members:db.query('SELECT m.account_id id,a.name,a.email,m.role,m.accepted FROM customer_collection_members m JOIN customer_accounts a ON a.id=m.account_id WHERE m.collection_id=? ORDER BY m.created_at').all(row.id)});});
 app.post('/collections/:id/members',c=>write(c,({account},body)=>{
  const row=owned(c.req.param('id'),account.id);if(row.kind!=='group')fail(403,'group_required','Create a group collection to invite members.');
  const email=text(body.email,254,'Email',true).toLowerCase(),r=choice(body.role,['viewer','contributor','moderator'],'contributor');
  const target=db.query('SELECT id FROM customer_accounts WHERE email=?').get(email) as {id:string}|null;if(!target)fail(404,'account_not_found','Ask this person to create a Foundkeep account first.');if(target.id===account.id)fail(400,'already_owner','You already own this collection.');
  const existing=db.query('SELECT 1 FROM customer_collection_members WHERE collection_id=? AND account_id=?').get(row.id,target.id);
  if(!existing)pro(account.id);
  if(!existing&&(db.query('SELECT COUNT(*) count FROM customer_collection_members WHERE collection_id=?').get(row.id) as {count:number}).count>=100)fail(409,'member_limit','A group can have up to 100 invited members.');
  db.query('INSERT INTO customer_collection_members(collection_id,account_id,role,created_at) VALUES(?,?,?,?) ON CONFLICT(collection_id,account_id) DO UPDATE SET role=excluded.role').run(row.id,target.id,r,Date.now());return c.json({ok:true});
 }));
 app.post('/collections/:id/invitation',c=>write(c,({account},body)=>{const id=c.req.param('id');if(!db.query('SELECT 1 FROM customer_collection_members WHERE collection_id=? AND account_id=?').get(id,account.id))fail(404,'invitation_not_found','Invitation not found.');if(flag(body.accept,false))db.query('UPDATE customer_collection_members SET accepted=1 WHERE collection_id=? AND account_id=?').run(id,account.id);else db.query('DELETE FROM customer_collection_members WHERE collection_id=? AND account_id=?').run(id,account.id);return c.json({ok:true});}));
 app.delete('/collections/:id/members/:accountId',c=>{const current=auth(c),id=c.req.param('id'),target=c.req.param('accountId');if(target!==current.account.id)owned(id,current.account.id);db.transaction(()=>{db.query('DELETE FROM customer_collection_members WHERE collection_id=? AND account_id=?').run(id,target);db.query('DELETE FROM customer_collection_follows WHERE collection_id=? AND account_id=?').run(id,target);})();return c.json({ok:true});});
 app.post('/collections/:id/entries',c=>write(c,({account},body)=>{
  const row=read(c.req.param('id'),account.id),status=publication(row,account.id);
  const clientId=text(body.clientId,80,'Submission ID',true);if(!/^[A-Za-z0-9_-]+$/.test(clientId))fail(400,'invalid_entry','Use a valid submission ID.');
  const existing=db.query('SELECT * FROM customer_collection_entries WHERE contributor_id=? AND client_id=?').get(account.id,clientId) as Entry|null;
  if(existing){if(existing.collection_id!==row.id)fail(409,'entry_moved','This submission already belongs to another collection.');return c.json({entry:entryDto(existing,account.id,moderator(role(row,account.id)))});}
  const title=text(body.title,200,'Entry title',true),url=source(body.url),description=text(body.body,5000,'Entry text'),entryTags=tags(body.tags),shareImage=flag(body.shareImage,false);
  const captureId=body.captureId?text(body.captureId,80,'Capture ID',true):null;
  if(captureId){const capture=db.query('SELECT blob_mime FROM customer_captures WHERE id=? AND account_id=?').get(captureId,account.id) as {blob_mime:string|null}|null;if(!capture)fail(404,'capture_not_found','Capture not found.');if(shareImage&&!raster.has(capture.blob_mime||''))fail(400,'image_unavailable','This capture has no shareable saved image.');}else if(shareImage)fail(400,'image_unavailable','Choose one of your saved images first.');
  if((db.query('SELECT COUNT(*) count FROM customer_collection_entries WHERE contributor_id=?').get(account.id) as {count:number}).count>=10000||(db.query('SELECT COUNT(*) count FROM customer_collection_entries WHERE collection_id=?').get(row.id) as {count:number}).count>=5000)fail(409,'entry_limit','This collection or account has reached its submission limit.');
  const id=crypto.randomUUID(),now=Date.now();db.query('INSERT INTO customer_collection_entries(id,collection_id,contributor_id,capture_id,client_id,title,url,body,tags,share_image,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,row.id,account.id,captureId,clientId,title,url,description,entryTags,Number(shareImage),status,now,now);
  db.query('UPDATE customer_collections SET updated_at=? WHERE id=?').run(now,row.id);
  return c.json({entry:entryDto(db.query('SELECT * FROM customer_collection_entries WHERE id=?').get(id) as Entry,account.id,moderator(role(row,account.id)))},201);
 }));
 function findEntry(row:Collection,id:string,accountId?:string) {const e=db.query('SELECT * FROM customer_collection_entries WHERE collection_id=? AND id=?').get(row.id,id) as Entry|null;if(!e||(e.status!=='approved'&&e.contributor_id!==accountId&&!moderator(role(row,accountId))))fail(404,'entry_not_found','Entry not found.');return e;}
 app.post('/collections/:id/entries/:entryId/moderate',c=>write(c,({account},body)=>{const row=read(c.req.param('id'),account.id);if(!moderator(role(row,account.id)))fail(403,'moderation_required','Only collection moderators can approve submissions.');const e=findEntry(row,c.req.param('entryId'),account.id),status=choice(body.status,['approved','rejected'],'rejected');db.query('UPDATE customer_collection_entries SET status=?,updated_at=? WHERE id=?').run(status,Date.now(),e.id);db.query('UPDATE customer_collections SET updated_at=? WHERE id=?').run(Date.now(),row.id);return c.json({ok:true});}));
 app.delete('/collections/:id/entries/:entryId',c=>{const current=auth(c),row=read(c.req.param('id'),current.account.id),e=findEntry(row,c.req.param('entryId'),current.account.id);if(e.contributor_id!==current.account.id&&!moderator(role(row,current.account.id)))fail(403,'entry_owner_required','Only the contributor or a moderator can remove this entry.');db.query('DELETE FROM customer_collection_entries WHERE id=?').run(e.id);return c.json({ok:true});});
 app.post('/collections/:id/entries/:entryId/move',c=>write(c,({account},body)=>{
  const target=read(text(body.collectionId,80,'Destination',true),account.id),status=publication(target,account.id),id=c.req.param('entryId');
  const already=db.query('SELECT * FROM customer_collection_entries WHERE id=? AND collection_id=? AND contributor_id=?').get(id,target.id,account.id) as Entry|null;if(already)return c.json({entry:entryDto(already,account.id)});
  const from=read(c.req.param('id'),account.id),e=findEntry(from,id,account.id);if(e.contributor_id!==account.id)fail(403,'entry_owner_required','Only the contributor can move an entry to another audience.');
  if((db.query('SELECT COUNT(*) count FROM customer_collection_entries WHERE collection_id=?').get(target.id) as {count:number}).count>=5000)fail(409,'entry_limit','The destination collection is full.');
  db.query('UPDATE customer_collection_entries SET collection_id=?,status=?,updated_at=? WHERE id=?').run(target.id,status,Date.now(),e.id);db.query('UPDATE customer_collections SET updated_at=? WHERE id IN (?,?)').run(Date.now(),target.id,from.id);return c.json({entry:entryDto({...e,collection_id:target.id,status},account.id)});
 }));
 app.get('/collections/:id/entries/:entryId/image',c=>{
  const current=optionalAuth(c),row=read(c.req.param('id'),current?.account.id),e=findEntry(row,c.req.param('entryId'),current?.account.id);if(!e.share_image||!e.capture_id)fail(404,'image_not_found','Image not found.');
  const capture=db.query('SELECT blob_data,blob_mime FROM customer_captures WHERE id=? AND account_id=?').get(e.capture_id,e.contributor_id) as {blob_data:Uint8Array;blob_mime:string}|null;if(!capture?.blob_data||!raster.has(capture.blob_mime))fail(404,'image_not_found','Image not found.');
  return new Response(capture.blob_data,{headers:{'Content-Type':capture.blob_mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 });
}
