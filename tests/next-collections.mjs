import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
const base=process.env.FOUNDKEEP_WEB_TEST_URL||'http://127.0.0.1:18791';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Use disposable local accounts.');
let browser;before(async()=>{browser=await chromium.launch({headless:true,args:['--no-sandbox']});});after(async()=>browser.close());
async function account(t,name){const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),password='Disposable-collections-test-938247',email=crypto.randomUUID()+'@example.test';const r=await context.request.post(base+'/api/auth/register',{headers:{Origin:base},data:{name,email,password}});assert.equal(r.status(),201,await r.text());t.after(async()=>{try{assert.equal((await context.request.delete(base+'/api/account',{headers:{Origin:base},data:{password}})).status(),200);}finally{await context.close();}});return {context,account:(await r.json()).account};}
async function add(page,title,body){const form=page.getByRole('form',{name:'Add to collection'});await form.getByLabel('Title',{exact:true}).fill(title);await form.getByLabel('Source link').fill('https://example.com/a-useful-guide');await form.getByLabel('Description or quote').fill(body);await form.getByRole('button',{name:/Add to collection|Submit for approval/}).click();await form.getByRole('status').waitFor();}

test('curators publish a collection, visitors follow and submit, owners approve, and privacy changes revoke public access',async t=>{
 const owner=await account(t,'Asha'),contributor=await account(t,'Sam');
 const page=await owner.context.newPage(),reader=await contributor.context.newPage(),anonymous=await browser.newContext({reducedMotion:'reduce'});t.after(()=>anonymous.close());const guest=await anonymous.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));reader.on('pageerror',e=>errors.push(e.message));guest.on('pageerror',e=>errors.push(e.message));
 const title='Best of agents '+crypto.randomUUID().slice(0,8);
 await page.goto(base+'/dashboard/collections');await page.getByRole('button',{name:'New collection',exact:true}).click();
 const form=page.getByRole('form',{name:'New collection'});await form.getByLabel('Collection name').fill(title);await form.getByLabel('Description',{exact:true}).fill('Thoughtful links about agents, skills and the people building them.');await form.getByLabel('Topics').fill('agents, skills');await form.getByLabel('Visibility',{exact:true}).selectOption('public');await form.getByLabel('Who can add finds?').selectOption('anyone');await form.getByLabel('Community rules').fill('Link to the original source and explain why it matters.');await form.getByRole('button',{name:'Create collection',exact:true}).click();
 await page.waitForURL(/\/dashboard\/collections\/[^/]+$/);const collectionId=new URL(page.url()).pathname.split('/').at(-1);
 await page.getByRole('heading',{name:title,exact:true}).waitFor();await page.getByRole('button',{name:'Add a find',exact:true}).click();await add(page,'Start with a useful source','A carefully selected explanation for this collection.');
 const href=await page.getByRole('link',{name:/Open collection page/}).getAttribute('href');
 await reader.goto(base+href);await reader.getByRole('button',{name:'Follow collection',exact:true}).click();await reader.getByRole('button',{name:'Following · unfollow'}).waitFor();await reader.getByRole('button',{name:'Suggest a find',exact:true}).click();await add(reader,'A community suggestion','This should stay in the approval queue.');
 await reader.goto(base+'/dashboard');await reader.locator('.sidebar-collection-link',{hasText:title}).click();await reader.waitForURL(base+'/dashboard/collections/'+collectionId);await reader.getByRole('heading',{name:title,exact:true}).waitFor();
 await guest.goto(base+href);assert.equal(await guest.getByRole('heading',{name:'Start with a useful source'}).count(),1);assert.equal(await guest.getByRole('heading',{name:'A community suggestion'}).count(),0);assert.ok(!(await guest.content()).includes(contributor.account.email));
 await page.getByRole('button',{name:/Approval queue/}).click();await page.getByRole('heading',{name:'A community suggestion'}).waitFor();await page.getByRole('button',{name:'Approve',exact:true}).click();await page.getByRole('button',{name:'Approval queue · 0'}).waitFor();await guest.reload();await guest.getByRole('heading',{name:'A community suggestion'}).waitFor();
 await page.getByRole('button',{name:'Finds · 2',exact:true}).click();await page.getByRole('heading',{name:'A community suggestion'}).waitFor();
 await mkdir('/tmp/foundkeep-collections-review',{recursive:true});
 for(const width of [1440,390,320]){await guest.setViewportSize({width,height:1000});assert.ok(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Public overflow at ${width}`);await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Manager overflow at ${width}`);if(width!==320){await guest.screenshot({path:`/tmp/foundkeep-collections-review/public-${width}.png`,fullPage:true});await page.screenshot({path:`/tmp/foundkeep-collections-review/manager-${width}.png`,fullPage:true});}}
 await guest.goto(base+'/collections?q=agents');await guest.getByRole('heading',{name:title,exact:true}).waitFor();await guest.screenshot({path:'/tmp/foundkeep-collections-review/directory-320.png',fullPage:true});
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByLabel('Visibility',{exact:true}).selectOption('private');await page.getByRole('button',{name:'Save collection settings'}).click();await page.getByText('Collection settings saved.',{exact:true}).waitFor();
 const response=await guest.goto(base+href);assert.equal(response.status(),404);assert.ok(!(await guest.content()).includes('A carefully selected explanation'));
 assert.equal((await contributor.context.request.get(base+'/api/collections/'+collectionId)).status(),404);assert.equal((await (await contributor.context.request.get(base+'/api/collections')).json()).collections.length,0);
 assert.deepEqual(errors,[]);
});

test('sharing a saved capture shows only explicitly selected text and the right destination',async t=>{
 const {context}=await account(t,'Mira');const slug='sharing-'+crypto.randomUUID().slice(0,8);
 const created=await context.request.post(base+'/api/collections',{headers:{Origin:base},data:{title:'My shared reading',slug,visibility:'public'}});assert.equal(created.status(),201);const c=(await created.json()).collection;
 const captured=await context.request.post(base+'/api/captures',{headers:{Origin:base},data:{clientId:crypto.randomUUID(),type:'note',noteText:'PRIVATE ANNOTATION DO NOT SHARE',sourceTitle:'A public title'}});assert.equal(captured.status(),201);const capture=(await captured.json()).capture;
 const page=await context.newPage();await page.goto(base+'/dashboard/saved/'+capture.id);await page.getByRole('button',{name:'Add to a collection',exact:true}).click();await page.getByLabel('Collection',{exact:true}).selectOption(c.id);const form=page.getByRole('form',{name:'Add to collection'});assert.equal(await form.getByLabel('Description or quote').inputValue(),'');await form.getByLabel('Description or quote').fill('Only my chosen public explanation');await form.getByRole('button',{name:'Add to collection',exact:true}).click();await form.getByRole('status').waitFor();const response=await context.request.get(base+'/api/public/collections/'+slug);const body=await response.text();assert.ok(body.includes('Only my chosen public explanation'));assert.ok(!body.includes('PRIVATE ANNOTATION'));
});

test('public refresh preserves loaded pages and stays bound to the account that opened it',async t=>{
 const owner=await account(t,'Curator'),other=await account(t,'Another collector');
 const created=await owner.context.request.post(base+'/api/collections',{headers:{Origin:base},data:{title:'A longer reading list',slug:'long-list-'+crypto.randomUUID().slice(0,8),visibility:'public',submissionPolicy:'anyone'}});
 assert.equal(created.status(),201);const c=(await created.json()).collection;
 for(let i=0;i<27;i++){const r=await owner.context.request.post(base+`/api/collections/${c.id}/entries`,{headers:{Origin:base},data:{clientId:crypto.randomUUID(),title:'Reading suggestion '+i,url:'https://example.com/guide-'+i}});assert.equal(r.status(),201);}
 const context=await browser.newContext();t.after(()=>context.close());const page=await context.newPage();
 await page.goto(base+'/collection/'+c.slug);assert.equal(await page.getByRole('heading',{name:/Reading suggestion/}).count(),24);
 await page.getByRole('button',{name:'Load more finds'}).click();await page.waitForFunction(()=>document.querySelectorAll('.shared-entry').length===27);assert.equal(await page.getByRole('heading',{name:/Reading suggestion/}).count(),27);
 await context.addCookies(await owner.context.cookies());
 const refreshed=page.waitForResponse(r=>r.url().includes('/api/public/collections/'+c.slug+'?cursor=24'));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));assert.equal((await refreshed).status(),200);
 assert.equal(await page.getByRole('heading',{name:/Reading suggestion/}).count(),27);assert.equal(await page.getByRole('button',{name:'Add a find',exact:true}).count(),0);assert.equal(await page.getByRole('link',{name:'Log in to contribute'}).count(),1);
 await page.reload();await page.getByRole('button',{name:'Add a find',exact:true}).waitFor();
 await context.clearCookies();await context.addCookies(await other.context.cookies());
 const guarded=page.waitForResponse(r=>r.url().endsWith(`/api/collections/${c.id}/follow`));
 await page.getByRole('button',{name:'Follow collection',exact:true}).click();const response=await guarded;
 assert.equal(response.status(),409);assert.equal(response.request().headers()['x-atlas-account'],owner.account.id);await page.getByRole('heading',{name:'Collection unavailable'}).waitFor();
 const state=await (await other.context.request.get(base+'/api/collections/'+c.id)).json();assert.equal(state.collection.following,false);
});

test('Pro group invitations, contributor approval, moves and membership revocation work in the dashboard',{skip:!process.env.FOUNDKEEP_COLLECTIONS_TEST_DB},async t=>{
 const db=process.env.FOUNDKEEP_COLLECTIONS_TEST_DB;assert.match(db,/^\/tmp\/foundkeep-collections[^/]*\/atlas\.db$/,'Only a disposable collection test database may receive a Pro fixture.');
 const owner=await account(t,'Group curator'),member=await account(t,'Group contributor');
 execFileSync('python3',['-c',"import sqlite3,sys,time; c=sqlite3.connect(sys.argv[1]); c.execute('INSERT INTO customer_subscriptions(account_id,provider,status,expires_at,renews,sandbox,updated_at) VALUES(?,?,?,?,?,?,?)',(sys.argv[2],'paddle','active',int(time.time()*1000)+86400000,1,1,int(time.time()*1000))); c.commit(); c.close()",db,owner.account.id]);
 const page=await owner.context.newPage(),reader=await member.context.newPage();await page.goto(base+'/dashboard/collections');await page.getByRole('button',{name:'New collection',exact:true}).click();
 const form=page.getByRole('form',{name:'New collection'});const title='A private team '+crypto.randomUUID().slice(0,8);await form.getByLabel('Collection name').fill(title);await form.getByLabel('Collection type',{exact:true}).selectOption('group');await form.getByLabel('Who can add finds?').selectOption('members');await form.getByRole('button',{name:'Create collection',exact:true}).click();await page.waitForURL(/\/dashboard\/collections\/[^/]+$/);const managerPath=new URL(page.url()).pathname;
 await page.getByRole('button',{name:'Members',exact:true}).click();await page.getByLabel('FoundKeep account email').fill(member.account.email);await page.getByRole('button',{name:'Invite to group'}).click();await page.getByText('contributor · Invitation pending',{exact:true}).waitFor();
 await reader.goto(base+'/dashboard/collections');await reader.getByRole('heading',{name:'You’re invited'}).waitFor();await reader.getByRole('button',{name:'Join group'}).click();await reader.getByRole('link').filter({has:reader.getByRole('heading',{name:title,exact:true})}).click();await reader.getByRole('button',{name:'Add a find',exact:true}).click();await add(reader,'A team suggestion','Shared only with my team.');
 await page.getByRole('button',{name:/Approval queue/}).click();await page.getByRole('heading',{name:'A team suggestion'}).waitFor();await page.getByRole('button',{name:'Approve',exact:true}).click();await page.getByRole('button',{name:'Approval queue · 0'}).waitFor();
 const destination=await member.context.request.post(base+'/api/collections',{headers:{Origin:base},data:{title:'My private reading',slug:'personal-'+crypto.randomUUID().slice(0,8)}});assert.equal(destination.status(),201);const target=(await destination.json()).collection;
 await reader.reload();await reader.getByRole('button',{name:'Move',exact:true}).click();await reader.getByLabel('Move to collection').selectOption(target.id);await reader.getByRole('button',{name:'Move entry',exact:true}).click();await reader.getByRole('heading',{name:'A team suggestion'}).waitFor({state:'hidden'});assert.equal((await (await member.context.request.get(base+'/api/collections/'+target.id)).json()).entries.length,1);
 await page.getByRole('button',{name:'Members',exact:true}).click();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Remove',exact:true}).click();await page.getByText(member.account.email,{exact:true}).waitFor({state:'hidden'});
 await reader.goto(base+managerPath);await reader.getByRole('heading',{name:'Collection unavailable'}).waitFor();
});
