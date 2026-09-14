import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';
let browser;before(async()=>{browser=await chromium.launch({headless:true,args:['--no-sandbox']});});after(async()=>browser?.close());
async function fixture(t,width=390){
 const context=await browser.newContext({viewport:{width,height:850}});t.after(()=>context.close());
 await context.route('https://foundkeep-extension.test/**',async route=>{
  const file=new URL(route.request().url()).pathname;
  try{await route.fulfill({body:await readFile(path.join('apps/extension',file)),contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.svg')?'image/svg+xml':undefined});}catch{await route.fulfill({status:404});}
 });
 await context.addInitScript(()=>{
  window.fixture={activeTab:{id:12,windowId:1,title:'A page to keep',url:'https://example.org/article'},listeners:[],tabListeners:[],account:'account-a',requests:[],captures:Array.from({length:12},(_,i)=>({id:'save-'+i,type:i%3?'bookmark':'note',sourceTitle:['A quiet place to think','Building better habits through small rituals','Design notes for the weekend'][i%3],sourceUrl:i%3?'https://example.com/read/'+i:null,noteText:i%3?null:'Keep the little things that make the day feel yours.',createdAt:Date.now()-i*65000,updatedAt:10,userTags:['inspiration'],folderId:'folder-a',savedVia:i%2?'iphone':'browser'}))};
  const storage={};window.chrome={storage:{local:{get:async key=>({[key]:storage[key]}),set:async value=>Object.assign(storage,value)}},permissions:{request:async()=>false},bookmarks:{getTree:async()=>[]},runtime:{getManifest:()=>({version:"9.8.7"}),onMessage:{addListener:listener=>fixture.listeners.push(listener)},getURL:path=>'https://foundkeep-extension.test/'+path,sendMessage:async msg=>{
    fixture.requests.push(msg);
    if(msg.kind==='save-review-get')return{ok:true,draft:fixture.reviewDraft||null};
    if(msg.kind==='prepare-save'){if(msg.action==='note'&&fixture.noteError)return{ok:false,error:fixture.noteError};return{ok:true,draft:{id:'review',action:msg.action,text:msg.text}};}
    if(msg.kind==='saveNote')return fixture.noteError?{ok:false,error:fixture.noteError}:{ok:true,capture:{id:'new-note',cloudStatus:'local'}};
    if(msg.kind==='cloud-status')return{ok:true,account:fixture.account?{id:fixture.account,name:'Alex Morgan'}:null,status:fixture.account?'connected':'disconnected'};
    if(msg.kind==='bookmark-import-status')return{ok:true,data:null};
    if(msg.kind==='library-request'){
      if(msg.operation==='organization')return{ok:true,data:{folders:[{id:'folder-a',name:'Reading',count:12}],tags:[{name:'inspiration',count:12}]}};
      if(msg.operation==='list'){const values=fixture.captures.filter(c=>!msg.args.q||c.sourceTitle.toLowerCase().includes(msg.args.q.toLowerCase()));return{ok:true,data:{captures:values,total:values.length,nextCursor:null}};}
      if(msg.operation==='detail')return{ok:true,data:{capture:fixture.captures.find(c=>c.id===msg.args.id)}};
      if(msg.operation==='preservation')return{ok:true,data:{preservation:fixture.preservation||null}};
      if(msg.operation==='asset-chunk')return{ok:true,data:fixture.assetChunk};
      if(msg.operation==='update'){const c=fixture.captures.find(c=>c.id===msg.args.id);Object.assign(c,msg.args.value,{updatedAt:11});return{ok:true,data:{capture:c}};}
      if(msg.operation==='import-preview')return{ok:true,data:{newBookmarks:msg.args.entries.length,duplicates:0,folders:1,skipped:0,fitsCaptureLimit:true}};
    }
    return{ok:true,data:{}};
  }},windows:{getCurrent:async()=>({id:1})},tabs:{query:async()=>[fixture.activeTab],onActivated:{addListener:listener=>fixture.tabListeners.push(listener)},onUpdated:{addListener:()=>{}},create:async()=>{fixture.openedTab=true;}}};
 });
 const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('https://foundkeep-extension.test/src/library.html');await page.locator('.save-card').first().waitFor();return{page,errors};
}
test('sidebar searches, edits, switches layouts and has no horizontal overflow at narrow widths',async t=>{
 const {page,errors}=await fixture(t,320);assert.equal(await page.locator('.save-card').count(),12);
 await page.locator('#q').fill('quiet');await page.waitForFunction(()=>document.querySelectorAll('.save-card').length===4);
 await page.locator('.save-card').first().click();await page.locator('#editTitle').fill('A better title');await page.locator('#saveEdit').click();
 await page.waitForFunction(()=>document.querySelector('#detail').hidden);await page.locator('#q').fill('');await page.waitForFunction(()=>document.querySelectorAll('.save-card').length===12);
 await page.locator('#toggleView').click();assert.equal(await page.locator('.items.gallery').count(),1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
});

test('image permission is requested only after destination confirmation and denial retains the review',async t=>{
 const {page,errors}=await fixture(t);
 await page.evaluate(()=>{
  fixture.permissionRequests=[];
  chrome.permissions.request=async value=>{fixture.permissionRequests.push(value);return false;};
  fixture.reviewDraft={id:'image-review',accountId:null,action:'save-image',tab:{id:12,windowId:1,url:'https://example.org/article',title:'An image worth keeping'},info:{srcUrl:'https://images.example.org/photo.png'}};
  fixture.listeners.forEach(listener=>listener({kind:'foundkeep-save-review-changed'}));
 });
 await page.waitForFunction(()=>document.querySelector('#destinationDialog').open);
 assert.equal(await page.evaluate(()=>fixture.permissionRequests.length),0);
 await page.locator('#saveDestination').selectOption('local');
 await page.locator('#destinationConfirm').click();
 await page.waitForFunction(()=>document.querySelector('#destinationFeedback').textContent.includes('Allow access'));
 assert.deepEqual(await page.evaluate(()=>fixture.permissionRequests),[{origins:['https://images.example.org/*']}]);
 assert.equal(await page.evaluate(()=>fixture.requests.some(msg=>msg.kind==='save-review-confirm')),false);
 assert.equal(await page.locator('#destinationDialog').evaluate(dialog=>dialog.open),true);
 assert.equal(await page.locator('#destinationConfirm').isEnabled(),true);
 assert.deepEqual(errors,[]);
});
test('permission denial offers HTML import and shows a review before saving',async t=>{
 const {page,errors}=await fixture(t);await page.locator('#openImport').click();await page.locator('#readBrowser').click();assert.match(await page.locator('#importError').innerText(),/not granted/);
 await page.locator('#importFile').setInputFiles({name:'bookmarks.html',mimeType:'text/html',buffer:Buffer.from('<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><H3>Reading</H3><DL><DT><A HREF="https://example.org/read" ADD_DATE="1000">Keep this</A></DL></DL>')});
 await page.waitForFunction(()=>!document.querySelector('#confirmImport').disabled);assert.match(await page.locator('#importPreview').innerText(),/1 new bookmark/);
 assert.equal(await page.evaluate(()=>fixture.requests.some(msg=>msg.kind==='bookmark-import-start')),false);assert.deepEqual(errors,[]);
});
test('sidebar gallery preview is readable in light and dark appearance',async t=>{
 const {page,errors}=await fixture(t,400);await page.locator('#toggleView').click();await mkdir('docs/agentic-preview',{recursive:true});
 await page.evaluate(()=>document.fonts.ready);
 await page.waitForFunction(()=>document.querySelector('#items').getBoundingClientRect().height>500);
 await page.screenshot({path:'docs/agentic-preview/sidebar-light.png',fullPage:true,animations:'disabled'});await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:'docs/agentic-preview/sidebar-dark.png',fullPage:true,animations:'disabled'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
});

test('sidebar captures the displayed tab, keeps note drafts on failure, and opens settings and local saves in place',async t=>{
 const {page,errors}=await fixture(t,320);
 await page.locator('#saveCurrent').click();
 const capture=await page.evaluate(()=>fixture.requests.find(msg=>msg.kind==='prepare-save'));
 assert.equal(capture.source,'sidebar');assert.equal(capture.tabId,12);assert.equal(capture.windowId,1);assert.equal(capture.tabUrl,'https://example.org/article');
 await page.evaluate(()=>{fixture.activeTab={id:13,windowId:1,title:'Next page',url:'https://example.org/next'};fixture.tabListeners.forEach(listener=>listener({windowId:1}));});
 await page.waitForFunction(()=>document.querySelector('#currentPage').textContent==='Next page');
 await page.locator('#newNote').click();await page.locator('#note').fill('Keep this draft');
 await page.evaluate(()=>{fixture.noteError='Storage is full. Please try again.';});await page.locator('#save').click();
 assert.match(await page.locator('#noteFeedback').textContent(),/Storage is full/);assert.equal(await page.locator('#note').inputValue(),'Keep this draft');
 await page.evaluate(()=>{fixture.noteError=null;});await page.locator('#save').click();await page.waitForFunction(()=>!document.querySelector('#noteDialog').open);
 assert.equal(await page.locator('#note').inputValue(),'Keep this draft','Do not discard the draft before destination confirmation');
 await page.evaluate(()=>document.dispatchEvent(new CustomEvent('foundkeep-save-completed',{detail:{draft:{action:'note',text:'Keep this draft'},result:{ok:true,capture:{id:'new-note',cloudStatus:'local'}}}})));
 assert.equal(await page.locator('#note').inputValue(),'');
 await page.locator('#openSettings').click();assert.equal(await page.locator('#settingsDialog').evaluate(el=>el.open),true);
 await page.locator('#settingsPageAccess').click();assert.match(await page.locator('#permissionFeedback').textContent(),/not granted/);
 await page.getByRole('button',{name:'Close settings',exact:true}).click();
 await page.evaluate(async()=>{await(await import('/src/db.js')).addCapture({type:'note',noteText:'Only in this browser'});});
 await page.locator('#openLocal').click();await page.locator('#localItems .save-card').click();await page.waitForFunction(()=>!document.querySelector('#localDetail').hidden);assert.equal(await page.locator('#localText').textContent(),'Only in this browser');
 await page.locator('#localDelete').click();await page.locator('#localCancelDelete').click();assert.equal(await page.evaluate(async()=>(await(await import('/src/db.js')).listCaptures()).length),1);
 assert.equal(await page.evaluate(()=>!!fixture.openedTab),false);assert.deepEqual(errors,[]);
});

test('sidebar reads preserved text and private photo copies in place and clears them on navigation',async t=>{
 const {page,errors}=await fixture(t);
 await page.evaluate(()=>{
  fixture.captures[0].sourceUrl='https://x.com/mina/status/12345';
  const base64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEwoAAAAASUVORK5CYII=';
  const bytes=atob(base64).length;
  fixture.preservation={status:'ready',error:null,assets:[{id:'post',kind:'post',title:'Saved post',text:'The exact archived post',bytes:23,mime:'text/plain'},{id:'photo',kind:'image',title:'Photo 1.png',mime:'image/png',bytes}]};
  fixture.assetChunk={base64,bytes,total:bytes,mime:'image/png'};
 });
 await page.locator('.save-card').first().click();
 await page.getByRole('heading',{name:'Source saved',exact:true}).waitFor();
 await page.getByText('Read archived post',{exact:true}).click();
 assert.equal(await page.getByText('The exact archived post',{exact:true}).isVisible(),true);
 await page.getByRole('button',{name:'Load saved photo',exact:true}).click();
 await page.locator('#preservedSource img').waitFor();
 await page.waitForFunction(()=>document.querySelector('#preservedSource img').naturalWidth===1);
 assert.equal(await page.getByRole('link',{name:'Download file',exact:true}).getAttribute('download'),'Photo 1.png');
 assert.ok(await page.evaluate(()=>fixture.requests.some(r=>r.operation==='asset-chunk'&&r.accountId==='account-a'&&r.args.asset==='photo'&&r.args.offset===0)));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.locator('#back').click();assert.equal(await page.locator('#preservedSource img').count(),0);assert.deepEqual(errors,[]);
});
