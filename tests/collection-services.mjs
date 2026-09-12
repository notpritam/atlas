import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const base=new URL(process.env.FOUNDKEEP_SERVICES_TEST_URL||'http://127.0.0.1:18791').origin;
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname)||process.env.FOUNDKEEP_ALLOW_LIVE_QA==='1','Live QA requires explicit opt-in and deletes only its own temporary account.');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1280,height:950},reducedMotion:'reduce'});
const password='Collection-service-test-only-92617';let owner;
try{
 const registered=await context.request.post(base+'/api/auth/register',{headers:{Origin:base},data:{name:'Alex Morgan',email:'services-'+crypto.randomUUID()+'@example.test',password}});assert.equal(registered.status(),201);owner=(await registered.json()).account;
 const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const html=await (await context.request.get(base+'/dashboard?panel=settings')).text();assert.equal(html.includes('data-cfemail'),false,'The CDN must not rewrite private React HTML.');
 await page.goto(base+'/dashboard?panel=settings');await page.getByRole('heading',{name:'A collection, freely yours.'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Pro checkout coming soon'}).isDisabled(),true);
 await page.getByText('Connect an agent',{exact:true}).click();await page.getByLabel('Connection name').fill('Research assistant');
 await page.getByLabel('Allow organizing tags, folders and related saves').check();await page.getByRole('button',{name:'Create connection',exact:true}).click();
 const box=page.getByLabel('Private MCP configuration');await box.waitFor();const config=JSON.parse(await box.inputValue());const token=config.mcpServers.foundkeep.headers.Authorization;
 assert.match(token,/^Bearer fk_mcp_/);
 const result=await context.request.post(base+'/api/mcp',{headers:{Authorization:token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},data:{jsonrpc:'2.0',id:1,method:'tools/list',params:{}}});assert.equal(result.status(),200);assert.ok((await result.json()).result.tools.some(tool=>tool.name==='organize_save'));
 await page.getByRole('button',{name:'I saved it',exact:true}).click();assert.equal(await box.count(),0);
 await page.getByLabel('Ask your connected agent').fill('Organize my recent design references.');await page.getByRole('button',{name:'Save instruction',exact:true}).click();await page.getByText('Waiting for your agent: Organize my recent design references.').waitFor();
 await mkdir('docs/agentic-preview',{recursive:true});await page.screenshot({path:'docs/agentic-preview/account-services.png'});
 await page.setViewportSize({width:390,height:844});await page.locator('.plan-section').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'docs/agentic-preview/account-services-mobile.png'});
 await page.getByRole('button',{name:'Revoke',exact:true}).click();await page.locator('#confirm-accept').click();await page.getByText('Research assistant',{exact:true}).waitFor({state:'hidden'});
 const revoked=await context.request.post(base+'/api/mcp',{headers:{Authorization:token,'Content-Type':'application/json'},data:{jsonrpc:'2.0',id:2,method:'tools/list',params:{}}});assert.equal(revoked.status(),401);
 await page.route('**/api/plan',async route=>{const response=await route.fetch();const plan=await response.json();plan.billing.paddle.canManage=true;await route.fulfill({response,json:plan});});
 await page.reload();await page.getByRole('button',{name:'Manage subscription',exact:true}).waitFor();assert.deepEqual(errors,[]);
 const checkoutRequests=[];
 await page.unroute('**/api/plan');
 await page.route('**/api/plan',async route=>{const response=await route.fetch();const plan=await response.json();plan.billing.paddle.available=true;plan.billing.paddle.canManage=false;await route.fulfill({response,json:plan});});
 await page.route('**/api/automation',async route=>{const response=await route.fetch();const settings=await response.json();settings.available=true;await route.fulfill({response,json:settings});});
 await page.route('**/api/billing/checkout',async route=>{checkoutRequests.push(route.request().postDataJSON());await route.fulfill({contentType:'application/json',body:JSON.stringify({url:base+'/checkout?_ptxn=txn_1'})});});
 await page.reload();await page.getByRole('button',{name:'Get Pro · $5/month',exact:true}).click();
 await page.waitForURL(base+'/checkout?_ptxn=txn_1');
 assert.equal(checkoutRequests.length,1);
 assert.deepEqual(errors,[]);
 console.log('PASS: free plan, disabled checkout, one-time scoped MCP connection, instructions, revocation, narrow layout, same-origin checkout redirect, and no runtime errors.');
}finally{
 if(owner){const removed=await context.request.delete(base+'/api/account',{headers:{Origin:base},data:{password}});assert.equal(removed.status(),200);}
 await context.close();await browser.close();
}
