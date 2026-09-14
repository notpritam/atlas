import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {actionPanel} from './helpers/action-panel.mjs';

test('an X save opens a destination review without saving until confirmation, and cancel saves nothing', {timeout:30000}, async t=>{
 const profile=await mkdtemp('/tmp/foundkeep-destination-');let context;
 t.after(async()=>{await context?.close();await rm(profile,{recursive:true,force:true});});
 const extension=process.env.FOUNDKEEP_TEST_EXTENSION||path.resolve('apps/extension');
 context=await chromium.launchPersistentContext(profile,{headless:process.env.FOUNDKEEP_HEADLESS!=='false',executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 await context.route('https://x.com/**',route=>route.fulfill({contentType:'text/html',body:'<title>X fixture</title><article data-testid="tweet"><div data-testid="User-Name">Mina</div><a href="/mina/status/123456789"><time>Today</time></a><div data-testid="tweetText">A tweet worth keeping.</div><div role="group"><button data-testid="reply">Reply</button></div></article>'}));
 const web=await context.newPage();await web.goto('https://x.com/home');
 const button=web.locator('article [data-state]');await button.waitFor();await button.click();
 await web.waitForFunction(()=>document.querySelector('article [data-state]').dataset.state!=='saving');
 assert.equal(await button.getAttribute('data-state'),'choosing','Clicking an X button must review the destination, not immediately save');
 const panel=await actionPanel(context,web,worker,{open:false});
 await panel.send('Emulation.setDeviceMetricsOverride',{width:390,height:850,deviceScaleFactor:1,mobile:false});
 await panel.waitFor('document.querySelector("#destinationDialog").open');
 if(process.env.FOUNDKEEP_DESTINATION_SCREENSHOT){const {data}=await panel.send('Page.captureScreenshot');await writeFile(process.env.FOUNDKEEP_DESTINATION_SCREENSHOT,Buffer.from(data,'base64'));}
 const count=()=>panel.evaluate("import('./db.js').then(db=>db.listCaptures()).then(rows=>rows.length)");
 assert.equal(await count(),0);
 await panel.evaluate('document.querySelector("#destinationCancel").click()');
 await panel.waitFor('!document.querySelector("#destinationDialog").open');assert.equal(await count(),0);
 await button.click();await panel.waitFor('document.querySelector("#destinationDialog").open');
 await panel.evaluate('document.querySelector("#saveDestination").value="local";document.querySelector("#saveDestination").dispatchEvent(new Event("change"));document.querySelector("#destinationConfirm").click()');
 await panel.waitFor('!document.querySelector("#destinationDialog").open');
 assert.equal(await count(),1);
 const saved=await panel.evaluate("import('./db.js').then(db=>db.listCaptures()).then(rows=>rows[0])");
 assert.equal(saved.selectionText,'A tweet worth keeping.');assert.equal(saved.cloudAccountId,null);
 assert.equal(saved.sourceUrl,'https://x.com/mina/status/123456789');
 await web.waitForFunction(()=>document.querySelector('article [data-state]').dataset.state==='saved');
 assert.doesNotMatch(await button.getAttribute('aria-label'),/atlas/i);
 // The draft survives a fresh module instance, and a different account cannot
 // take over an outstanding save, even if it chooses local storage.
 await button.click();await panel.waitFor('document.querySelector("#destinationDialog").open');
 const pending=await panel.evaluate("chrome.windows.getCurrent().then(async window=>(await import('./save-review.js?fresh')).readSaveReview(window.id))");
 assert.equal(pending.tweet.text,'A tweet worth keeping.');
 await panel.evaluate("chrome.storage.local.set({atlasCustomer:{account:{id:'different-account'},connection:{id:'different-connection'},token:null,status:'reconnect'}})");
 const denied=await panel.evaluate(`chrome.runtime.sendMessage({kind:'save-review-confirm',windowId:${pending.tab.windowId},id:${JSON.stringify(pending.id)},choice:{kind:'local'}})`);
 assert.equal(denied.ok,false);assert.match(denied.error,/account changed/);assert.equal(await count(),1);
 await panel.evaluate('chrome.storage.local.remove("atlasCustomer")');
 await panel.evaluate('document.querySelector("#destinationCancel").click()');

});
