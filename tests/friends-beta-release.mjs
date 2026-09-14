import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {chromium} from 'playwright-core';

const base=process.env.FOUNDKEEP_RELEASE_TEST_ORIGIN;
assert.ok(['https://dev.foundkeep.app','https://foundkeep.app'].includes(base));
assert.equal(process.env.FOUNDKEEP_ALLOW_RELEASE_TEST,'1','Explicitly opt in to disposable live QA accounts and one real processing credit.');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('friends beta connects MCP, grants truthful Pro access, processes real content and preserves privacy',{timeout:180000},async t=>{
  const accounts=[];let client,browser;
  const register=async()=>{
    const password='Release-'+randomUUID();
    const response=await fetch(base+'/api/auth/register',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({name:'Temporary release verification',email:'release-'+randomUUID()+'@example.test',password})});
    assert.equal(response.status,201,'Disposable registration');
    const cookie=response.headers.get('set-cookie').split(';')[0];
    const account={cookie,password};accounts.push(account);return account;
  };
  const api=(account,path,method='GET',body)=>fetch(base+'/api'+path,{method,headers:{Origin:base,Cookie:account.cookie,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const ok=async(account,path,method='GET',body)=>{const result=await api(account,path,method,body);assert.ok(result.ok,`${method} ${path}: ${result.status}`);return result.json();};
  t.after(async()=>{
    await client?.close();await browser?.close();
    for(const account of accounts){const deleted=await api(account,'/account','DELETE',{password:account.password});assert.equal(deleted.status,200,'Delete only this test account');}
  });
  const owner=await register();
  const plan=await ok(owner,'/plan');assert.equal(plan.pro,true);assert.equal(plan.complimentaryPro,true);assert.deepEqual(plan.subscriptions,[]);assert.equal(plan.limits.maxBytes,2*1024**3);assert.equal(plan.limits.monthlyProcessing,500);
  const initial=await ok(owner,'/automation');assert.equal(initial.available,true);assert.equal(initial.enabled,false,'New accounts must consent to AI processing');
  const connection=await ok(owner,'/agents','POST',{name:'Temporary release verification',scopes:['library:read','library:write','files:read']});
  client=new Client({name:'FoundKeep release verification',version:'1.0.0'});
  await client.connect(new StreamableHTTPClientTransport(new URL(base+'/api/mcp'),{requestInit:{headers:{Authorization:'Bearer '+connection.token}}}));
  const tools=await client.listTools();assert.ok(tools.tools.length>=72);
  const call=async(name,args={})=>{const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,name+' succeeds');return JSON.parse(result.content.find(item=>item.type==='text').text);};
  const folder=await call('create_folder',{name:'Temporary release research'});
  await call('configure_processing',{enabled:true,consentVersion:initial.consentVersion,fetchLinks:false,images:false,mode:'instant',monthlyLimit:1});
  const {capture}=await call('create_save',{clientId:randomUUID(),type:'note',sourceTitle:'A reference library for product design',noteText:'FoundKeep keeps design references, screenshots and personal notes together. Connected agents can reuse this curated context when helping someone build an app.',folderId:folder.folder.id,userTags:['Release check']});
  let result;
  for(let i=0;i<100;i++){
    result=await ok(owner,`/captures/${capture.id}/processing`);
    if(result.job?.status==='done')break;
    assert.notEqual(result.job?.status,'failed','Hosted processing must complete');await delay(1000);
  }
  assert.equal(result.job?.status,'done');assert.equal(result.processing.model,'gpt-4.1-mini');assert.ok(result.processing.result.summary.length>0);
  const usage=await call('get_processing_settings');assert.equal(usage.usage.used,1);assert.equal(usage.usage.reserved,0);
  await call('process_save',{id:capture.id});assert.equal((await call('get_processing_settings')).usage.used,1,'Repeating a completed job does not consume another credit');
  await call('configure_processing',{mode:'paused'});
  const saved=await call('read_save',{id:capture.id});
  const changed=await call('organize_save',{id:capture.id,expectedRevision:saved.capture.updatedAt,tags:[]});
  assert.deepEqual(changed.capture.tags,[]);assert.deepEqual(changed.capture.userTags,['Release check']);assert.equal(changed.capture.folderId,folder.folder.id);
  const stranger=await register();assert.equal((await api(stranger,`/captures/${capture.id}`)).status,404);
  const anonymous=await fetch(base+`/api/captures/${capture.id}`);assert.ok([401,403].includes(anonymous.status));
  if(process.env.FOUNDKEEP_TEST_SITE==='1'){
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
    const context=await browser.newContext({viewport:{width:1360,height:920},reducedMotion:'reduce'});
    const separator=owner.cookie.indexOf('=');await context.addCookies([{name:owner.cookie.slice(0,separator),value:owner.cookie.slice(separator+1),url:base,httpOnly:true,secure:true,sameSite:'Lax'}]);
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/dashboard/plans');await page.getByRole('heading',{name:'Pro beta — complimentary'}).waitFor();await page.getByText('Complimentary Pro access. No payment required.').waitFor();
    await page.goto(base+'/dashboard');await page.locator(`[data-capture-id="${capture.id}"]`).waitFor();
    assert.deepEqual(errors,[]);
  }
  t.diagnostic(`Verified ${base}: ${tools.tools.length} MCP tools, Pro beta, one real AI job, credit deduplication, folder/tags, explicit consent, account isolation and QA cleanup.`);
});
