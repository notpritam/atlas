import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {chromium} from 'playwright-core';

const base=process.env.BASE_URL||'http://127.0.0.1:18894';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname)||(base==='https://dev.foundkeep.app'&&process.env.FOUNDKEEP_ALLOW_DEV_TEST==='1'),'Use a disposable backend or opt in to temporary dev accounts.');
const candidate=process.env.FOUNDKEEP_CANDIDATE_URL;
if(candidate)assert.ok(['localhost','127.0.0.1'].includes(new URL(candidate).hostname));

test('real MCP client can edit generated tags and use the full Free-account workflow', {timeout:120000},async t=>{
 const password='Temporary-MCP-'+randomUUID();let cookie,client,browser;
 const api=async(path,method='GET',body)=>fetch(base+'/api'+path,{method,headers:{Origin:base,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 t.after(async()=>{
  await client?.close();await browser?.close();
  if(cookie){const removed=await api('/account','DELETE',{password});assert.equal(removed.status,200,'Delete only the temporary MCP test account');}
 });
 const registered=await api('/auth/register','POST',{name:'Temporary MCP release check',email:'mcp-parity-'+randomUUID()+'@example.test',password});
 assert.equal(registered.status,201);cookie=registered.headers.get('set-cookie').split(';')[0];
 const connection=await api('/agents','POST',{name:'Temporary MCP verification',scopes:['library:read','library:write','files:read']});assert.equal(connection.status,201);
 const {token}=await connection.json();
 client=new Client({name:'FoundKeep dev verification',version:'1.0.0'});
 await client.connect(new StreamableHTTPClientTransport(new URL(base+'/api/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token}}}));
 const catalog=await client.listTools(),names=catalog.tools.map(tool=>tool.name);
 for(const name of ['organize_save','update_save','delete_save','create_collection','configure_processing','read_preserved_file','begin_file_upload','export_account','begin_account_reauthentication'])assert.ok(names.includes(name),name+' must be discoverable');
 const edit=catalog.tools.find(tool=>tool.name==='update_save');assert.ok(edit.inputSchema.properties.tags,'Generated tags must be editable in the public schema');
 const call=async(name,args={})=>{const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,name+' must succeed');return JSON.parse(result.content.find(item=>item.type==='text').text);};
 const plan=await call('get_plan');assert.equal(plan.pro,false);assert.equal(plan.features.managedProcessing,true);assert.equal(plan.features.groupCollections,true);
 const preferences=await call('get_preferences');await call('update_preferences',{expectedRevision:preferences.revision,preferences:{...preferences.preferences,organization:{ocr:false,summaries:false,tags:false}}});
 const {folder}=await call('create_folder',{name:'Temporary MCP research'});
 const {capture}=await call('create_save',{clientId:randomUUID(),type:'note',sourceTitle:'MCP test',noteText:'Private annotation kept separate.',userTags:['Private research'],folderId:folder.id});
 const tagged=await call('update_save',{id:capture.id,expectedRevision:capture.updatedAt,tags:['actually','been']});
 const cleared=await call('organize_save',{id:capture.id,expectedRevision:tagged.capture.updatedAt,tags:[]});
 assert.deepEqual(cleared.capture.tags,[]);assert.deepEqual(cleared.capture.userTags,['Private research']);assert.equal(cleared.capture.noteText,capture.noteText);
 await call('rename_folder',{id:folder.id,name:'Reviewed research'});
 assert.equal((await call('list_saves',{tag:'Private research',folderId:folder.id})).items.length,1);
 const {collection}=await call('create_collection',{title:'Temporary group',slug:'mcp-'+randomUUID(),kind:'group',visibility:'private',submissionPolicy:'members'});
 await call('submit_collection_entry',{id:collection.id,clientId:randomUUID(),title:'Shared reference',body:'Only this text is shared.',tags:['Shared tag'],captureId:capture.id});
 const shared=await call('read_collection',{id:collection.id});assert.equal(shared.entries.length,1);assert.ok(!JSON.stringify(shared).includes(capture.noteText));assert.ok(!JSON.stringify(shared).includes('Private research'));
 const bytes=Buffer.from('An original file uploaded through FoundKeep MCP.');
 const upload=await call('begin_file_upload',{clientId:randomUUID(),type:'document',fileName:'mcp-check.txt',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),noteText:'File context',userTags:['Reference']});
 await call('append_file_upload',{uploadId:upload.uploadId,offset:0,base64:bytes.toString('base64')});
 const saved=await call('finish_file_upload',{uploadId:upload.uploadId});
 const file=await call('read_file',{id:saved.capture.id});assert.equal(file.base64,bytes.toString('base64'));assert.equal(file.done,true);
 const exported=await call('export_account',{limit:20});assert.equal(exported.saves.length,2);
 assert.ok((await call('get_graph',{})).nodes.length>0);
 assert.equal((await call('get_processing_settings',{})).enabled,false,'No processing consent is implied by connecting an agent');
 await call('configure_processing',{mode:'manual',enabled:false});
 if(process.env.FOUNDKEEP_TEST_SITE==='1'){
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
  const context=await browser.newContext();
  const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:base,httpOnly:true,secure:base.startsWith('https:'),sameSite:'Lax'}]);
  if(candidate)await context.route(base+'/**',async route=>{
   const url=new URL(route.request().url());if(url.pathname.startsWith('/api/'))return route.continue();
   const response=await context.request.fetch(candidate+url.pathname+url.search,{headers:{...route.request().headers(),host:new URL(base).host,'x-forwarded-host':new URL(base).host,'x-forwarded-proto':new URL(base).protocol.slice(0,-1)}});return route.fulfill({response});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/dashboard/settings/processing');await page.getByText('Managed processing is available on every plan during early access.').waitFor();
  const processing=await call('get_processing_settings');assert.equal(await page.getByRole('checkbox').first().isDisabled(),!processing.available);
  await page.goto(base+'/dashboard/plans');await page.getByText('MCP, groups, and managed processing are open on every plan while we build FoundKeep together.').waitFor();assert.deepEqual(errors,[]);
 }
 const latest=await call('read_save',{id:capture.id});await call('delete_save',{id:capture.id,expectedRevision:latest.capture.updatedAt});
 await call('delete_folder',{id:folder.id});await call('delete_collection',{id:collection.id});
 assert.ok(names.length>=60);t.diagnostic('Verified '+names.length+' discoverable tools; generated tags, organization, private sharing, file bytes, exports, and Free access.');
});
