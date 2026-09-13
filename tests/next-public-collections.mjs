import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const base=process.env.FOUNDKEEP_WEB_TEST_URL||'http://127.0.0.1:18791';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Use a disposable local backend.');

test('public editorial collection searches all pages, switches layout, shares, and works on mobile and without JS',async t=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const owner=await browser.newContext(),guest=await browser.newContext({reducedMotion:'reduce',viewport:{width:1440,height:1000}});
 const password='Disposable-editorial-test-2940284';
 const registration=await owner.request.post(base+'/api/auth/register',{headers:{Origin:base},data:{email:crypto.randomUUID()+'@example.test',name:'Editorial test curator',password}});assert.equal(registration.status(),201);
 t.after(async()=>{try{assert.equal((await owner.request.delete(base+'/api/account',{headers:{Origin:base},data:{password}})).status(),200);}finally{await browser.close();}});
 const created=await owner.request.post(base+'/api/collections',{headers:{Origin:base},data:{title:'A collection of useful references and ideas',slug:'editorial-'+crypto.randomUUID(),visibility:'public',submissionPolicy:'anyone',requireApproval:true,tags:['design'],description:'A long description that should remain readable on phones. '.repeat(4)}});
 assert.equal(created.status(),201);const c=(await created.json()).collection;
 for(let i=0;i<27;i++)assert.equal((await owner.request.post(base+`/api/collections/${c.id}/entries`,{headers:{Origin:base},data:{clientId:crypto.randomUUID(),title:i===0?'Older needle in a long collection':'A useful reference '+i,url:'https://example.com/reference-'+i,body:i===26?'A longer original note with context. '.repeat(24):'A short explanation for a useful source.',tags:[i===0?'older':'recent']}})).status(),201);
 const page=await guest.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw new Error('Permission denied');}}}));
 const path='/collection/'+c.slug;await page.goto(base+path);await page.getByRole('heading',{name:c.title,exact:true}).waitFor();
 assert.equal(await page.locator('.public-find').count(),24);
 await page.getByLabel('Search this collection',{exact:true}).fill('Older needle');await page.getByRole('button',{name:'Search',exact:true}).click();
 await page.getByRole('heading',{name:'Older needle in a long collection',exact:true}).waitFor();assert.equal(await page.locator('.public-find').count(),1);assert.equal(new URL(page.url()).searchParams.get('q'),'Older needle');
 await page.getByRole('link',{name:'Clear filters',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.public-find').length===24);
 await page.getByLabel('Filter by topic').selectOption('older');await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('heading',{name:'Older needle in a long collection',exact:true}).waitFor();assert.equal(await page.locator('.public-find').count(),1);
 await page.getByRole('link',{name:'Clear filters',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.public-find').length===24);
 await page.getByRole('button',{name:'Grid view',exact:true}).click();assert.equal(await page.locator('.collection-find-feed').getAttribute('data-view'),'grid');
 await page.getByRole('button',{name:'List view',exact:true}).click();
 await page.getByRole('button',{name:'Share collection',exact:true}).click();assert.equal(await page.getByLabel('Collection link',{exact:true}).inputValue(),base+path);
 await page.locator('.find-expanded-note summary').click();assert.equal(await page.locator('.find-expanded-note').getAttribute('open'),'');
 await page.getByRole('button',{name:'Load more finds'}).click();await page.waitForFunction(()=>document.querySelectorAll('.public-find').length===27);
 for(const width of [1440,820,390,320]){
  await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${width}`);
  if(width<=390){const contribute=page.getByRole('link',{name:'Log in to contribute',exact:true});assert.equal(await contribute.count(),1);assert.ok(await contribute.evaluate(el=>Boolean(el.closest('.collection-profile'))));}
  for(const name of ['Grid view','List view','Search','Share collection']){const bounds=await page.getByRole('button',{name,exact:true}).boundingBox();assert.ok(bounds.height>=48&&bounds.width>=48,`${name} target at ${width}`);}
 }
 // The mobile contribution action opens the real form and focuses its first field.
 const signed=await owner.newPage();await signed.setViewportSize({width:390,height:1000});await signed.goto(base+path);await signed.getByRole('button',{name:'Add a find',exact:true}).click();
 const form=signed.getByRole('form',{name:'Add to collection'});assert.ok(await form.getByLabel('Title',{exact:true}).evaluate(el=>el===document.activeElement));
 const noJs=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:1000}});const basic=await noJs.newPage();await basic.goto(base+path);await basic.getByRole('heading',{name:c.title,exact:true}).waitFor();
 assert.equal(await basic.locator('.public-find').count(),24);await basic.getByLabel('Search this collection',{exact:true}).fill('Older needle');await basic.getByRole('button',{name:'Search',exact:true}).click();await basic.getByRole('heading',{name:'Older needle in a long collection',exact:true}).waitFor();assert.equal(await basic.locator('.public-find').count(),1);
 await page.goto(base+'/collections?q=unmatched-'+crypto.randomUUID());await page.getByRole('heading',{name:'No collections match yet.'}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);
});
