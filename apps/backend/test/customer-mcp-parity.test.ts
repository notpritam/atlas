import {afterEach,beforeEach,expect,test} from 'bun:test';
import {openDb} from '../src/db.ts';
import {createApp} from '../src/app.ts';
import {createAgentToken} from '../src/customer-agent-access.ts';
import {createMcpOperations} from '../src/customer-mcp.ts';
import {createProcessingService,CONSENT_VERSION} from '../src/customer-processing.ts';
import {accountPlan} from '../src/customer-plans.ts';
import {createHash} from 'node:crypto';
import {config} from '../src/config.ts';
import {removeCustomerFile} from '../src/customer-files.ts';
import {createCustomerApi} from '../src/customer.ts';
import {challenge} from '../src/supabase-auth.ts';
import {createPreservationService,preparePreservedCleanup} from '../src/customer-preservation.ts';

let db:ReturnType<typeof openDb>,owner:string,other:string,token:string;
const addAccount=()=>{const id=crypto.randomUUID();db.query("INSERT INTO customer_accounts(id,email,name,password_hash,recovery_hash,created_at) VALUES(?,?,'MCP parity','','',0)").run(id,id+'@example.test');return id;};
beforeEach(()=>{db=openDb(':memory:');owner=addAccount();other=addAccount();token=createAgentToken(db,owner,{name:'Full agent',scopes:['library:read','library:write','files:read']}).token;});
afterEach(()=>db.close());
const ops=()=>createMcpOperations(db,'Bearer '+token);

test('MCP exposes the account, folders, preferences, imports, collections, processing, and file capabilities',()=>{
 const names=ops().list().map(tool=>tool.name);
 for(const name of ['get_account','get_plan','get_preferences','update_preferences','rename_folder','delete_folder','delete_save','preview_import','import_bookmarks','get_graph','related_saves','list_collections','create_collection','update_collection','delete_collection','submit_collection_entry','invite_collection_member','get_processing_settings','configure_processing','get_preservation','preserve_save','read_preserved_file','begin_file_upload','append_file_upload','finish_file_upload','export_account','list_agent_connections','revoke_agent_connection'])expect(names).toContain(name);
 const reader=createMcpOperations(db,'Bearer '+createAgentToken(db,owner,{name:'Reader',scopes:['library:read']}).token);
 expect(reader.list().some(tool=>tool.name==='delete_save'||tool.name==='read_preserved_file'||tool.name==='configure_processing')).toBe(false);
 const deletion=ops().list().find(tool=>tool.name==='delete_save');expect(deletion?.annotations.destructiveHint).toBe(true);
});

test('folder lifecycle and save deletion use owned app handlers and never grant HTTP bearer session access',async()=>{
 const api=ops();const {folder}=await api.call('create_folder',{name:'Reading'}) as any;
 const {capture}=await api.call('create_save',{clientId:'folder-life',type:'note',noteText:'Keep me',folderId:folder.id}) as any;
 const renamed=await api.call('rename_folder',{id:folder.id,name:'Research'}) as any;expect(renamed.folder.name).toBe('Research');
 const stranger=createMcpOperations(db,'Bearer '+createAgentToken(db,other,{name:'Other',scopes:['library:read','library:write']}).token);
 await expect(stranger.call('delete_save',{id:capture.id,expectedRevision:capture.updatedAt})).rejects.toThrow();
 await api.call('delete_folder',{id:folder.id});
 const updated=(await api.call('read_save',{id:capture.id}) as any).capture;expect(updated.folderId).toBeNull();
 await expect(api.call('delete_save',{id:capture.id,expectedRevision:capture.updatedAt})).rejects.toThrow('changed');
 await api.call('delete_save',{id:capture.id,expectedRevision:updated.updatedAt});
 await expect(api.call('read_save',{id:capture.id})).rejects.toThrow('not found');
 const response=await createApp(db).request('/api/me',{headers:{Authorization:'Bearer '+token}});expect(response.status).toBe(401);
});

test('agents can configure preferences and processing without starting AI implicitly',async()=>{
 const api=ops(),current=await api.call('get_preferences',{}) as any;
 const updated=await api.call('update_preferences',{expectedRevision:current.revision,preferences:{...current.preferences,organization:{ocr:false,summaries:false,tags:false}}}) as any;
 expect(updated.preferences.organization.tags).toBe(false);
 await expect(api.call('update_preferences',{expectedRevision:current.revision,preferences:current.preferences})).rejects.toThrow('changed');
 await api.call('configure_processing',{mode:'manual',enabled:false});
 const settings=await api.call('get_processing_settings',{}) as any;expect(settings.enabled).toBe(false);expect(settings.mode).toBe('manual');
 expect((db.query('SELECT COUNT(*) n FROM customer_processing_jobs').get() as any).n).toBe(0);
});

test('agents can toggle a registered owned device without reading or replacing its push credential',async()=>{
 const device=crypto.randomUUID();
 db.query("INSERT INTO customer_connections(id,account_id,name,token_hash,created_at,expires_at,client_kind) VALUES(?,?,'Phone','device-token-hash',0,?,'mobile')").run(device,owner,Date.now()+60000);
 db.query("INSERT INTO customer_push_devices(connection_id,account_id,expo_push_token,enabled,created_at,updated_at) VALUES(?,?,'ExponentPushToken[private-device-token]',1,0,0)").run(device,owner);
 const api=ops();expect(await api.call('get_device_notifications',{id:device})).toEqual({registered:true,enabled:true});
 expect(await api.call('set_device_notifications',{id:device,enabled:false})).toEqual({registered:true,enabled:false});
 expect(await api.call('set_device_notifications',{id:device,enabled:true})).toEqual({registered:true,enabled:true});
 const stranger=createMcpOperations(db,'Bearer '+createAgentToken(db,other,{name:'Other device agent',scopes:['library:read','library:write']}).token);
 await expect(stranger.call('set_device_notifications',{id:device,enabled:false})).rejects.toThrow('not found');
});

test('free accounts can use hosted processing with explicit consent and bounded allowance',async()=>{
 const {capture}=await ops().call('create_save',{clientId:'free-processing',type:'note',noteText:'Organize this'}) as any;
 const processing=createProcessingService(db,{ai:{available:true,model:'test',organize:async()=>({summary:'Useful summary',category:'Research',tags:['Useful'],relatedIds:[]})}});
 expect(accountPlan(db,owner).features.managedProcessing).toBe(true);
 expect(()=>processing.enqueue(owner,capture.id,'agent')).toThrow('Enable managed processing');
 processing.configure(owner,{enabled:true,mode:'manual',consentVersion:CONSENT_VERSION,monthlyLimit:1});
 processing.enqueue(owner,capture.id,'agent');await processing.tick();
 expect((await ops().call('read_save',{id:capture.id}) as any).capture.tags).toEqual(['Useful']);
 expect(processing.settings(owner).usage).toMatchObject({limit:500,used:1,reserved:0});
});

test('collection collaboration works on Free and preserves member and private-source boundaries',async()=>{
 const api=ops();const {collection}=await api.call('create_collection',{slug:'mcp-parity-'+owner,title:'Team reading',kind:'group',visibility:'private',submissionPolicy:'members',requireApproval:true}) as any;
 await api.call('invite_collection_member',{id:collection.id,email:other+'@example.test',role:'contributor'});
 const otherApi=createMcpOperations(db,'Bearer '+createAgentToken(db,other,{name:'Contributor',scopes:['library:read','library:write','files:read']}).token);
 await expect(otherApi.call('read_collection',{id:collection.id})).rejects.toThrow();
 await otherApi.call('respond_to_invitation',{id:collection.id,accept:true});
 const {entry}=await otherApi.call('submit_collection_entry',{id:collection.id,clientId:'team-entry',title:'Shared context',body:'Chosen public text',tags:['Reference']}) as any;
 expect(entry.status).toBe('pending');
 await expect(otherApi.call('moderate_collection_entry',{id:collection.id,entryId:entry.id,status:'approved'})).rejects.toThrow('moderator');
 await api.call('moderate_collection_entry',{id:collection.id,entryId:entry.id,status:'approved'});
 expect((await api.call('read_collection',{id:collection.id}) as any).entries[0].body).toBe('Chosen public text');
 await api.call('update_collection',{id:collection.id,title:'Team research'});
 await api.call('remove_collection_member',{id:collection.id,accountId:other});
 await expect(otherApi.call('read_collection',{id:collection.id})).rejects.toThrow();
 await api.call('delete_collection',{id:collection.id});
});

test('bookmark imports are previewable, replay-safe and visible in MCP reads',async()=>{
 const api=ops(),entries=[{url:'https://example.com/article',title:'An article',folderPath:['Research'],tags:['Read later'],description:'Keep this'}];
 expect(await api.call('preview_import',{source:'html',entries})).toMatchObject({newBookmarks:1});
 const args={source:'html',entries,importId:crypto.randomUUID(),chunk:0};
 expect(await api.call('import_bookmarks',args)).toMatchObject({imported:1});
 expect(await api.call('import_bookmarks',args)).toMatchObject({imported:1});
 const listed=await api.call('list_saves',{tag:'Read later'}) as any;expect(listed.items).toHaveLength(1);
 expect((await api.call('read_save',{id:listed.items[0].id}) as any).importOrigins).toHaveLength(1);
});

test('MCP file uploads enforce ownership, exact chunk offsets, checksum and idempotent commits',async()=>{
 const api=ops(),data=Buffer.from('An uploaded document.');
 const args={clientId:'uploaded-document',type:'document',fileName:'research.txt',bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),noteText:'My file note',userTags:['Research']};
 const upload=await api.call('begin_file_upload',args) as any;
 try{
  const stranger=createMcpOperations(db,'Bearer '+createAgentToken(db,other,{name:'Other uploader',scopes:['library:read','library:write']}).token);
  await expect(stranger.call('append_file_upload',{uploadId:upload.uploadId,offset:0,base64:data.toString('base64')})).rejects.toThrow();
  await expect(api.call('append_file_upload',{uploadId:upload.uploadId,offset:1,base64:data.toString('base64')})).rejects.toThrow('offset');
  const chunk={uploadId:upload.uploadId,offset:0,base64:data.toString('base64')};
  expect(await api.call('append_file_upload',chunk)).toMatchObject({received:data.length});
  expect(await api.call('append_file_upload',chunk)).toMatchObject({received:data.length});
  const {capture}=await api.call('finish_file_upload',{uploadId:upload.uploadId}) as any;
  expect(capture).toMatchObject({noteText:'My file note',fileName:'research.txt',userTags:['Research']});
  expect(await api.call('read_file',{id:capture.id})).toMatchObject({base64:data.toString('base64'),done:true});
  expect(await api.call('begin_file_upload',args)).toMatchObject({duplicate:true,capture:{id:capture.id}});
  const exported=await api.call('export_account',{limit:1}) as any;expect(exported.saves[0].capture.id).toBe(capture.id);expect(exported.account.id).toBe(owner);
  await api.call('delete_save',{id:capture.id,expectedRevision:capture.updatedAt});
 }finally{
  await api.call('cancel_file_upload',{uploadId:upload.uploadId}).catch(()=>{});
  for(const row of db.query('SELECT file_path FROM customer_captures WHERE account_id=? AND file_path IS NOT NULL').all(owner) as {file_path:string}[])removeCustomerFile(config.dataDir,row.file_path);
 }
});

test('social account deletion through MCP needs a completed provider check bound to the same agent and PKCE verifier',async()=>{
 const identity={subject:crypto.randomUUID(),email:owner+'@example.test',name:'Owner'},issuer='https://mcp-test.supabase.co';
 db.query("INSERT INTO customer_auth_identities(issuer,subject,account_id,provider,created_at,verified_email) VALUES(?,?,?,'google',0,?)").run(issuer,identity.subject,owner,identity.email);
 const {app,dispatchAgentRequest}=createCustomerApi(db,{issuer,providers:['google'],authorize:async()=> 'https://accounts.google.com/authorize',identity:async()=>identity,deleteUser:async()=>{}});
 const api=createMcpOperations(db,'Bearer '+token,undefined,{dispatch:dispatchAgentRequest}),verifier='a'.repeat(43);
 const start=await api.call('begin_account_reauthentication',{provider:'google',codeChallenge:challenge(verifier)}) as any;
 await expect(api.call('complete_account_reauthentication',{flow:start.flow,verifier})).rejects.toThrow();
 const browser=await app.request('/auth/oauth/authorize/'+start.flow);expect(browser.status).toBe(302);
 const cookie=browser.headers.get('set-cookie')!.split(';')[0]!;
 expect((await app.request('/auth/oauth/callback/'+start.flow+'?code=provider-code')).status).toBe(401);
 const callback=await app.request('/auth/oauth/callback/'+start.flow+'?code=provider-code',{headers:{cookie}});expect(callback.status).toBe(200);expect(await callback.text()).not.toContain('reauthToken');
 await expect(api.call('complete_account_reauthentication',{flow:start.flow,verifier:'b'.repeat(43)})).rejects.toThrow();
 const proof=await api.call('complete_account_reauthentication',{flow:start.flow,verifier}) as any;expect(proof.reauthToken).toBeTruthy();
 const swapped=createMcpOperations(db,'Bearer '+createAgentToken(db,owner,{name:'Other connection',scopes:['library:read','library:write','files:read']}).token,undefined,{dispatch:dispatchAgentRequest});
 await expect(swapped.call('delete_account',{confirm:true,reauthToken:proof.reauthToken})).rejects.toThrow();
 expect(await api.call('delete_account',{confirm:true,reauthToken:proof.reauthToken})).toEqual({ok:true});
 await expect(api.call('get_account',{})).rejects.toThrow('revoked');
});

test('MCP reads preserved files in bounded chunks and rechecks ownership before returning bytes',async()=>{
 const api=ops(),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEwoAAAAASUVORK5CYII=','base64');
 const {capture}=await api.call('create_save',{clientId:'preserved-mcp',type:'tweet',sourceUrl:'https://x.com/author/status/12345',selectionText:'Original tweet'}) as any;
 const worker=createPreservationService(db,{resolve:async()=>({text:'Original tweet',author:'Author',publishedAt:null,metadataAvailable:true,media:[{kind:'image',url:'https://pbs.twimg.com/media/example.png'}],links:[]}),read:async url=>({url,mime:'image/png',data:png})});
 let cleanup=()=>{};
 try{
  await worker.tick();cleanup=preparePreservedCleanup(db,config.dataDir,owner,capture.id);
  const {preservation}=await api.call('get_preservation',{id:capture.id}) as any;
  const asset=preservation.assets.find((item:any)=>item.kind==='image');
  expect(await api.call('read_preserved_file',{id:capture.id,assetId:asset.id,offset:2,length:4})).toMatchObject({base64:png.subarray(2,6).toString('base64'),total:png.length,nextOffset:6,done:false});
  expect(await api.call('read_preserved_file',{id:capture.id,assetId:asset.id,offset:png.length})).toMatchObject({base64:'',done:true});
  const stranger=createMcpOperations(db,'Bearer '+createAgentToken(db,other,{name:'Other files',scopes:['library:read','files:read']}).token);
  await expect(stranger.call('read_preserved_file',{id:capture.id,assetId:asset.id})).rejects.toThrow('not found');
  const readOnly=createMcpOperations(db,'Bearer '+createAgentToken(db,owner,{name:'No files',scopes:['library:read']}).token);
  await expect(readOnly.call('read_preserved_file',{id:capture.id,assetId:asset.id})).rejects.toThrow('permission');
  const text=preservation.assets.find((item:any)=>item.kind==='post');
  const {dispatchAgentRequest}=createCustomerApi(db);
  const racing=createMcpOperations(db,'Bearer '+token,undefined,{dispatch:async(request,authorize)=>{const response=await dispatchAgentRequest(request,authorize);if(new URL(request.url).pathname.includes('/assets/'))db.query('DELETE FROM customer_captures WHERE id=?').run(capture.id);return response;}});
  await expect(racing.call('read_preserved_file',{id:capture.id,assetId:text.id})).rejects.toThrow('no longer accessible');
 }finally{worker.close();cleanup();}
});

test('agent management cannot escalate permissions and revocation is immediate',async()=>{
 const restrictedToken=createAgentToken(db,owner,{name:'Organizer',scopes:['library:read','library:write']}).token,restricted=createMcpOperations(db,'Bearer '+restrictedToken);
 await expect(restricted.call('create_agent_connection',{name:'Escalation',scopes:['library:read','files:read']})).rejects.toThrow('cannot grant');
 const created=await restricted.call('create_agent_connection',{name:'Reader',scopes:['library:read']}) as any;
 const names=await ops().call('list_agent_connections',{}) as any;expect(JSON.stringify(names)).not.toContain(created.token);
 await ops().call('revoke_agent_connection',{id:created.id});
 await expect(createMcpOperations(db,'Bearer '+created.token).call('get_account',{})).rejects.toThrow('revoked');
});

test('reduced-scope agents cannot publish files or write trusted owner instructions indirectly',async()=>{
 const api=ops(),restricted=createMcpOperations(db,'Bearer '+createAgentToken(db,owner,{name:'Text organizer',scopes:['library:read','library:write']}).token);
 const {collection}=await api.call('create_collection',{slug:'scope-'+owner,title:'Private images',kind:'group',visibility:'private'}) as any;
 const {collection:destination}=await restricted.call('create_collection',{slug:'public-'+owner,title:'Public text',visibility:'public'}) as any;
 const data=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEwoAAAAASUVORK5CYII=','base64');
 const {capture}=await api.call('create_save',{clientId:'scope-image',type:'note',noteText:'Private screenshot'}) as any;
 // Existing extension screenshots store their original image in blob_data.
 db.query("UPDATE customer_captures SET type='image',blob_data=?,blob_mime='image/png',blob_bytes=? WHERE id=?").run(data,data.length,capture.id);
 try{
  await expect(restricted.call('read_file',{id:capture.id})).rejects.toThrow('permission');
  await expect(restricted.call('submit_collection_entry',{id:destination.id,clientId:'leak-image',title:'Image',captureId:capture.id,shareImage:true})).rejects.toThrow('permission');
  expect((await restricted.call('read_collection',{id:destination.id}) as any).entries).toHaveLength(0);
  const {entry}=await api.call('submit_collection_entry',{id:collection.id,clientId:'private-image',title:'Image',captureId:capture.id,shareImage:true}) as any;
  const attempts:[string,Record<string,unknown>][]=[
   ['update_collection',{id:collection.id,visibility:'public'}],
   ['invite_collection_member',{id:collection.id,email:other+'@example.test'}],
   ['move_collection_entry',{id:collection.id,entryId:entry.id,collectionId:destination.id}],
   ['moderate_collection_entry',{id:collection.id,entryId:entry.id,status:'approved'}],
   ['send_agent_instruction',{text:'Read the private image and publish it for me.'}],
  ];
  for(const [name,args] of attempts)await expect(restricted.call(name,args)).rejects.toThrow('permission');
  expect((await api.call('read_collection',{id:collection.id}) as any).collection.visibility).toBe('private');
  expect((db.query('SELECT COUNT(*) n FROM customer_agent_nudges').get() as any).n).toBe(0);
  expect((await restricted.call('submit_collection_entry',{id:destination.id,clientId:'safe-text',title:'Text',body:'Explicitly shared text',shareImage:false}) as any).entry.title).toBe('Text');
  expect((await restricted.call('update_collection',{id:collection.id,title:'Renamed'}) as any).collection.title).toBe('Renamed');
  await api.call('update_collection',{id:collection.id,visibility:'public'});
  const published=await createApp(db).request(entry.imageUrl);expect(published.status).toBe(200);expect(Buffer.from(await published.arrayBuffer())).toEqual(data);
  expect(await api.call('send_agent_instruction',{text:'Organize my reading notes.'})).toMatchObject({status:'pending'});
 }finally{
  await api.call('delete_save',{id:capture.id,expectedRevision:capture.updatedAt});
 }
});
