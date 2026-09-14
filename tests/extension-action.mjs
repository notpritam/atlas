import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { actionPanel } from './helpers/action-panel.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');

test('toolbar opens the native sidebar with no popup, and notes, local saves and settings stay inside it', { timeout: 30000 }, async () => {
  const extension = process.env.FOUNDKEEP_TEST_EXTENSION || path.resolve('apps/extension');
  const profile = await mkdtemp('/tmp/foundkeep-panel-test-');
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: process.env.FOUNDKEEP_HEADLESS !== 'false', executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ['--no-sandbox', '--window-size=1280,1000', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    assert.equal(await worker.evaluate(() => chrome.action.getPopup({})), '');
    assert.equal(await worker.evaluate(async () => (await chrome.sidePanel.getPanelBehavior()).openPanelOnActionClick), true);
    const origin = await worker.evaluate(() => new URL(chrome.runtime.getManifest().host_permissions[0]).origin);
    await context.route(origin + '/__panel-fixture', route => route.fulfill({ contentType: 'text/html', body: '<title>A page worth keeping</title><p>A thoughtful little corner of the internet.</p>' }));
    const tab = await context.newPage(); await tab.goto(origin + '/__panel-fixture');
    const panel = await actionPanel(context, tab, worker);
    await panel.waitFor('document.body.dataset.preferencesReady === "true" && document.querySelector("#currentPage").textContent === "A page worth keeping"');
    // Headless Chrome creates the native panel target without browser chrome.
    // Give that target a viewport; headed runs verify Chrome's actual geometry.
    if(process.env.FOUNDKEEP_HEADLESS !== 'false')await panel.send('Emulation.setDeviceMetricsOverride',{width:390,height:850,deviceScaleFactor:1,mobile:false});
    else await panel.waitFor('innerWidth > 0 && innerHeight > 0');
    await panel.evaluate('document.fonts.ready.then(() => true)');
    const bounds=await panel.evaluate('({width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth})');
    assert.equal(bounds.scroll > bounds.width, false, JSON.stringify(bounds));
    assert.equal(await panel.evaluate('document.querySelectorAll("[data-capture]").length'), 4);
    const tabCount = context.pages().length;
    await panel.evaluate('document.querySelector("#newNote").click()');
    await panel.waitFor('document.querySelector("#noteDialog").open');
    await panel.evaluate('document.querySelector("#note").focus()');
    await panel.send('Input.insertText', { text: 'Saved from the native sidebar' });
    await panel.evaluate('document.querySelector("#save").click()');
    await panel.waitFor('document.querySelector("#destinationDialog").open');
    await panel.evaluate('document.querySelector("#saveDestination").value="local";document.querySelector("#saveDestination").dispatchEvent(new Event("change"));document.querySelector("#destinationConfirm").click()');
    await panel.waitFor('!document.querySelector("#destinationDialog").open');
    assert.equal(await panel.evaluate("import('./db.js').then(db => db.listCaptures()).then(rows => rows[0].noteText)"), 'Saved from the native sidebar');
    await panel.evaluate('document.querySelector("#openLocal").click()');
    await panel.waitFor('document.querySelectorAll("#localItems .save-card").length === 1');
    await panel.evaluate('document.querySelector("#localItems .save-card").click()');
    await panel.waitFor('document.querySelector("#localText").textContent === "Saved from the native sidebar"');
    await panel.evaluate('document.querySelector("#localDialog").close();document.querySelector("#openSettings").click()');
    await panel.waitFor('document.querySelector("#settingsDialog").open');
    assert.equal(context.pages().length, tabCount, 'No local library or settings tabs opened');
    await panel.evaluate('document.querySelector("#settingsDialog").close()');
    if (process.env.FOUNDKEEP_PANEL_SCREENSHOT) {
      const { data } = await panel.send('Page.captureScreenshot');
      await writeFile(process.env.FOUNDKEEP_PANEL_SCREENSHOT, Buffer.from(data, 'base64'));
    }
    // A persistent panel must identify tab switches and reject an old target.
    const old = await worker.evaluate(async () => (await chrome.tabs.query({active:true,currentWindow:true}))[0]);
    const other = await context.newPage(); await other.goto('about:blank');
    const stale = await panel.evaluate(`chrome.runtime.sendMessage({kind:'capture',source:'sidebar',action:'savepage',tabId:${old.id},windowId:${old.windowId},tabUrl:${JSON.stringify(old.url)}})`);
    assert.equal(stale.ok, false); assert.match(stale.error, /page changed/i);
    await panel.waitFor('document.querySelector("#saveCurrent").disabled');
    await panel.close();
  } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
});
