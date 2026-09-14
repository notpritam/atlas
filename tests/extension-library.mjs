import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';
let browser;before(async()=>{browser=await chromium.launch({headless:true,args:['--no-sandbox']});});after(async()=>browser?.close());
async function fixture(t,width=390){
 const context=await browser.newContext({viewport:{width,height:850}});t.after(()=>context.close());
 await context.route('http://foundkeep-extension.test/**',async route=>{
  const file=new URL(route.request().url()).pathname;
  try{await route.fulfill({body:await readFile(path.join('apps/extension',file)),contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.svg')?'image/svg+xml':undefined});}catch{await route.fulfill({status:404});}
 });
 await context.addInitScript(()=>{
  window.fixture={account:'account-a',requests:[],captures:Array.from({length:12},(_,i)=>({id:'save-'+i,type:i%3?'bookmark':'note',sourceTitle:['A quiet place to think','Building better habits through small rituals','Design notes for the weekend'][i%3],sourceUrl:i%3?'https://example.com/read/'+i:null,noteText:i%3?null:'Keep the little things that make the day feel yours.',createdAt:Date.now()-i*65000,updatedAt:10,userTags:['inspiration'],folderId:'folder-a',savedVia:i%2?'iphone':'browser'}))};
  const storage={};window.chrome={storage:{local:{get:async key=>({[key]:storage[key]}),set:async value=>Object.assign(storage,value)}},permissions:{request:async()=>false},bookmarks:{getTree:async()=>[]},runtime:{getManifest:()=>({version:"9.8.7"}),onMessage:{addListener:()=>{}},getURL:path=>'http://foundkeep-extension.test/'+path,sendMessage:async msg=>{
    fixture.requests.push(msg);
    if(msg.kind==='cloud-status')return{ok:true,account:fixture.account?{id:fixture.account,name:'Alex Morgan'}:null,status:fixture.account?'connected':'disconnected'};
    if(msg.kind==='bookmark-import-status')return{ok:true,data:null};
    if(msg.kind==='library-request'){
      if(msg.operation==='organization')return{ok:true,data:{folders:[{id:'folder-a',name:'Reading',count:12}],tags:[{name:'inspiration',count:12}]}};
      if(msg.operation==='list'){const values=fixture.captures.filter(c=>!msg.args.q||c.sourceTitle.toLowerCase().includes(msg.args.q.toLowerCase()));return{ok:true,data:{captures:values,total:values.length,nextCursor:null}};}
      if(msg.operation==='detail')return{ok:true,data:{capture:fixture.captures.find(c=>c.id===msg.args.id)}};
      if(msg.operation==='update'){const c=fixture.captures.find(c=>c.id===msg.args.id);Object.assign(c,msg.args.value,{updatedAt:11});return{ok:true,data:{capture:c}};}
      if(msg.operation==='import-preview')return{ok:true,data:{newBookmarks:msg.args.entries.length,duplicates:0,folders:1,skipped:0,fitsCaptureLimit:true}};
    }
    return{ok:true,data:{}};
  }},tabs:{create:async()=>{}}};
 });
 const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://foundkeep-extension.test/src/library.html');await page.locator('.save-card').first().waitFor();return{page,errors};
}
test('sidebar searches, edits, switches layouts and has no horizontal overflow at narrow widths',async t=>{
 const {page,errors}=await fixture(t,320);assert.equal(await page.locator('.save-card').count(),12);
 await page.locator('#q').fill('quiet');await page.waitForFunction(()=>document.querySelectorAll('.save-card').length===4);
 await page.locator('.save-card').first().click();await page.locator('#editTitle').fill('A better title');await page.locator('#saveEdit').click();
 await page.waitForFunction(()=>document.querySelector('#detail').hidden);await page.locator('#q').fill('');await page.waitForFunction(()=>document.querySelectorAll('.save-card').length===12);
 await page.locator('#toggleView').click();assert.equal(await page.locator('.items.gallery').count(),1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
});
test('permission denial offers HTML import and shows a review before saving',async t=>{
 const {page,errors}=await fixture(t);await page.locator('#openImport').click();await page.locator('#readBrowser').click();assert.match(await page.locator('#importError').innerText(),/not granted/);
 await page.locator('#importFile').setInputFiles({name:'bookmarks.html',mimeType:'text/html',buffer:Buffer.from('<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><H3>Reading</H3><DL><DT><A HREF="https://example.org/read" ADD_DATE="1000">Keep this</A></DL></DL>')});
 await page.waitForFunction(()=>!document.querySelector('#confirmImport').disabled);assert.match(await page.locator('#importPreview').innerText(),/1 new bookmark/);
 assert.equal(await page.evaluate(()=>fixture.requests.some(msg=>msg.kind==='bookmark-import-start')),false);assert.deepEqual(errors,[]);
});
test('sidebar gallery preview is readable in light and dark appearance',async t=>{
 const {page,errors}=await fixture(t,400);await page.locator('#toggleView').click();await mkdir('docs/agentic-preview',{recursive:true});
 await page.screenshot({path:'docs/agentic-preview/sidebar-light.png',fullPage:true});await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:'docs/agentic-preview/sidebar-dark.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
});
