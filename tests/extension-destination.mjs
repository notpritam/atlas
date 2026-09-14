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
 await context.route('https://x.com/**',route=>route.fulfill({contentType:'text/html',body:`<title>X fixture</title><article data-testid="tweet"><div data-testid="User-Name">Mina</div><a href="/mina/status/123456789"><time>Today</time></a><div data-testid="tweetText">A tweet worth keeping.</div><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/own.jpg"></div><div data-testid="card.wrapper"><a href="https://t.co/blog" title="https://example.org/blog">Blog</a></div><div role="link"><a href="/neighbor/status/999">A quoted post</a><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/quoted.jpg"></div><div data-testid="tweetText"><a href="https://example.org/quoted">Quoted link</a></div></div><div data-testid="videoPlayer"><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/poster.jpg"></div></div><div data-testid="twitterArticleRichTextView">Visible long-form article</div><div role="group"><button data-testid="reply">Reply</button></div></article>`}));
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
 await panel.evaluate(`document.querySelector('#destinationPersonalTitle').value='UI references';document.querySelector('#destinationPersonalTitle').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#destinationNote').value='Use these for our next project';document.querySelector('#destinationNote').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#destinationTags input').value='UI, React';document.querySelector('#destinationTags .save-tag-entry button').click()`);
 await panel.waitFor(`document.querySelectorAll('#destinationTags .selected').length===2`);
 await panel.waitFor(`chrome.storage.session.get(null).then(values=>Object.values(values).some(draft=>draft?.form?.note==='Use these for our next project'&&draft.form.tags.length===2))`);
 await panel.send('Page.reload');
 await panel.waitFor(`document.querySelector('#destinationDialog')?.open && document.querySelector('#destinationNote')?.value==='Use these for our next project'`);
 assert.equal(await panel.evaluate(`document.querySelector('#destinationPersonalTitle').value`),'UI references');
 assert.equal(await panel.evaluate(`document.querySelectorAll('#destinationTags .selected').length`),2);
 await panel.evaluate('document.querySelector("#saveDestination").value="local";document.querySelector("#saveDestination").dispatchEvent(new Event("change"));document.querySelector("#destinationConfirm").click()');
 await panel.waitFor('!document.querySelector("#destinationDialog").open');
 assert.equal(await count(),1);
 const saved=await panel.evaluate("import('./db.js').then(db=>db.listCaptures()).then(rows=>rows[0])");
 assert.equal(saved.selectionText,'A tweet worth keeping.');assert.equal(saved.cloudAccountId,null);
 assert.equal(saved.sourceTitle,'UI references');assert.equal(saved.noteText,'Use these for our next project');assert.deepEqual(saved.userTags,['UI','React']);
 assert.equal(saved.sourceUrl,'https://x.com/mina/status/123456789');
 assert.deepEqual(saved.socialContext,{version:1,images:['https://pbs.twimg.com/media/own.jpg'],links:['https://example.org/blog'],articleText:'Visible long-form article'});
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

 // A retained local-library tab must use the same native review, never silently
 // save to the current account when the user writes a note there.
 const legacy = await context.newPage();
 await legacy.goto(new URL('dashboard.html', worker.url()).href);
 await legacy.locator('#newNote').click();
 await legacy.locator('#libraryNote').fill('A note from the older local library');
 await legacy.locator('#saveLibraryNote').click();
 await panel.waitFor('document.querySelector("#destinationDialog").open');
 assert.equal(await count(), 1, 'The older screen must wait for a destination');
 assert.equal(await legacy.locator('#libraryNote').inputValue(), 'A note from the older local library');
 await panel.evaluate('document.querySelector("#destinationCancel").click()');
 assert.equal(await count(), 1);

});
