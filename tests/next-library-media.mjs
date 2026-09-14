import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright-core';
const settle=page=>page.evaluate(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await Promise.all(document.getAnimations().filter(animation=>animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));});
const base=process.env.FOUNDKEEP_MEDIA_TEST_ORIGIN||'https://dev.foundkeep.app',candidate=process.env.FOUNDKEEP_CANDIDATE_URL;
assert.ok((base==='https://dev.foundkeep.app'&&process.env.FOUNDKEEP_ALLOW_DEV_TEST==='1')||(base==='https://foundkeep.app'&&process.env.FOUNDKEEP_ALLOW_PROD_TEST==='1'),'Explicitly opt in to temporary accounts on the selected FoundKeep environment.');
if(candidate)assert.equal(new URL(candidate).hostname,'127.0.0.1');

test('library cards update with private saved photos, videos and tags without reloading',{timeout:180000},async t=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1360,height:950}}),password='Media-preview-'+crypto.randomUUID();let cookie;
 t.after(async()=>{try{if(cookie){const removed=await context.request.delete(base+'/api/account',{headers:{Origin:base,Cookie:cookie},data:{password}});assert.equal(removed.status(),200,'Remove only the temporary test account');}}finally{await browser.close();}});
 if(candidate)await context.route(base+'/**',async route=>{
  const url=new URL(route.request().url());if(url.pathname.startsWith('/api/'))return route.continue();
  const response=await context.request.fetch(candidate+url.pathname+url.search,{headers:{...route.request().headers(),host:new URL(base).host,'x-forwarded-host':new URL(base).host,'x-forwarded-proto':'https'}});await route.fulfill({response});
 });
 const registered=await context.request.post(base+'/api/auth/register',{headers:{Origin:base},data:{name:'Temporary library media check',email:'media-preview-'+crypto.randomUUID()+'@example.test',password}});assert.equal(registered.status(),201);cookie=registered.headers()['set-cookie'].split(';')[0];
 const page=await context.newPage(),errors=[];let navigations=0;
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.isNavigationRequest()&&request.frame()===page.mainFrame())navigations++;});
 await page.goto(base+'/dashboard');const initialNavigations=navigations;
 const save=async(sourceUrl,title)=>{
  const response=await context.request.post(base+'/api/captures',{headers:{Origin:base},data:{clientId:crypto.randomUUID(),type:'tweet',sourceUrl,sourceTitle:title,noteText:'Keep this visual reference for our next project.',userTags:['Visual research','Inspiration'],processingOptions:{ocr:false,summaries:false,tags:false}}});assert.equal(response.status(),201);return(await response.json()).capture;
 };
 const photo=await save('https://x.com/NASA/status/2040468080686424396','Two photos for visual research');
 const card=page.locator(`[data-capture-id="${photo.id}"]`);
 await card.waitFor({timeout:25000});await card.locator('.capture-card-tags').getByText('Visual research',{exact:true}).waitFor();
 await card.locator('.capture-media-grid img').first().waitFor({timeout:120000});
 await page.waitForFunction(id=>{const images=[...document.querySelectorAll(`[data-capture-id="${id}"] .capture-media-grid img`)];return images.length===2&&images.every(image=>image.complete&&image.naturalWidth>0);},photo.id,{timeout:120000});
 assert.equal(await card.locator('.capture-media-count').textContent(),'2 photos');assert.equal(navigations,initialNavigations,'Background preservation must not reload the page');
 const urls=await card.locator('img').evaluateAll(images=>images.map(image=>new URL(image.src).pathname));assert.ok(urls.every(url=>url.startsWith(`/api/captures/${photo.id}/assets/`)));
 const video=await save('https://x.com/captainamerica/status/719944021058060289','Motion reference');
 const videoCard=page.locator(`[data-capture-id="${video.id}"]`);await videoCard.locator('video').waitFor({timeout:120000});
 await page.waitForFunction(id=>document.querySelector(`[data-capture-id="${id}"] video`)?.readyState>=2,video.id,{timeout:30000});
 assert.equal(await videoCard.locator('.capture-media-count').textContent(),'1 video');
 assert.equal(await videoCard.locator('video').evaluate(video=>video.paused&&video.muted),true);
 await mkdir('/tmp/foundkeep-library-media-review',{recursive:true});await page.screenshot({path:'/tmp/foundkeep-library-media-review/light.png'});
 await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');await settle(page);
 const colors=await card.locator('.capture-media-count').evaluate(element=>({background:getComputedStyle(element).backgroundColor,color:getComputedStyle(element).color}));assert.notEqual(colors.background,colors.color);await page.screenshot({path:'/tmp/foundkeep-library-media-review/dark.png'});
 await page.setViewportSize({width:390,height:850});await settle(page);await page.waitForFunction(()=>[...document.querySelectorAll('[data-capture-id]')].every(element=>{const box=element.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth+1;}));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'/tmp/foundkeep-library-media-review/mobile.png'});
 await card.getByRole('button',{name:/Open Tweet/}).click();await page.locator('.preserved-source img').first().waitFor();
 assert.deepEqual(errors,[]);t.diagnostic('Verified automatic card refresh, two saved photos, paused video preview, personal tags, responsive layout, dark mode and opening the associated save.');
});
