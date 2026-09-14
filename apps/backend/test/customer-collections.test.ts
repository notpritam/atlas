import {afterEach,beforeEach,expect,test} from 'bun:test';
import {openDb} from '../src/db';
import {createApp} from '../src/app';
import {writeSubscription} from '../src/customer-plans';
let db:ReturnType<typeof openDb>,app:ReturnType<typeof createApp>;
const origin='https://foundkeep.app';
beforeEach(()=>{db=openDb(':memory:');app=createApp(db);});afterEach(()=>db.close());
async function req(path:string,token?:string,method='GET',body?:unknown) {
 return app.request(origin+'/api'+path,{method,headers:{...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}) as Promise<Omit<Response,'json'> & {json():Promise<any>}>;
}
async function user(pro=false) {const r=await req('/mobile/register',undefined,'POST',{email:crypto.randomUUID()+'@example.test',name:'Collector',password:'Collections-testing-only-93821'});expect(r.status).toBe(201);const u=await r.json();if(pro)writeSubscription(db,u.account.id,'paddle',{status:'active',expiresAt:Date.now()+86400000,renews:true,sandbox:true});return u;}
async function collection(u:any,extra={}) {const r=await req('/collections',u.token,'POST',{title:'Best of agents',slug:'agents-'+crypto.randomUUID().slice(0,8),...extra});expect(r.status).toBe(201);return (await r.json()).collection;}
async function entry(c:any,u:any,extra={}) {const r=await req(`/collections/${c.id}/entries`,u.token,'POST',{clientId:crypto.randomUUID(),title:'A useful skill',url:'https://example.com/skill',body:'A selected explanation',tags:['agents'],...extra});expect([200,201]).toContain(r.status);return (await r.json()).entry;}

test('private collections stay private; public entries expose only explicitly shared content',async()=>{
 const a=await user(),b=await user(),c=await collection(a);
 expect((await req('/public/collections/'+c.slug)).status).toBe(404);
 expect((await req('/collections/'+c.id,b.token)).status).toBe(404);
 const capture=await (await req('/captures',a.token,'POST',{clientId:crypto.randomUUID(),type:'note',noteText:'SECRET PERSONAL NOTE',sourceTitle:'Private title'})).json();
 await entry(c,a,{captureId:capture.capture.id});
 expect((await req(`/collections/${c.id}`,a.token,'PATCH',{visibility:'public'})).status).toBe(200);
 const published=await req('/public/collections/'+c.slug);expect(published.status).toBe(200);
 const body=await published.json();expect(body.entries).toHaveLength(1);expect(body.entries[0].body).toBe('A selected explanation');expect(JSON.stringify(body)).not.toContain('SECRET PERSONAL NOTE');expect(JSON.stringify(body)).not.toContain(a.account.email);expect(body.entries[0].captureId).toBeUndefined();
 expect((await req(`/collections/${c.id}/entries`,b.token,'POST',{clientId:crypto.randomUUID(),captureId:capture.capture.id,title:'Try',body:'Try'})).status).toBe(403);
 await req(`/collections/${c.id}`,a.token,'PATCH',{visibility:'private'});expect((await req('/public/collections/'+c.slug)).status).toBe(404);
});

test('public submissions require approval, followers see approved content, and moderation stays owner-scoped',async()=>{
 const a=await user(),b=await user(),other=await user();const c=await collection(a,{visibility:'public',submissionPolicy:'anyone'});
 const e=await entry(c,b);expect(e.status).toBe('pending');
 expect((await (await req('/public/collections/'+c.slug)).json()).entries).toHaveLength(0);
 expect((await (await req('/collections/'+c.id,b.token)).json()).entries).toHaveLength(1);
 expect((await req(`/collections/${c.id}/entries/${e.id}/moderate`,b.token,'POST',{status:'approved'})).status).toBe(403);
 expect((await req(`/collections/${c.id}/entries/${e.id}/moderate`,a.token,'POST',{status:'approved'})).status).toBe(200);
 expect((await req(`/collections/${c.id}/follow`,b.token,'POST',{})).status).toBe(200);
 expect((await req(`/collections/${c.id}/follow`,b.token,'POST',{})).status).toBe(200);
 expect((await (await req('/public/collections/'+c.slug)).json()).collection.followers).toBe(1);
 expect((await (await req('/collections',b.token)).json()).collections[0].following).toBe(true);
 expect((await req(`/collections/${c.id}/entries/${e.id}`,other.token,'DELETE')).status).toBe(403);
 await req(`/collections/${c.id}`,a.token,'PATCH',{visibility:'private',submissionPolicy:'owner'});
 expect((await (await req('/collections',b.token)).json()).collections).toHaveLength(0);
 expect((await req('/collections/'+c.id,b.token)).status).toBe(404);
});

test('groups have accepted invitations, roles, revocation and access on Free or Pro during early access',async()=>{
 const a=await user(),b=await user();expect((await req('/collections',a.token,'POST',{title:'Group',slug:'a-group',kind:'group'})).status).toBe(201);
 writeSubscription(db,a.account.id,'paddle',{status:'active',expiresAt:Date.now()+86400000,renews:true,sandbox:true});
 const c=await collection(a,{kind:'group',submissionPolicy:'members'});
 expect((await req(`/collections/${c.id}/members`,a.token,'POST',{email:b.account.email,role:'contributor'})).status).toBe(200);
 expect((await req('/collections/'+c.id,b.token)).status).toBe(404);
 expect((await (await req('/collections',b.token)).json()).invitations).toHaveLength(1);
 expect((await req(`/collections/${c.id}/invitation`,b.token,'POST',{accept:true})).status).toBe(200);
 const e=await entry(c,b);expect(e.status).toBe('pending');
 await req(`/collections/${c.id}/members`,a.token,'POST',{email:b.account.email,role:'moderator'});
 expect((await req(`/collections/${c.id}/entries/${e.id}/moderate`,b.token,'POST',{status:'approved'})).status).toBe(200);
 db.query('UPDATE customer_subscriptions SET expires_at=0 WHERE account_id=?').run(a.account.id);
 expect((await req('/collections/'+c.id,b.token)).status).toBe(200);
 expect((await req(`/collections/${c.id}/members`,a.token,'POST',{email:b.account.email,role:'viewer'})).status).toBe(200);
 const newcomer=await user();expect((await req(`/collections/${c.id}/members`,a.token,'POST',{email:newcomer.account.email})).status).toBe(200);
 expect((await req(`/collections/${c.id}/members/${b.account.id}`,a.token,'DELETE')).status).toBe(200);
 expect((await req('/collections/'+c.id,b.token)).status).toBe(404);
});

test('moving is atomic, destination approval applies, and duplicate retries do not multiply entries',async()=>{
 const a=await user(),b=await user();const from=await collection(a,{visibility:'public',submissionPolicy:'anyone',requireApproval:false}),to=await collection(b,{visibility:'public',submissionPolicy:'anyone'});
 const e=await entry(from,a);expect(e.status).toBe('approved');
 const result=await req(`/collections/${from.id}/entries/${e.id}/move`,a.token,'POST',{collectionId:to.id});expect(result.status).toBe(200);expect((await result.json()).entry.status).toBe('pending');
 expect((await (await req('/public/collections/'+from.slug)).json()).entries).toHaveLength(0);
 const retry=await req(`/collections/${from.id}/entries/${e.id}/move`,a.token,'POST',{collectionId:to.id});expect(retry.status).toBe(200);
 const clientId=crypto.randomUUID();await entry(to,a,{clientId});await entry(to,a,{clientId});
 expect((await (await req('/collections/'+to.id,b.token)).json()).entries).toHaveLength(2);
 const locked=await collection(b);const denied=await req(`/collections/${to.id}/entries/${e.id}/move`,a.token,'POST',{collectionId:locked.id});expect(denied.status).toBe(404);
 expect((await (await req('/collections/'+to.id,b.token)).json()).entries).toHaveLength(2);
});

test('validation rejects unsafe URLs, invalid slugs and cross-account image references',async()=>{
 const a=await user(),b=await user();const c=await collection(a,{visibility:'public',submissionPolicy:'anyone'});
 expect((await req('/collections',a.token,'POST',{title:'Invalid',slug:'../../admin'})).status).toBe(400);
 expect((await req('/collections',b.token,'POST',{title:'Duplicate',slug:c.slug})).status).toBe(409);
 for(const url of ['javascript:alert(1)','https://user:password@example.com','file:///etc/passwd'])expect((await req(`/collections/${c.id}/entries`,a.token,'POST',{clientId:crypto.randomUUID(),title:'Unsafe',url})).status).toBe(400);
 const saved=await (await req('/captures',a.token,'POST',{clientId:crypto.randomUUID(),type:'note',noteText:'Private'})).json();
 expect((await req(`/collections/${c.id}/entries`,b.token,'POST',{clientId:crypto.randomUUID(),title:'Steal',captureId:saved.capture.id})).status).toBe(404);
 await entry(c,a,{captureId:saved.capture.id});
 await req('/mobile/captures/'+saved.capture.id,a.token,'DELETE');expect((await (await req('/public/collections/'+c.slug)).json()).entries).toHaveLength(0);
});

test('shared images require explicit inclusion, approval and current collection access',async()=>{
 const a=await user(),b=await user(),c=await collection(a,{visibility:'public',submissionPolicy:'anyone'});
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=';
 const capture=(await(await req('/captures',b.token,'POST',{clientId:crypto.randomUUID(),type:'image',dataUrl:png})).json()).capture;
 const e=await entry(c,b,{captureId:capture.id,shareImage:true});expect(e.imageUrl).toBeTruthy();
 expect((await req(e.imageUrl.replace('/api',''))).status).toBe(404);
 expect((await req(e.imageUrl.replace('/api',''),b.token)).status).toBe(200);
 await req(`/collections/${c.id}/entries/${e.id}/moderate`,a.token,'POST',{status:'approved'});
 const publicImage=await req(e.imageUrl.replace('/api',''));expect(publicImage.status).toBe(200);expect(publicImage.headers.get('cache-control')).toContain('no-store');expect(publicImage.headers.get('content-type')).toBe('image/png');
 await req(`/collections/${c.id}`,a.token,'PATCH',{visibility:'private',submissionPolicy:'owner'});
 expect((await req(e.imageUrl.replace('/api',''))).status).toBe(404);expect((await req(e.imageUrl.replace('/api',''),b.token)).status).toBe(404);
});

test('pagination includes every approved entry and keeps pending entries out of public search and feeds',async()=>{
 const a=await user(),b=await user(),c=await collection(a,{visibility:'public',submissionPolicy:'anyone'});
 for(let i=0;i<27;i++)await entry(c,a,{title:'Entry '+i});await entry(c,b,{title:'SECRET pending'});
 const first=await(await req('/public/collections/'+c.slug)).json();expect(first.entries).toHaveLength(24);expect(first.nextCursor).toBe('24');
 const next=await(await req('/public/collections/'+c.slug+'?cursor='+first.nextCursor)).json();expect(next.entries).toHaveLength(3);expect(new Set([...first.entries,...next.entries].map(e=>e.id)).size).toBe(27);expect(next.nextCursor).toBeNull();
 expect(JSON.stringify(first)).not.toContain('SECRET pending');
 expect((await req('/public/collections/'+c.slug+'?view=pending')).status).toBe(403);
 expect((await req('/public/collections/'+c.slug+'?cursor=-1')).status).toBe(400);
});

test('revoked credentials cannot finish an in-flight collection write and forged web origins are refused',async()=>{
 const a=await user(),c=await collection(a);let controller:ReadableStreamDefaultController<Uint8Array>;
 const body=new ReadableStream<Uint8Array>({start(value){controller=value;controller.enqueue(new TextEncoder().encode('{"clientId":"held","title":"'));}});
 const pending=app.request(origin+`/api/collections/${c.id}/entries`,{method:'POST',headers:{authorization:'Bearer '+a.token,'content-type':'application/json'},body});
 await new Promise(resolve=>setTimeout(resolve,5));await req('/mobile/logout',a.token,'POST',{});controller!.enqueue(new TextEncoder().encode('Must not publish"}'));controller!.close();expect((await pending).status).toBe(401);
 expect((db.query('SELECT COUNT(*) n FROM customer_collection_entries').get() as {n:number}).n).toBe(0);
 const attack=await app.request(origin+'/api/collections',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:'{}'});expect(attack.status).toBe(403);
});

test('collection search and topics span pages without exposing unapproved content',async()=>{
 const a=await user(),b=await user(),c=await collection(a,{visibility:'public',submissionPolicy:'anyone'});
 await entry(c,a,{title:'An older find with a literal 100% match',tags:['systems'],body:'Durable ideas'});
 for(let i=0;i<25;i++)await entry(c,a,{title:'Recent resource '+i,tags:['agents']});
 await entry(c,b,{title:'HIDDEN suggestion',tags:['secret-topic']});
 const publicPath='/public/collections/'+c.slug;
 const found=await(await req(publicPath+'?q=100%25')).json();expect(found.entries).toHaveLength(1);expect(found.total).toBe(1);expect(found.nextCursor).toBeNull();
 const tagged=await(await req(publicPath+'?tag=systems')).json();expect(tagged.entries).toHaveLength(1);expect(tagged.availableTags).toEqual(['agents','systems']);
 const noMatch=await(await req(publicPath+'?q=HIDDEN')).json();expect(noMatch.total).toBe(0);expect(noMatch.availableTags).not.toContain('secret-topic');
 const scoped=await(await req('/collections/by-slug/'+c.slug+'?q=HIDDEN',b.token)).json();expect(scoped.total).toBe(1);expect(scoped.entries[0].status).toBe('pending');
 expect((await req(publicPath+'?q='+('x'.repeat(101)))).status).toBe(400);
 const next=await(await req(publicPath+'?tag=agents&cursor=24')).json();expect(next.entries).toHaveLength(1);expect(next.total).toBe(25);
 await req('/collections/'+c.id,a.token,'PATCH',{visibility:'private',submissionPolicy:'owner'});
 expect((await req(publicPath+'?q=resource')).status).toBe(404);
});
