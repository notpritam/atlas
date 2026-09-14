import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, cp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { chromium } from 'playwright-core';

const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function poll(fn, timeout=25000) {
  const end=Date.now()+timeout;
  while(Date.now()<end) { const result=await fn(); if(result) return result; await sleep(300); }
  throw new Error('Customer flow did not reach the expected state');
}
async function rewrite(directory, origin) {
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const file=path.join(directory,entry.name);
    if(entry.isDirectory()) await rewrite(file,origin);
    else if(/\.(js|json)$/.test(entry.name)) {
      const text=await readFile(file,'utf8');
      await writeFile(file,text.replaceAll('https://foundkeep.app',origin).replaceAll('https://atlas.notpritam.in',origin));
    }
  }
}

test('customer signs up, configures the real extension, captures a readable page, text and screenshot, and sees an isolated cloud library', {timeout:120000}, async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'atlas-customer-flow-'));
  const reserve=net.createServer(); reserve.listen(0,'127.0.0.1'); await once(reserve,'listening');
  const port=reserve.address().port; await new Promise(resolve=>reserve.close(resolve));
  // Opt-in production verification creates and deletes only its own QA account.
  const deployedOrigin=process.env.ATLAS_CUSTOMER_SITE_URL;
  const nextWeb=process.env.FOUNDKEEP_NEXT_WEB==='1';
  const origin=deployedOrigin ? new URL(deployedOrigin).origin : `http://127.0.0.1:${port}`;
  const extension=path.join(directory,'extension');
  await cp(path.resolve('apps/extension'),extension,{recursive:true});
  await rewrite(extension,origin);
  const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
  manifest.externally_connectable={matches:[`${new URL(origin).protocol}//${new URL(origin).hostname}/*`]};
  // Headless Chromium cannot invoke the toolbar action that grants activeTab.
  // This permission exists only in the disposable test copy so captureVisibleTab
  // and scripting can exercise the same code path against the fixture origin.
  manifest.host_permissions.push('<all_urls>');
  await writeFile(path.join(extension,'manifest.json'),JSON.stringify(manifest));
  const backend=deployedOrigin ? null : spawn(process.env.BUN_BIN || 'bun',['run','apps/backend/src/index.ts'],{
    cwd:process.cwd(),env:{...process.env,ATLAS_PORT:String(port),ATLAS_CUSTOMER_ORIGIN:origin,ATLAS_DATA_DIR:path.join(directory,'data')},stdio:['ignore','pipe','pipe'],
  });
  let backendOutput=''; backend?.stdout.on('data',data=>backendOutput+=data); backend?.stderr.on('data',data=>backendOutput+=data);
  const fixture=http.createServer((_req,res)=>{
    res.writeHead(200,{'content-type':'text/html'});
    res.end('<!doctype html><title>Typography workshop</title><link rel="canonical" href="/workshop"><meta name="author" content="Ada Example"><meta name="description" content="A practical workshop on legible design."><script type="application/ld+json">{"@type":"Article","author":{"name":"Ada Example"},"datePublished":"2026-08-20T10:00:00Z","publisher":{"name":"Example Studio"}}</script><style>body{margin:48px;background:white;color:black;font:32px Arial}article{height:450px}</style><article><h1>Typography workshop</h1><p id="selection">Good design makes information easy to find.</p><h2>Keep the useful context</h2><p>Save the ideas you want to use again. A readable copy should remain useful even when you are offline.</p></article>');
  });
  fixture.listen(0,'127.0.0.1');await once(fixture,'listening');
  let context;
  const email=`qa-${Date.now()}@example.invalid`;
  try {
    await poll(async()=>{ if(backend && backend.exitCode!==null) throw new Error(backendOutput);return fetch(origin+'/healthz').then(r=>r.ok).catch(()=>false); });
    context=await chromium.launchPersistentContext(path.join(directory,'profile'),{
      channel:'chromium',headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,
      args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],
    });
    const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id=new URL(worker.url()).host;
    assert.equal(id,'mjfcgmboaijfcaanepdipbgmipnccnpn');
    const account=await context.newPage();
    const errors=[]; account.on('pageerror',error=>errors.push(error.message));
    await account.goto(origin+(nextWeb?'/signup':'/auth.html'));
    if(nextWeb && !(await account.locator('#email-signin').evaluate(el => el.open))) await account.locator('#email-signin > summary').click();
    await account.locator('#name').fill('FoundKeep customer');
    await account.locator('#email').fill(email);
    await account.locator('#password').fill('a-long-test-password-2026');
    await account.locator('#auth-submit').click();
    await account.locator('#new-recovery-code').waitFor({state:'visible'});
    assert.ok((await account.locator('#new-recovery-code').textContent()).length>20);
    await account.locator('#recovery-saved').check();
    await account.locator('#continue-dashboard').click();
    await account.waitForURL(nextWeb?'**/dashboard':'**/dashboard.html');
    const request=async(method,url,body)=>{
      const response=await context.request.fetch(origin+url,{method,headers:{Origin:origin},data:body});
      const data=await response.json();assert.ok(response.ok(),JSON.stringify(data));return data;
    };
    const me=await request('GET','/api/me');assert.equal(me.account.email,email);
    const pair=await request('POST','/api/pairing',{});
    const connection=await account.evaluate(({id,code})=>new Promise(resolve=>{
      chrome.runtime.sendMessage(id,{kind:'atlas-connect',code},response=>resolve(response || {ok:false,error:chrome.runtime.lastError?.message}));
    }),{id,code:pair.code});
    assert.equal(connection.ok,true,JSON.stringify(connection));
    assert.equal(connection.account.id,me.account.id);
    const ping=await account.evaluate(id=>new Promise(resolve=>chrome.runtime.sendMessage(id,{kind:'atlas-ping'},resolve)),id);
    assert.equal(ping.account.id,me.account.id);assert.equal(ping.token,undefined);
    const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/src/popup.html`);
    const preferenceState=await request('GET','/api/preferences');
    preferenceState.preferences.capture.region=false;
    preferenceState.preferences.popup.recentCount=5;
    const preferenceWrite=await request('PUT','/api/preferences',preferenceState.preferences);
    assert.equal(preferenceWrite.revision,1);
    const preferenceRefresh=await account.evaluate(id=>new Promise(resolve=>chrome.runtime.sendMessage(id,{kind:'atlas-refresh-preferences'},resolve)),id);
    assert.equal(preferenceRefresh.ok,true,JSON.stringify(preferenceRefresh));
    const extensionPreferences=await popup.evaluate(()=>chrome.runtime.sendMessage({kind:'preferences-status'}));
    assert.equal(extensionPreferences.preferences.capture.region,false);
    assert.equal(extensionPreferences.preferences.popup.recentCount,5);
    const note='Remember the typography workshop and bring a notebook.';
    const saved=await popup.evaluate(text=>chrome.runtime.sendMessage({kind:'saveNote',text}),note);
    assert.equal(saved.ok,true,JSON.stringify(saved));
    await poll(async()=>{const result=await request('GET','/api/captures');return result.captures.some(c=>c.noteText===note && c.status==='done');});
    const page=await context.newPage();await page.goto(`http://127.0.0.1:${fixture.address().port}/`);
    await page.evaluate(()=>{const r=document.createRange();r.selectNodeContents(document.querySelector('#selection'));getSelection().addRange(r);});
    await page.bringToFront();
    await popup.evaluate(()=>chrome.runtime.sendMessage({kind:'capture',action:'highlight'}));
    await poll(async()=>{const result=await request('GET','/api/captures');return result.captures.some(c=>c.selectionText?.includes('Good design'));});
    await page.bringToFront();
    const pageCapture=await popup.evaluate(()=>chrome.runtime.sendMessage({kind:'capture',action:'savepage'}));
    assert.equal(pageCapture.ok,true,JSON.stringify(pageCapture));
    const bookmark=await poll(async()=>{const result=await request('GET','/api/captures');return result.captures.find(c=>c.type==='bookmark'&&c.status==='done');});
    assert.match(bookmark.articleText,/readable copy should remain useful/i);
    assert.match(bookmark.provenance.canonicalUrl,/\/workshop$/);
    assert.deepEqual(bookmark.provenance.authors,['Ada Example']);
    assert.equal(bookmark.provenance.siteName,'Example Studio');
    assert.equal(bookmark.provenance.captureMethod,'popup-save-page');
    assert.match(bookmark.provenance.contentHash,/^[A-Za-z0-9_-]{43}$/);
    await page.bringToFront();
    await popup.evaluate(()=>chrome.runtime.sendMessage({kind:'capture',action:'fullpage'}));
    const screenshot=await poll(async()=>{const result=await request('GET','/api/captures');return result.captures.find(c=>c.type==='screenshot'&&c.status==='done');},45000);
    assert.match(screenshot.ocrText,/Typography workshop/i);
    const blob=await context.request.get(origin+screenshot.blobUrl);assert.equal(blob.status(),200);assert.match(blob.headers()['content-type'],/image\/(png|jpeg|webp)/);
    await account.reload();
    await account.getByText(note,{exact:false}).first().waitFor();
    await account.locator('.capture-bookmark .capture-open').click();
    await account.locator('#capture-origin').waitFor({state:'visible'});
    assert.match(await account.locator('#capture-origin').textContent(),/Ada Example/);
    await account.keyboard.press('Escape');
    assert.equal(errors.length,0,errors.join('\n'));
    // Requests without the owning session cannot see the capture or its image.
    assert.equal((await fetch(origin+'/api/captures/'+screenshot.id)).status,401);
    assert.equal((await fetch(origin+screenshot.blobUrl)).status,401);
    const after=await request('GET','/api/me');assert.equal(after.connections.length,1);assert.equal(after.usage.captures,4);
    // Exercise the real service worker import queue and backend from the installed sidebar.
    const library=await context.newPage();await library.goto(`chrome-extension://${id}/src/library.html`);
    await library.waitForFunction(()=>document.querySelector('.save-card')||!document.querySelector('#notice').hidden);
    assert.equal(await library.locator('#notice').innerText(),'');await library.locator('.save-card').first().waitFor();await library.locator('#openImport').click();
    await library.locator('#importFile').setInputFiles({name:'bookmarks.html',mimeType:'text/html',buffer:Buffer.from('<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><DT><H3>Reading</H3><DL><DT><A HREF="https://example.com/imported-one" ADD_DATE="1000">Imported one</A><DT><A HREF="https://example.com/imported-two">Imported two</A></DL></DL>')});
    await library.waitForFunction(()=>!document.querySelector('#confirmImport').disabled);
    assert.match(await library.locator('#importPreview').innerText(),/2 new bookmark/);
    await library.locator('#confirmImport').click();
    await poll(async()=>{const state=await request('GET','/api/captures');return state.captures.filter(c=>c.sourceTitle?.startsWith('Imported ')).length===2;});
    const imported=(await request('GET','/api/captures')).captures.find(c=>c.sourceTitle==='Imported one');
    assert.equal(imported.capturedAt,1_000_000);assert.ok(imported.folderId);
    const importedDetail=await request('GET','/api/captures/'+imported.id);assert.ok(importedDetail.capture.importOrigins?.length);
    await library.reload();await library.locator('.save-card').filter({hasText:'Imported one'}).waitFor();
    await request('DELETE','/api/connections/'+after.connections[0].id);
    await popup.evaluate(()=>chrome.runtime.sendMessage({kind:'saveNote',text:'Saved safely after connection revoked'}));
    await sleep(1500);
    assert.equal((await request('GET','/api/me')).usage.captures,6);
    // A revoked upload never discards the local copy.
    const local=await popup.evaluate(async()=>{const db=await import('./db.js');return db.listCaptures();});
    assert.ok(local.some(c=>c.noteText==='Saved safely after connection revoked'));
    await request('DELETE','/api/account',{password:'a-long-test-password-2026'});
    assert.equal((await context.request.get(origin+'/api/me')).status(),401);
  } finally {
    // If a live assertion fails, remove only this run's authenticated QA account.
    // A fresh temporary profile cannot contain any existing customer session.
    if (context && deployedOrigin) {
      const response = await context.request.get(origin+'/api/me',{timeout:5000}).catch(()=>null);
      if (response?.ok() && (await response.json()).account?.email === email) {
        const cleanup = await context.request.delete(origin+'/api/account',{
          headers:{Origin:origin},data:{password:'a-long-test-password-2026'},timeout:5000,
        }).catch(()=>null);
        if (!cleanup?.ok()) console.error('The disposable live QA account needs cleanup.');
      }
    }
    await context?.close();backend?.kill('SIGTERM');
    if(backend?.exitCode===null) await Promise.race([once(backend,'exit'),sleep(3000)]);
    if(backend?.exitCode===null) backend.kill('SIGKILL');
    await new Promise(resolve=>fixture.close(resolve));
    await rm(directory,{recursive:true,force:true});
  }
});
