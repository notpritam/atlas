import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {actionPanel} from './helpers/action-panel.mjs';
const base='https://dev.foundkeep.app',candidate=process.env.FOUNDKEEP_CANDIDATE_URL;
assert.equal(process.env.FOUNDKEEP_ALLOW_DEV_TEST,'1','Explicitly opt into a temporary dev account.');
if(candidate)assert.equal(new URL(candidate).hostname,'127.0.0.1');
async function waitFor(fn,limit=120000){const start=Date.now();while(Date.now()-start<limit){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,1000));}throw Error('Timed out waiting for preservation.');}

test('dev extension preserves a real X video; the web and sidebar play server copies, and dev MCP uses its own name',{timeout:240000},async t=>{
 const temporary=await mkdtemp('/tmp/foundkeep-twitter-e2e-'),extension=path.resolve('deploy/dist/extensions/dev/foundkeep-extension-dev');
 const context=await chromium.launchPersistentContext(temporary,{headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 const password='Twitter-release-'+crypto.randomUUID();let cookie;
 t.after(async()=>{try{if(cookie){const response=await context.request.delete(base+'/api/account',{headers:{Origin:base,Cookie:cookie},data:{password}});assert.equal(response.status(),200,'Remove only the temporary test account');}}finally{await context.close();await rm(temporary,{recursive:true,force:true});}});
 if(candidate)await context.route(base+'/**',async route=>{
  const url=new URL(route.request().url());if(url.pathname.startsWith('/api/')||url.pathname==='/customer-config.json')return route.continue();
  const response=await context.request.fetch(candidate+url.pathname+url.search,{headers:{...route.request().headers(),host:new URL(base).host,'x-forwarded-host':new URL(base).host,'x-forwarded-proto':'https'}});return route.fulfill({response});
 });
 const registered=await context.request.post(base+'/api/auth/register',{headers:{Origin:base},data:{name:'Temporary Twitter release check',email:'twitter-'+crypto.randomUUID()+'@example.test',password}});assert.equal(registered.status(),201);cookie=registered.headers()['set-cookie'].split(';')[0];
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'/dashboard');
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await waitFor(()=>worker.evaluate(async()=>!!(await chrome.storage.local.get('atlasCustomer')).atlasCustomer?.token),20000);
 const post='https://x.com/captainamerica/status/719944021058060289';
 await context.route('https://x.com/**',route=>route.fulfill({contentType:'text/html',body:'<title>Public X video test</title><article data-testid="tweet"><div data-testid="User-Name">Captain America</div><a href="/captainamerica/status/719944021058060289"><time>Today</time></a><div data-testid="tweetText">A public video post.</div><div role="group"><button data-testid="reply">Reply</button></div></article>'}));
 const tweet=await context.newPage();await tweet.goto(post);await tweet.locator('article [data-state]').click();
 const panel=await actionPanel(context,tweet,worker,{open:false});
 await panel.waitFor('document.querySelector("#destinationDialog")?.open');
 const choices=await panel.evaluate('[...document.querySelector("#saveDestination").options].map(option=>option.value)');
 const destination=choices.find(value=>value==='account'||value==='library');assert.ok(destination,'The connected private library is offered');
 await panel.evaluate(`document.querySelector('#saveDestination').value=${JSON.stringify(destination)};document.querySelector('#saveDestination').dispatchEvent(new Event('change'));document.querySelector('#destinationConfirm').click()`);
 await panel.waitFor('!document.querySelector("#destinationDialog")?.open');
 const videoSave=await waitFor(async()=>{const result=await context.request.get(base+'/api/captures');return(await result.json()).captures.find(item=>item.sourceUrl===post);});
 const preserved=await waitFor(async()=>{const response=await context.request.get(base+`/api/captures/${videoSave.id}/preservation`);const {preservation}=await response.json();return preservation?.status==='ready'&&preservation;});
 const video=preserved.assets.find(asset=>asset.kind==='video');assert.ok(video);assert.ok(video.bytes>100000);
 const downloaded=await context.request.get(base+video.downloadUrl);assert.equal(downloaded.status(),200);assert.match(downloaded.headers()['content-disposition'],/^attachment/);
 assert.equal(createHash('sha256').update(await downloaded.body()).digest('base64url'),video.sha256);
 const range=await context.request.get(base+video.url,{headers:{Range:'bytes=0-63'}});assert.equal(range.status(),206);assert.equal((await range.body()).length,64);
 await panel.waitFor(`document.querySelector('.save-card[data-id="${videoSave.id}"]')`);
 await panel.evaluate(`document.querySelector('.save-card[data-id="${videoSave.id}"]').click()`);
 await panel.waitFor('document.querySelector("#preservedSource h3")?.textContent==="Source saved"');
 await panel.evaluate('[...document.querySelectorAll("#preservedSource button")].find(button=>button.textContent==="Load saved video").click()');
 await panel.waitFor('document.querySelector("#preservedSource video")?.readyState>=1');
 const sidebarDuration=await panel.evaluate('document.querySelector("#preservedSource video").duration');assert.ok(sidebarDuration>0);
 await page.goto(base+'/dashboard?item='+videoSave.id);await page.locator('.preserved-source video').waitFor();
 await page.waitForFunction(()=>document.querySelector('.preserved-source video')?.readyState>=1);
 await page.locator('.preserved-source video').evaluate(video=>{video.muted=true;return video.play();});await page.waitForFunction(()=>document.querySelector('.preserved-source video').currentTime>.2);
 for(const [id,expected] of [['2040468080686424396',['post','image','image']],['1583474732749697026',['post','image','article']]]){
  const saved=await context.request.post(base+'/api/captures',{headers:{Origin:base},data:{clientId:crypto.randomUUID(),type:'tweet',sourceUrl:'https://x.com/NASA/status/'+id,selectionText:'Public NASA source',processingOptions:{ocr:false,summaries:false,tags:false}}});assert.equal(saved.status(),201);const {capture}=await saved.json();
  const result=await waitFor(async()=>{const response=await context.request.get(base+`/api/captures/${capture.id}/preservation`);const {preservation}=await response.json();return preservation?.status==='ready'&&preservation;});assert.deepEqual(result.assets.map(asset=>asset.kind),expected);
  if(expected.includes('article'))assert.ok(result.assets.find(asset=>asset.kind==='article').text.length>10000);
 }
 await mkdir('/tmp/foundkeep-twitter-review',{recursive:true});
 await page.screenshot({path:'/tmp/foundkeep-twitter-review/reader-light.png'});
 await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.capture-collection-share>.button')).backgroundColor===getComputedStyle(document.querySelector('.reader-surface')).backgroundColor);
 const buttonColors=await page.locator('.capture-collection-share>.button').evaluate(button=>({background:getComputedStyle(button).backgroundColor,color:getComputedStyle(button).color}));
 assert.notEqual(buttonColors.background,'rgb(255, 255, 255)','The collection action uses the dark surface token');
 await page.screenshot({path:'/tmp/foundkeep-twitter-review/reader-dark.png'});
 await page.setViewportSize({width:390,height:850});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.goto(base+'/dashboard/agents');await page.locator('#agent-name').fill('Twitter release check');await page.locator('#create-agent-connection').click();
 const configuration=page.getByLabel('Private MCP configuration',{exact:true});await configuration.waitFor();const config=JSON.parse(await configuration.inputValue());assert.deepEqual(Object.keys(config.mcpServers),['foundkeep-dev']);assert.equal(config.mcpServers['foundkeep-dev'].url,base+'/api/mcp');
 await page.getByRole('button',{name:'I saved it',exact:true}).click();assert.deepEqual(errors,[]);
 console.log('Verified real video bytes, private range/download, sidebar playback, web playback, two photos, linked article body, and dev MCP naming.');
});
