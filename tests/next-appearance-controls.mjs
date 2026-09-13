import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright-core';

const base=process.env.FOUNDKEEP_WEB_TEST_URL||'http://127.0.0.1:18791';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Use a disposable local backend.');

function channel(value){value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;}
function luminance([red,green,blue]){return .2126*channel(red)+.7152*channel(green)+.0722*channel(blue);}
function ratio(first,second){const light=Math.max(luminance(first),luminance(second)),dark=Math.min(luminance(first),luminance(second));return (light+.05)/(dark+.05);}

async function computedContrast(page,foregroundSelector,backgroundSelector,{under=[0,60,104]}={}){
 const colors=await page.evaluate(({foregroundSelector,backgroundSelector})=>{
  const foreground=document.querySelector(foregroundSelector),background=document.querySelector(backgroundSelector);
  if(!(foreground instanceof HTMLElement)||!(background instanceof HTMLElement))throw new Error(`Missing contrast target: ${foregroundSelector} / ${backgroundSelector}`);
  return {foreground:getComputedStyle(foreground).color,background:getComputedStyle(background).backgroundColor};
 },{foregroundSelector,backgroundSelector});
 const parse=value=>{const parts=value.match(/[\d.]+/g)?.map(Number);assert.ok(parts&&parts.length>=3,`Could not parse ${value}`);return parts;};
 const foreground=parse(colors.foreground),rawBackground=parse(colors.background),alpha=rawBackground[3]??1;
 const background=rawBackground.slice(0,3).map((value,index)=>value*alpha+under[index]*(1-alpha));
 return {ratio:ratio(foreground,background),...colors};
}

test('compact appearance control, beta downloads, and dark account surfaces stay usable',async t=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']}),auth=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 t.after(()=>browser.close());
 await auth.addInitScript(()=>localStorage.setItem('foundkeep.appearance','dark'));
 const page=await auth.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await mkdir('.impeccable/review/friends-beta',{recursive:true});

 for(const route of ['login','signup','recover']){
  await page.goto(`${base}/${route}`);await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  const note=await computedContrast(page,'.auth-story-note','.auth-story-note');
  assert.ok(note.ratio>=4.5,`${route} story note contrast is ${note.ratio.toFixed(2)}:1 (${note.foreground} on ${note.background})`);
  await page.screenshot({path:`.impeccable/review/friends-beta/${route}-dark-desktop.png`,fullPage:true});
 }

 await page.goto(base+'/beta');await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
 const toggle=page.getByRole('button',{name:'Switch to light mode',exact:true});
 const bounds=await toggle.boundingBox();assert.ok(bounds&&bounds.width>=48&&bounds.height>=48,'Compact theme button has a 48px target');
 assert.equal(await toggle.getAttribute('title'),'Switch to light mode');
 assert.equal(await page.getByLabel('Appearance',{exact:true}).count(),0,'Compact control has no text dropdown');
 assert.equal(await page.getByRole('link',{name:'Download extension',exact:true}).getAttribute('href'),'https://foundkeep.app/foundkeep-extension.zip');
 const darkThemeColors=await page.locator('meta[name="theme-color"]').evaluateAll(metas=>metas.map(meta=>meta.getAttribute('content')));
 assert.ok(darkThemeColors.length>0&&darkThemeColors.every(color=>color==='#16191d'));
 await toggle.click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
 assert.equal(await page.getByRole('button',{name:'Switch to dark mode',exact:true}).getAttribute('title'),'Switch to dark mode');
 assert.equal(await page.evaluate(()=>localStorage.getItem('foundkeep.appearance')),'light');
 const lightThemeColors=await page.locator('meta[name="theme-color"]').evaluateAll(metas=>metas.map(meta=>meta.getAttribute('content')));
 assert.ok(lightThemeColors.length>0&&lightThemeColors.every(color=>color==='#f5fafc'));
 const devBeta=await auth.request.get(base+'/beta',{headers:{Host:'dev.foundkeep.app'}});assert.equal(devBeta.status(),200);
 assert.match(await devBeta.text(),/https:\/\/dev\.foundkeep\.app\/ext\/foundkeep-extension-dev\.zip/);

 const account=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'reduce'}),password='Appearance-test-password-516902';
 await account.addInitScript(()=>localStorage.setItem('foundkeep.appearance','dark'));
 const registration=await account.request.post(base+'/api/auth/register',{headers:{Origin:base},data:{name:'Appearance tester',email:`appearance-${crypto.randomUUID()}@example.test`,password}});assert.equal(registration.status(),201,await registration.text());
 t.after(async()=>{await account.request.delete(base+'/api/account',{headers:{Origin:base},data:{password}}).catch(()=>{});await account.close();});
 const dashboard=await account.newPage();dashboard.on('pageerror',error=>errors.push(error.message));await dashboard.goto(base+'/dashboard/apps');await dashboard.getByRole('heading',{name:'Apps & devices',exact:true}).waitFor();
 for(const [foreground,background] of [['.iphone-option > p:first-of-type','.iphone-option'],['.iphone-share-steps','.iphone-option']]){
  const result=await computedContrast(dashboard,foreground,background,{under:[33,63,53]});
  assert.ok(result.ratio>=4.5,`${foreground} contrast is ${result.ratio.toFixed(2)}:1 (${result.foreground} on ${result.background})`);
 }
 for(const [selector,under] of [['.browser-option .device-badge',[34,60,78]],['.browser-option .step-marker',[32,37,42]]]){
  const result=await computedContrast(dashboard,selector,selector,{under});
  assert.ok(result.ratio>=4.5,`${selector} contrast is ${result.ratio.toFixed(2)}:1 (${result.foreground} on ${result.background})`);
 }
 await dashboard.screenshot({path:'.impeccable/review/friends-beta/apps-devices-dark-desktop.png',fullPage:true});
 await dashboard.getByRole('button',{name:'Open account menu',exact:true}).click();
 const sidebarToggle=dashboard.getByRole('button',{name:'Switch to light mode',exact:true}),sidebarBounds=await sidebarToggle.boundingBox();
 assert.ok(sidebarBounds&&sidebarBounds.width===48&&sidebarBounds.height===48,'Sidebar uses the shared 48px compact theme button');
 await dashboard.goto(base+'/dashboard/settings');
 const choices=dashboard.getByRole('group',{name:'Appearance',exact:true});
 await choices.waitFor();
 for(const name of ['Light','Dark','System'])assert.equal(await choices.getByRole('button',{name,exact:true}).count(),1);
 await choices.getByRole('button',{name:'System',exact:true}).click();
 assert.equal(await dashboard.evaluate(()=>localStorage.getItem('foundkeep.appearance')),'system');
 assert.deepEqual(errors,[]);
});
