import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright-core';
const base=process.env.FOUNDKEEP_WEB_TEST_URL||'http://127.0.0.1:18791';assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
test('mind map navigates real links, filters across saves, and offers an accessible mobile list',async t=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),password='Graph-fixture-password-48570';
 const registered=await context.request.post(base+'/api/auth/register',{headers:{Origin:base},data:{name:'Graph tester',email:crypto.randomUUID()+'@example.test',password}});assert.equal(registered.status(),201);
 t.after(async()=>{try{assert.equal((await context.request.delete(base+'/api/account',{headers:{Origin:base},data:{password}})).status(),200);}finally{await browser.close();}});
 const issued=await context.request.post(base+'/api/agents',{headers:{Origin:base},data:{name:'Graph integration agent',scopes:['library:read','library:write']}});assert.equal(issued.status(),201);const credential=await issued.json();assert.equal(credential.endpoint,base+'/api/mcp');
 const client=new Client({name:'Friends beta browser test',version:'1.0.0'});t.after(()=>client.close());await client.connect(new StreamableHTTPClientTransport(new URL(credential.endpoint),{requestInit:{headers:{Authorization:'Bearer '+credential.token}}}));
 const call=async(name,args)=>{const result=await client.callTool({name,arguments:args});assert.notEqual(result.isError,true);return JSON.parse(result.content.find(part=>part.type==='text').text);};
 const {capture:first}=await call('create_save',{clientId:crypto.randomUUID(),type:'note',sourceTitle:'A useful design reference',noteText:'A note about useful interfaces.',userTags:['design']});
 const {capture:second}=await call('create_save',{clientId:crypto.randomUUID(),type:'bookmark',sourceUrl:'https://example.com/related',sourceTitle:'Another useful reference',userTags:['design']});
 const {capture:updated}=await call('update_save',{id:first.id,expectedRevision:first.updatedAt,summary:'Agent context: keep useful references connected.',category:'Design'});
 await call('link_saves',{id:first.id,expectedRevision:updated.updatedAt,relatedIds:[second.id]});
 const graph=await (await context.request.get(base+'/api/graph')).json();assert.ok(graph.edges.some(edge=>edge.kind==='agent'&&edge.source==='save:'+first.id&&edge.target==='save:'+second.id));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/dashboard/mind-map');await page.getByRole('heading',{name:'Mind map',exact:true}).waitFor();await page.locator('.mind-map-canvas[data-ready=true]').waitFor();
 await mkdir('.impeccable/review/friends-beta',{recursive:true});
 const extra=[];for(let i=0;i<30;i++){const group=['agents','design','reading','research','systems'][i%5];extra.push((await call('create_save',{clientId:crypto.randomUUID(),type:i%3?'bookmark':'note',...(i%3?{sourceUrl:'https://example.com/map-'+i}:{}),sourceTitle:`${group} reference ${i+1}`,noteText:'A disposable reference for graph interaction testing.',userTags:[group,'ideas']})).capture);}
 for(let i=0;i<extra.length;i++)await call('link_saves',{id:extra[i].id,expectedRevision:extra[i].updatedAt,relatedIds:[extra[(i+5)%30].id,extra[(i+1)%30].id]});
 await page.getByRole('button',{name:'Refresh mind map',exact:true}).click();await page.getByText('32 of 32 saves',{exact:true}).waitFor();
 await page.getByLabel('Appearance',{exact:true}).selectOption('dark');await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');await page.screenshot({path:'.impeccable/review/friends-beta/mind-map-dark-desktop.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'.impeccable/review/friends-beta/mind-map-dark-phone.png'});await page.setViewportSize({width:1440,height:1000});await page.getByLabel('Appearance',{exact:true}).selectOption('light');await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
await page.screenshot({path:'.impeccable/review/friends-beta/mind-map-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'List view',exact:true}).click();await page.getByRole('button',{name:'Inspect A useful design reference',exact:true}).click();await page.getByRole('link',{name:'Open saved item',exact:true}).click();await page.waitForURL(new RegExp('/dashboard/saved/'+first.id));
 await page.goto(base+'/dashboard/mind-map');await page.getByLabel('Search your mind map').fill('Another');await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('button',{name:'List view',exact:true}).click();await page.getByRole('button',{name:'Inspect Another useful reference',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Inspect A useful design reference',exact:true}).count(),0);
 for(const width of [820,390,320]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${width}`);}
 await page.screenshot({path:'.impeccable/review/friends-beta/mind-map-phone.png',fullPage:true});
 assert.equal((await context.request.delete(base+'/api/agents/'+credential.id,{headers:{Origin:base}})).status(),200);await assert.rejects(()=>client.listTools());
 assert.deepEqual(errors,[]);
});
