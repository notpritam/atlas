import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';

// These checks include disposable account creation. Never target a deployment.
const base=process.env.FOUNDKEEP_WEB_TEST_URL||'http://127.0.0.1:18791';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
let browser;
before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});});
after(async()=>{await browser?.close();});
async function pageFor(t,options={}) {
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',...options});
 t.after(()=>context.close());
 return context.newPage();
}
async function undersized(page) {
 return page.locator('a[href],button,summary').evaluateAll(elements=>elements.filter(el=>el.checkVisibility()&&!el.disabled).flatMap(el=>{
  const box=el.getBoundingClientRect();
  return box.width<47.9||box.height<47.9?[{text:el.textContent.trim(),width:box.width,height:box.height}]:[];
 }));
}

test('homepage search, sharing and install metadata work before JavaScript',async t=>{
 const page=await pageFor(t,{javaScriptEnabled:false});
 await page.goto(base);
 const meta=selector=>page.locator(selector).getAttribute('content');
 assert.match(await meta('meta[name="robots"]'),/index,\s*follow/);
 assert.equal(new URL(await meta('meta[property="og:url"]')).href,'https://foundkeep.app/');
 for(const selector of ['meta[property="og:title"]','meta[name="twitter:title"]']) {
  const title=await meta(selector);assert.ok(title.length>=40&&title.length<=60);
 }
 for(const selector of ['meta[property="og:description"]','meta[name="twitter:description"]']) {
  const description=await meta(selector);assert.ok(description.length>=110&&description.length<=160);
 }
 assert.equal(await meta('meta[name="twitter:card"]'),'summary_large_image');
 const image=await meta('meta[property="og:image"]');
 assert.ok(image.startsWith('https://foundkeep.app/'));
 const response=await page.request.get(base+new URL(image).pathname);
 assert.equal(response.status(),200);
 const bytes=await response.body();
 assert.ok(bytes.length<5*1024**2);
 assert.equal(bytes.readUInt32BE(16),1200);assert.equal(bytes.readUInt32BE(20),630);
 const schema=JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
 assert.equal(schema['@context'],'https://schema.org');
 assert.deepEqual(schema['@graph'].map(item=>item['@type']),['Organization','WebSite','SoftwareApplication']);
 for(const item of schema['@graph'])assert.equal(item.url,'https://foundkeep.app/');
 const manifestResponse=await page.request.get(base+await page.locator('link[rel="manifest"]').getAttribute('href'));
 assert.equal(manifestResponse.status(),200);
 const manifest=await manifestResponse.json();
 assert.equal(manifest.name,'FoundKeep');assert.equal(manifest.start_url,'/dashboard');
 for(const icon of manifest.icons)assert.equal((await page.request.get(base+icon.src)).status(),200);
 const apple=await page.request.get(base+await page.locator('link[rel="apple-touch-icon"]').getAttribute('href'));
 assert.equal(apple.status(),200);
 const appleBytes=await apple.body();assert.equal(appleBytes.readUInt32BE(16),180);assert.equal(appleBytes.readUInt32BE(20),180);
 assert.deepEqual(await page.locator('img').evaluateAll(images=>images.filter(img=>!img.getAttribute('alt')?.trim()&&!img.closest('[aria-hidden="true"]')).map(img=>img.src)),[],'Informative images have descriptions; decorative images are explicitly hidden');
 assert.equal(await page.getByRole('img').count(),2,'The closed screenshot disclosure is not exposed until opened');
});

test('initial render has inline page styles, no blocking application scripts, and no failed first-party requests',async t=>{
 const page=await pageFor(t);
 const requested=[],failures=[],errors=[];
 page.on('request',request=>requested.push(request.url()));
 page.on('requestfailed',request=>{if(request.url().startsWith(base))failures.push(request.url()+': '+request.failure()?.errorText);});
 page.on('response',response=>{if(response.url().startsWith(base)&&response.status()>=400)failures.push(response.url()+': '+response.status());});
 page.on('pageerror',error=>errors.push(error.message));
 const session=page.waitForResponse(base+'/api/auth/session');
 await page.goto(base);
 assert.equal((await session).status(),200);
 await page.locator('.install-neutral').filter({hasText:'For your browser'}).waitFor();
 const styles=await page.locator('style').allTextContents();
 assert.ok(styles.join('').includes('.landing-body .hero'));
 assert.ok(!styles.join('').includes('.auth-body'),'Account stylesheet is not included on the homepage');
 assert.equal(await page.locator('link[rel="stylesheet"]').count(),0);
 assert.deepEqual(await page.locator('script[src]').evaluateAll(scripts=>scripts.filter(script=>!script.async&&!script.defer&&!script.noModule&&script.type!=='module').map(script=>script.src)),[]);
 const legacy=await page.locator('script[nomodule]').evaluateAll(scripts=>scripts.map(script=>script.src));
 assert.ok(legacy.every(url=>!requested.includes(url)),'Modern browsers do not request the framework legacy polyfill');
 assert.ok(!requested.includes(base+'/api/me'));
 assert.deepEqual(failures,[]);assert.deepEqual(errors,[]);
});

test('touch targets, demo, disclosures and mobile navigation remain usable at every layout',async t=>{
 const page=await pageFor(t);
 await page.goto(base);
 await page.evaluate(()=>document.fonts.ready);
 for(const width of [1440,768,390,320]) {
  await page.setViewportSize({width,height:1000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Overflow at ${width}px`);
  assert.deepEqual(await undersized(page),[],`Touch targets at ${width}px`);
  await page.locator('#demoSave').click();
  await page.locator('#demoReset').waitFor({state:'visible'});
  assert.deepEqual(await undersized(page),[],`Saved demo targets at ${width}px`);
  await page.locator('#demoReset').click();
  await page.waitForFunction(()=>document.activeElement.id==='demoSave');
  await page.locator('.interface-disclosure summary').click();
  await page.getByRole('img',{name:/Foundkeep browser library/}).waitFor();
  await page.locator('.faq-list summary').first().click();
  assert.deepEqual(await undersized(page),[],`Expanded disclosure targets at ${width}px`);
  await page.locator('.faq-list summary').first().click();
  await page.locator('.interface-disclosure summary').click();
  if(width<=540) {
   await page.getByRole('button',{name:'Open navigation'}).click();
   assert.deepEqual(await undersized(page),[],`Mobile navigation targets at ${width}px`);
   await page.keyboard.press('Escape');
   assert.equal(await page.locator('#mobile-nav').isVisible(),false);
   assert.equal(await page.getByRole('button',{name:'Open navigation'}).evaluate(el=>document.activeElement===el),true);
  }
 }
});

test('simultaneous return-to-tab events share the pending session check',async t=>{
 const page=await pageFor(t);
 let calls=0,release;
 const gate=new Promise(resolve=>{release=resolve;});
 t.after(()=>release());
 await page.route('**/api/auth/session',async route=>{calls++;await gate;await route.continue();});
 await page.goto(base);
 await page.waitForFunction(()=>document.querySelector('.install-neutral')?.textContent==='For your browser');
 await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pageshow'));document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(calls,1);
 const response=page.waitForResponse(base+'/api/auth/session');release();
 assert.equal((await response).status(),200);
});

test('public session discovery still updates signed-in and signed-out homepage actions',async t=>{
 const context=await browser.newContext();
 const page=await context.newPage();
 const password='Homepage-audit-disposable-924187';
 const email=`homepage-${crypto.randomUUID()}@example.test`;
 const registered=await context.request.post(base+'/api/auth/register',{headers:{Origin:base},data:{name:'Audit collector',email,password}});
 assert.equal(registered.status(),201);
 const account=(await registered.json()).account;
 t.after(async()=>{
  try {
   await context.request.post(base+'/api/auth/login',{headers:{Origin:base},data:{email,password}});
   assert.equal((await context.request.delete(base+'/api/account',{headers:{Origin:base},data:{password}})).status(),200);
  } finally {await context.close();}
 });
 await page.goto(base);
 await page.locator('.hero-action-group').getByRole('link',{name:'Open my library'}).waitFor();
 assert.deepEqual(await (await context.request.get(base+'/api/auth/session')).json(),{account:{id:account.id}});
 await context.request.post(base+'/api/auth/logout',{headers:{Origin:base},data:{}});
 await page.reload();
 await page.locator('.hero-action-group').getByRole('link',{name:'Start collecting'}).waitFor();
 assert.deepEqual(await (await context.request.get(base+'/api/auth/session')).json(),{account:null});
 assert.equal((await context.request.get(base+'/api/me')).status(),401);
});
