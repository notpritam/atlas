import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
const base=process.env.FOUNDKEEP_WEB_TEST_URL||'http://127.0.0.1:18791';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Use a disposable local backend.');

test('public editorial collection searches all pages, switches layout, shares, and works on mobile and without JS',async t=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const owner=await browser.newContext(),guest=await browser.newContext({reducedMotion:'reduce',viewport:{width:1440,height:1000}});
 const password='Disposable-editorial-test-2940284';
 const registration=await owner.request.post(base+'/api/auth/register',{headers:{Origin:base},data:{email:crypto.randomUUID()+'@example.test',name:'Editorial test curator',password}});assert.equal(registration.status(),201);
 t.after(async()=>{try{assert.equal((await owner.request.delete(base+'/api/account',{headers:{Origin:base},data:{password}})).status(),200);}finally{await browser.close();}});
 const created=await owner.request.post(base+'/api/collections',{headers:{Origin:base},data:{title:'Design that works',slug:'editorial-'+crypto.randomUUID(),visibility:'public',submissionPolicy:'anyone',requireApproval:true,tags:['design'],description:'Interfaces that explain themselves. Visual references, useful reads, and small ideas to keep beside your next project.'}});
 assert.equal(created.status(),201);const c=(await created.json()).collection;
 for(let i=0;i<27;i++){
  let captureId;
  if([22,24].includes(i)){
   const name=i===24?'studio-architecture-640.webp':'foundkeep-coastal-800.webp';
   const bytes=await readFile(new URL('../apps/web/assets/'+name,import.meta.url));
   const saved=await owner.request.post(base+'/api/captures',{headers:{Origin:base},data:{clientId:crypto.randomUUID(),type:'image',dataUrl:'data:image/webp;base64,'+bytes.toString('base64'),processingOptions:{ocr:false,summaries:false,tags:false}}});
   assert.equal(saved.status(),201);captureId=(await saved.json()).capture.id;
  }
  const titles={26:'Think in components, then in states',25:'Leave room for the idea',24:'Shape, light, and useful space',23:'One clear next step',22:'A quieter canvas',21:'Good feedback makes an interface feel faster'};
  const bodies={26:'A useful design reference keeps the structure, the content, and the interaction in view. '.repeat(8),25:'Start with what someone came here to do. Give that action enough space to be found, and let the supporting details follow.',24:'A visual reference from the FoundKeep studio.',23:'Make the next useful action easy to see.',22:'Muted tones let the content lead.',21:'Show what changed when someone takes an action. A saved state, an inline explanation, or a small motion can help them continue with confidence.'};
  const r=await owner.request.post(base+`/api/collections/${c.id}/entries`,{headers:{Origin:base},data:{clientId:crypto.randomUUID(),title:i===0?'Older needle in a long collection':titles[i]||'A useful reference '+i,...(!captureId&&![21,23,25].includes(i)?{url:'https://example.com/reference-'+i}:{}),body:bodies[i]||'A short explanation for a useful source.',tags:[i===0?'older':'recent'],...captureId?{captureId,shareImage:true}:{}}});assert.equal(r.status(),201);
 }
 const page=await guest.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw new Error('Permission denied');}}}));
 const path='/collection/'+c.slug;await page.goto(base+path);await page.getByRole('heading',{name:c.title,exact:true}).waitFor();
 await page.locator('.collection-entries[data-layout=masonry]').waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('.shared-entry-image')].every(img=>img.complete&&img.naturalHeight>0));
 async function checkMasonry(){
  await page.waitForFunction(()=>{
   const cards=[...document.querySelectorAll('.public-find')].map(el=>el.getBoundingClientRect());
   const container=document.querySelector('.collection-entries').getBoundingClientRect();
   return cards.every(a=>a.left>=container.left-1&&a.right<=container.right+1)&&cards.every((a,i)=>cards.every((b,j)=>i===j||a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1));
  });
  const layout=await page.locator('.collection-entries').evaluate(el=>({width:el.getBoundingClientRect().width,heights:[...el.children].map(card=>Math.round(card.getBoundingClientRect().height))}));
  assert.ok(new Set(layout.heights).size>=4,'Content determines card height');
  assert.equal(await page.locator('.collection-context').count(),0);
 }
 await checkMasonry();
 assert.equal(await page.getByText('How this collection works',{exact:true}).count(),0);
 assert.equal(await page.locator('.public-find').count(),24);
 assert.equal(await page.locator('.collection-find-feed').getAttribute('data-view'),'grid');
 await page.evaluate(()=>window.scrollTo(0,400));assert.equal(await page.locator('.public-collection-nav').evaluate(el=>Math.round(el.getBoundingClientRect().top)),0);assert.equal(await page.locator('.public-collection-nav').evaluate(el=>Math.round(el.getBoundingClientRect().width)),1440);await page.evaluate(()=>scrollTo(0,0));
 await mkdir('.impeccable/review/friends-beta',{recursive:true});
 await page.screenshot({path:'.impeccable/review/friends-beta/collection-after-desktop.png'});
 await page.getByRole('button',{name:'Switch to dark mode',exact:true}).click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
 const darkCardBackgrounds=await page.locator('.public-find').evaluateAll(cards=>cards.map(card=>getComputedStyle(card).backgroundColor));
 assert.ok(darkCardBackgrounds.length>0&&darkCardBackgrounds.every(color=>color==='rgb(15, 16, 17)'),`Every dark public card uses the approved surface color, including notes: ${[...new Set(darkCardBackgrounds)].join(', ')}`);
 await page.screenshot({path:'.impeccable/review/friends-beta/collection-after-dark-desktop.png'});
 await page.setViewportSize({width:390,height:844});await checkMasonry();await page.screenshot({path:'.impeccable/review/friends-beta/collection-after-dark-phone.png'});await page.locator('.collection-entries').scrollIntoViewIfNeeded();await page.screenshot({path:'.impeccable/review/friends-beta/collection-cards-dark-phone.png'});await page.evaluate(()=>scrollTo(0,0));
 await page.evaluate(()=>localStorage.setItem('foundkeep.appearance','system'));await page.emulateMedia({colorScheme:'light'});await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');await page.screenshot({path:'.impeccable/review/friends-beta/collection-after-phone.png'});
 await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');await page.getByRole('button',{name:'Switch to light mode',exact:true}).click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');await page.setViewportSize({width:1440,height:1000});

 await page.getByLabel('Search this collection',{exact:true}).fill('Older needle');await page.getByRole('button',{name:'Search',exact:true}).click();
 await page.getByRole('heading',{name:'Older needle in a long collection',exact:true}).waitFor();assert.equal(await page.locator('.public-find').count(),1);assert.equal(new URL(page.url()).searchParams.get('q'),'Older needle');
 await page.getByRole('link',{name:'Clear filters',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.public-find').length===24);
 await page.getByLabel('Filter by topic').selectOption('older');await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('heading',{name:'Older needle in a long collection',exact:true}).waitFor();assert.equal(await page.locator('.public-find').count(),1);
 await page.getByRole('link',{name:'Clear filters',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.public-find').length===24);
 await page.getByRole('button',{name:'Grid view',exact:true}).click();assert.equal(await page.locator('.collection-find-feed').getAttribute('data-view'),'grid');
 const privateReads=[];page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/captures/'))privateReads.push(request.url());});
 const readFind=page.getByRole('button',{name:'Read Think in components, then in states',exact:true});
 await readFind.focus();await page.keyboard.press('Enter');
 const reader=page.getByRole('dialog',{name:'Think in components, then in states',exact:true});await reader.waitFor();
 assert.equal(await reader.locator('.snapshot-body').textContent(),'A useful design reference keeps the structure, the content, and the interaction in view. '.repeat(8).trim());
 assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
 assert.equal(await reader.getByRole('button',{name:'Close find'}).evaluate(el=>el===document.activeElement),true);
 assert.match(await reader.locator('.reader-context').textContent(),/Editorial test curator/);
 assert.equal(await reader.getByRole('link',{name:'Open original source',exact:true}).getAttribute('href'),'https://example.com/reference-26');
 assert.equal(await reader.getByRole('link',{name:'Open original source',exact:true}).getAttribute('target'),'_blank');
 await page.keyboard.press('Shift+Tab');assert.equal(await reader.evaluate(el=>el.contains(document.activeElement)),true,'Dialog traps focus');
 await page.keyboard.press('Escape');await reader.waitFor({state:'hidden'});
 assert.equal(await readFind.evaluate(el=>el===document.activeElement),true,'Reader returns focus to the originating card');
 assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
 await page.keyboard.press('Space');await reader.waitFor();await reader.getByRole('button',{name:'Close find'}).click();
 await page.locator('.public-find').filter({hasText:'Think in components, then in states'}).locator('.shared-entry-preview').click();await reader.waitFor();await page.keyboard.press('Escape');
 const imageCard=page.locator('.public-find').filter({hasText:'Shape, light, and useful space'});await imageCard.locator('.shared-entry-image').click();
 const imageReader=page.getByRole('dialog',{name:'Shape, light, and useful space',exact:true});await imageReader.waitFor();assert.equal(await imageReader.locator('.snapshot-media img').count(),1);await imageReader.getByRole('button',{name:'Close find'}).click();
 assert.deepEqual(privateReads,[],'Published reader never fetches a private capture');
 await checkMasonry();
 await page.getByRole('button',{name:'List view',exact:true}).click();
 await page.getByRole('button',{name:'Share collection',exact:true}).click();assert.equal(await page.getByLabel('Collection link',{exact:true}).inputValue(),base+path);
 await readFind.click();await reader.waitFor();await reader.getByRole('button',{name:'Close find'}).click();
 await page.getByRole('button',{name:'Load more finds'}).click();await page.waitForFunction(()=>document.querySelectorAll('.public-find').length===27);
 for(const width of [1920,1440,820,390,320]){
  await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${width}`);
  if(width<=390){const contribute=page.getByRole('link',{name:'Log in to contribute',exact:true});assert.equal(await contribute.count(),1);assert.ok(await contribute.evaluate(el=>Boolean(el.closest('.collection-profile'))));}
  for(const name of ['Grid view','List view','Search','Share collection']){const bounds=await page.getByRole('button',{name,exact:true}).boundingBox();const minimum=width<=760?44:32;assert.ok(bounds.height>=minimum&&bounds.width>=minimum,`${name} target at ${width}`);}
 }
 // A wide tablet is still a touch device: independent source actions retain their target size.
 const touchContext=await browser.newContext({viewport:{width:1024,height:900},hasTouch:true,reducedMotion:'reduce'});
 const touchPage=await touchContext.newPage();await touchPage.goto(base+path);
 assert.equal(await touchPage.evaluate(()=>matchMedia('(pointer:coarse)').matches),true);
 const sourceTarget=touchPage.locator('.shared-entry-source').first();await sourceTarget.waitFor();
 const sourceBounds=await sourceTarget.boundingBox();assert.ok(sourceBounds.width>=44&&sourceBounds.height>=44,'Wide touch source links have 44px targets');
 await touchContext.close();
 // The mobile contribution action opens the real form and focuses its first field.
 const signed=await owner.newPage();await signed.setViewportSize({width:390,height:1000});await signed.goto(base+path);await signed.getByRole('button',{name:'Add a find',exact:true}).click();
 const form=signed.getByRole('form',{name:'Add to collection'});assert.ok(await form.getByLabel('Title',{exact:true}).evaluate(el=>el===document.activeElement));
 const noJs=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:1000}});const basic=await noJs.newPage();await basic.goto(base+path);await basic.getByRole('heading',{name:c.title,exact:true}).waitFor();
 assert.equal(await basic.locator('.public-find').count(),24);assert.equal(await basic.locator('.shared-entry-preview').first().evaluate(el=>getComputedStyle(el).webkitLineClamp),'none','Complete snapshot text is readable without JavaScript');await basic.getByLabel('Search this collection',{exact:true}).fill('Older needle');await basic.getByRole('button',{name:'Search',exact:true}).click();await basic.getByRole('heading',{name:'Older needle in a long collection',exact:true}).waitFor();assert.equal(await basic.locator('.public-find').count(),1);
 await page.goto(base+'/collections?q=unmatched-'+crypto.randomUUID());await page.getByRole('heading',{name:'No collections match yet.'}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);
});
