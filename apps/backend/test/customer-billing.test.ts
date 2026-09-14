import { afterEach, beforeEach, expect, test } from 'bun:test';
import { openDb } from '../src/db.ts';
import { accountPlan, writeSubscription } from '../src/customer-plans.ts';
import { revenueCatSnapshot, createBillingService } from '../src/customer-billing.ts';
let db: ReturnType<typeof openDb>; let id: string;
beforeEach(() => { db=openDb(':memory:'); id=crypto.randomUUID(); db.query("INSERT INTO customer_accounts(id,email,name,password_hash,recovery_hash,created_at) VALUES(?,?,'Billing','','',0)").run(id,id+'@example.com'); });
afterEach(() => db.close());
test('operator beta access grants Pro limits without creating a paid subscription', () => {
  const plan=accountPlan(db,id,Date.now(),{FOUNDKEEP_BETA_PRO:'true'});
  expect(plan).toMatchObject({plan:'pro',pro:true,complimentaryPro:true,subscriptions:[],limits:{monthlyProcessing:500,maxBytes:2*1024**3}});
  expect(db.query('SELECT COUNT(*) AS count FROM customer_subscriptions').get()).toEqual({count:0});
  expect(accountPlan(db,id,Date.now(),{})).toMatchObject({pro:false,complimentaryPro:false,limits:{maxBytes:200*1024**2}});
  expect(accountPlan(db,id,Date.now(),{FOUNDKEEP_BETA_PRO:'false'}).pro).toBe(false);
});
test('a real paid subscription retains its identity during and after beta access', () => {
  writeSubscription(db,id,'paddle',{status:'active',expiresAt:Date.now()+60_000,renews:true,sandbox:false});
  const beta=accountPlan(db,id,Date.now(),{FOUNDKEEP_BETA_PRO:'true'});
  expect(beta).toMatchObject({pro:true,complimentaryPro:false});
  expect(beta.subscriptions).toHaveLength(1);
  expect(beta.subscriptions[0]).toMatchObject({provider:'paddle',active:true,renews:true,sandbox:false});
  expect(accountPlan(db,id,Date.now(),{})).toMatchObject({pro:true,complimentaryPro:false});
});
test('early access includes every feature on Free; only verified subscriptions grant paid identity and storage', () => {
  expect(accountPlan(db,id).features).toEqual({imports:true,mcp:true,managedProcessing:true,groupCollections:true});
  expect(accountPlan(db,id).pro).toBe(false);
  expect(accountPlan(db,id).limits).toMatchObject({monthlyProcessing:500,maxBytes:200*1024**2});
  const active={status:'active',expiresAt:Date.now()+60_000,renews:true,sandbox:false};
  writeSubscription(db,id,'stripe',active,200); writeSubscription(db,id,'revenuecat',active,200);
  writeSubscription(db,id,'stripe',{...active,status:'inactive'},300);
  expect(accountPlan(db,id).pro).toBe(true);
  writeSubscription(db,id,'revenuecat',{...active,status:'inactive'},300);
  writeSubscription(db,id,'revenuecat',active,100);
  expect(accountPlan(db,id).pro).toBe(false);
  writeSubscription(db,id,'revenuecat',{...active,expiresAt:Date.now()-1},400);
  expect(accountPlan(db,id).pro).toBe(false);
});
function subscriber(overrides: Record<string, unknown> = {}) {
  const future=new Date(Date.now()+60_000).toISOString();
  return { entitlements:{pro:{product_identifier:'app.foundkeep.pro.monthly',expires_date:future}},subscriptions:{'app.foundkeep.pro.monthly':{expires_date:future,is_sandbox:false,unsubscribe_detected_at:null,...overrides}} };
}
test('RevenueCat checks entitlement, product, expiry, refund, grace and sandbox', () => {
  expect(revenueCatSnapshot(subscriber(),{entitlement:'pro',product:'app.foundkeep.pro.monthly',allowSandbox:false}).status).toBe('active');
  const config={entitlement:'pro',product:'app.foundkeep.pro.monthly',allowSandbox:false};
  expect(revenueCatSnapshot(subscriber({is_sandbox:true}),config).status).toBe('inactive');
  expect(revenueCatSnapshot(subscriber({refunded_at:new Date().toISOString()}),config).status).toBe('inactive');
  expect(revenueCatSnapshot(subscriber({unsubscribe_detected_at:new Date().toISOString()}),config).renews).toBe(false);
  expect(revenueCatSnapshot(subscriber(),{...config,product:'wrong'}).status).toBe('inactive');
  expect(revenueCatSnapshot({},config).status).toBe('inactive');
});
test('billing is unavailable without keys and never exposes a secret key as SDK configuration', () => {
  const service=createBillingService(db,{REVENUECAT_IOS_PUBLIC_KEY:'sk_private_key'});
  expect(service.configuration(id).revenuecat).toMatchObject({available:false,publicKey:null});
  expect(service.configuration(id).stripe.available).toBe(false);
});
test('RevenueCat synchronization uses an opaque owned identity and rechecks the provider', async () => {
  const calls:string[]=[];
  const service=createBillingService(db,{REVENUECAT_IOS_PUBLIC_KEY:'appl_public',REVENUECAT_SECRET_KEY:'secret',REVENUECAT_WEBHOOK_AUTH:'webhook'},async input => {
    calls.push(String(input)); return Response.json({subscriber:subscriber()});
  });
  const config=service.configuration(id);
  expect(config.revenuecat.appUserId).not.toBe(id); expect(config.revenuecat.appUserId).toStartWith('fk_');
  expect(service.configuration(id).revenuecat.appUserId).toBe(config.revenuecat.appUserId);
  await service.syncRevenueCat(id);
  expect(accountPlan(db,id).pro).toBe(true); expect(calls[0]).toEndWith('/'+config.revenuecat.appUserId);
});

test('RevenueCat webhooks reject spoofing, re-fetch current state, deduplicate and handle transfers',async()=>{
  let providerCalls=0;let entitled=true;
  const service=createBillingService(db,{REVENUECAT_SECRET_KEY:'server-test-key',REVENUECAT_WEBHOOK_AUTH:'Bearer test-webhook-secret'},async()=>{
    providerCalls++;return Response.json({subscriber:entitled?subscriber():{entitlements:{},subscriptions:{}}});
  });
  const rcId=service.configuration(id).revenuecat.appUserId;
  const event={event:{id:'event-one',type:'INITIAL_PURCHASE',app_user_id:rcId,entitlement_ids:['forged-ignored']}};
  await expect(service.revenueCatWebhook('wrong',event)).rejects.toThrow('Invalid webhook authorization');
  expect(providerCalls).toBe(0);
  await service.revenueCatWebhook('Bearer test-webhook-secret',event);expect(accountPlan(db,id).pro).toBe(true);
  await service.revenueCatWebhook('Bearer test-webhook-secret',event);expect(providerCalls).toBe(1);
  entitled=false;
  await service.revenueCatWebhook('Bearer test-webhook-secret',{event:{id:'event-transfer',type:'TRANSFER',transferred_from:[rcId],transferred_to:['unknown-user']}});
  expect(accountPlan(db,id).pro).toBe(false);expect(providerCalls).toBe(2);
});
test('a failed RevenueCat verification is retried instead of recording the webhook as processed',async()=>{
  let down=true;const service=createBillingService(db,{REVENUECAT_SECRET_KEY:'server-test-key',REVENUECAT_WEBHOOK_AUTH:'Bearer test-webhook-secret'},async()=>down?new Response('',{status:503}):Response.json({subscriber:subscriber()}));
  const rcId=service.configuration(id).revenuecat.appUserId;const event={event:{id:'retry-event',type:'RENEWAL',app_user_id:rcId}};
  await expect(service.revenueCatWebhook('Bearer test-webhook-secret',event)).rejects.toThrow('temporarily unavailable');
  expect((db.query('SELECT COUNT(*) n FROM customer_billing_events').get() as any).n).toBe(0);
  down=false;await service.revenueCatWebhook('Bearer test-webhook-secret',event);expect(accountPlan(db,id).pro).toBe(true);
});
test('Stripe signatures and current provider state control access, independently of RevenueCat',async()=>{
  const {default:Stripe}=await import('stripe');let live=true;let calls=0;
  const service=createBillingService(db,{STRIPE_SECRET_KEY:'sk_test_placeholder',STRIPE_WEBHOOK_SECRET:'whsec_test_placeholder',STRIPE_PRICE_ID:'price_pro'},async(input)=>{
    expect(String(input)).toContain('/v1/subscriptions');calls++;
    return Response.json({object:'list',has_more:false,data:live?[{id:'sub_1',status:'active',livemode:false,cancel_at_period_end:false,items:{data:[{price:{id:'price_pro'},current_period_end:Math.floor(Date.now()/1000)+3600}]}}]:[]});
  });
  service.configuration(id);db.query("UPDATE customer_billing_identities SET stripe_id='cus_owned' WHERE account_id=?").run(id);
  const raw=JSON.stringify({id:'evt_one',type:'customer.subscription.updated',data:{object:{customer:'cus_owned',status:'forged'}}});
  const signature=await Stripe.webhooks.generateTestHeaderStringAsync({payload:raw,secret:'whsec_test_placeholder'});
  await expect(service.stripeWebhook('invalid',raw)).rejects.toThrow('Invalid webhook signature');expect(calls).toBe(0);
  await service.stripeWebhook(signature,raw);expect(accountPlan(db,id).pro).toBe(true);expect(calls).toBe(1);
  await service.stripeWebhook(signature,raw);expect(calls).toBe(1);
  writeSubscription(db,id,'revenuecat',{status:'active',expiresAt:Date.now()+3600_000,renews:true,sandbox:false});
  live=false;const deleted=JSON.stringify({id:'evt_two',type:'customer.subscription.deleted',data:{object:{customer:'cus_owned'}}});
  await service.stripeWebhook(await Stripe.webhooks.generateTestHeaderStringAsync({payload:deleted,secret:'whsec_test_placeholder'}),deleted);
  expect(accountPlan(db,id).pro).toBe(true);expect(accountPlan(db,id).subscriptions.find(s=>s.provider==='stripe')?.active).toBe(false);
});
test('account deletion durably queues provider cleanup and retries without retaining account data',async()=>{
  const {processBillingCleanup}=await import('../src/customer-billing.ts');
  const service=createBillingService(db,{});const rcId=service.configuration(id).revenuecat.appUserId;
  db.query("UPDATE customer_billing_identities SET stripe_id='cus_delete' WHERE account_id=?").run(id);
  db.query('DELETE FROM customer_accounts WHERE id=?').run(id);
  expect((db.query('SELECT COUNT(*) n FROM customer_billing_cleanup').get() as any).n).toBe(2);
  let down=true;const urls:string[]=[];
  const fetcher=async(input:string|URL|Request,options?:RequestInit)=>{urls.push(String(input));expect(options?.method?.toUpperCase()).toBe('DELETE');return down?new Response('',{status:503}):Response.json({deleted:true});};
  await processBillingCleanup(db,{STRIPE_SECRET_KEY:'sk_test_placeholder',REVENUECAT_SECRET_KEY:'server-test-key'},fetcher);
  expect((db.query('SELECT COUNT(*) n FROM customer_billing_cleanup').get() as any).n).toBe(2);
  down=false;db.query('UPDATE customer_billing_cleanup SET next_attempt_at=0').run();
  await processBillingCleanup(db,{STRIPE_SECRET_KEY:'sk_test_placeholder',REVENUECAT_SECRET_KEY:'server-test-key'},fetcher);
  expect((db.query('SELECT COUNT(*) n FROM customer_billing_cleanup').get() as any).n).toBe(0);
  expect(urls.some(url=>url.endsWith('/'+rcId))).toBe(true);
});
test('unfinished Stripe checkout is reused across requests and time buckets',async()=>{
  let created=0;const fetcher=async(input:string|URL|Request,options?:RequestInit)=>{
    const url=String(input);
    if(url.includes('/v1/prices/'))return Response.json({id:'price_pro',active:true,currency:'usd',unit_amount:500,recurring:{interval:'month',interval_count:1}});
    if(url.includes('/v1/subscriptions'))return Response.json({object:'list',has_more:false,data:[]});
    if(url.includes('/v1/checkout/sessions/') && (!options?.method||options.method==='GET'))return Response.json({id:'cs_first',status:'open',expires_at:Math.floor(Date.now()/1000)+3600,url:'https://checkout.stripe.com/c/pay/cs_first'});
    if(url.endsWith('/v1/checkout/sessions')){created++;return Response.json({id:'cs_first',url:'https://checkout.stripe.com/c/pay/cs_first'});}
    throw new Error('Unexpected test request.');
  };
  const service=createBillingService(db,{STRIPE_SECRET_KEY:'sk_test_placeholder',STRIPE_WEBHOOK_SECRET:'whsec_test_placeholder',STRIPE_PRICE_ID:'price_pro'},fetcher);
  service.configuration(id);db.query("UPDATE customer_billing_identities SET stripe_id='cus_owned' WHERE account_id=?").run(id);
  const first=await service.checkout(id);const now=Date.now;Date.now=()=>now()+901_000;
  try{expect(await service.checkout(id)).toBe(first);expect(created).toBe(1);}finally{Date.now=now;}
});
test('an unconfigured provider cannot starve web subscription cancellation',async()=>{
 const {processBillingCleanup}=await import('../src/customer-billing.ts');
 for(let i=0;i<12;i++)db.query("INSERT INTO customer_billing_cleanup(provider,external_id,created_at) VALUES('revenuecat',?,0)").run('fk_unconfigured_'+i);
 db.query("INSERT INTO customer_billing_cleanup(provider,external_id,created_at) VALUES('stripe','cus_cancel',1)").run();
 let calls=0;await processBillingCleanup(db,{STRIPE_SECRET_KEY:'sk_test_placeholder'},async input=>{expect(String(input)).toEndWith('/cus_cancel');calls++;return Response.json({deleted:true});});
 expect(calls).toBe(1);expect(db.query("SELECT 1 FROM customer_billing_cleanup WHERE provider='stripe'").get()).toBeNull();
});
for(const status of ['past_due','unpaid','paused'])test('checkout cannot duplicate a '+status+' subscription',async()=>{
 const service=createBillingService(db,{STRIPE_SECRET_KEY:'sk_test_placeholder',STRIPE_WEBHOOK_SECRET:'whsec_test_placeholder',STRIPE_PRICE_ID:'price_pro'},async input=>{
  const url=String(input);
  if(url.includes('/v1/prices/'))return Response.json({id:'price_pro',active:true,currency:'usd',unit_amount:500,recurring:{interval:'month',interval_count:1}});
  if(url.includes('/v1/subscriptions'))return Response.json({object:'list',has_more:false,data:[]});
  if(url.includes('/v1/checkout/sessions/cs_old'))return Response.json({id:'cs_old',status:'complete',subscription:{id:'sub_old',status}});
  throw new Error('Must not create another checkout');
 });
 service.configuration(id);db.query("UPDATE customer_billing_identities SET stripe_id='cus_owned',checkout_id='cs_old' WHERE account_id=?").run(id);
 await expect(service.checkout(id)).rejects.toThrow('Manage that subscription');
});
test('purchase preflight treats a missing RevenueCat subscriber as unentitled and refreshes failed web payments',async()=>{
 const service=createBillingService(db,{STRIPE_SECRET_KEY:'sk_test_placeholder',STRIPE_PRICE_ID:'price_pro',REVENUECAT_SECRET_KEY:'server-test-key'},async input=>String(input).includes('revenuecat')?new Response('',{status:404}):Response.json({object:'list',has_more:false,data:[{id:'sub_due',status:'past_due',livemode:false,cancel_at_period_end:false,items:{data:[{price:{id:'price_pro'},current_period_end:Math.floor(Date.now()/1000)+3600}]}}]}));
 service.configuration(id);db.query("UPDATE customer_billing_identities SET stripe_id='cus_owned' WHERE account_id=?").run(id);
 const plan=await service.purchaseCheck(id);expect(plan.pro).toBe(false);expect(plan.billing.stripe.canManage).toBe(true);expect(plan.subscriptions.find(row=>row.provider==='stripe')?.status).toBe('past_due');
});

test('starting an App Store purchase expires web checkout and reserves the purchase channel',async()=>{
 let expired=false;let open=true;
 const service=createBillingService(db,{STRIPE_SECRET_KEY:'sk_test_placeholder',STRIPE_WEBHOOK_SECRET:'whsec_test',STRIPE_PRICE_ID:'price_pro',REVENUECAT_SECRET_KEY:'secret',REVENUECAT_WEBHOOK_AUTH:'webhook',REVENUECAT_IOS_PUBLIC_KEY:'appl_testpublic'},async(input)=>{
  const url=String(input);
  if(url.includes('api.revenuecat.com'))return new Response('',{status:404});
  if(url.includes('/v1/subscriptions'))return Response.json({data:[],has_more:false});
  if(url.includes('/v1/checkout/sessions/cs_open/expire')){expired=true;open=false;return Response.json({id:'cs_open',status:'expired'});}
  if(url.includes('/v1/checkout/sessions/cs_open'))return Response.json({id:'cs_open',status:open?'open':'expired'});
  throw new Error('Unexpected provider request');
 });
 service.configuration(id);db.query("UPDATE customer_billing_identities SET stripe_id='cus_owned',checkout_id='cs_open' WHERE account_id=?").run(id);
 const checked=await service.purchaseCheck(id,'purchase');expect(checked.pro).toBe(false);expect(expired).toBe(true);
 await expect(service.checkout(id)).rejects.toThrow('App Store purchase is still pending');
 await service.cancelMobilePurchase(id,checked.purchaseAttemptId!);
 expect((db.query('SELECT COUNT(*) n FROM customer_purchase_attempts WHERE account_id=?').get(id) as any).n).toBe(0);
});

test('an existing recoverable Stripe subscription blocks checkout without a saved checkout ID',async()=>{
 const service=createBillingService(db,{STRIPE_SECRET_KEY:'sk_test_placeholder',STRIPE_WEBHOOK_SECRET:'whsec_test',STRIPE_PRICE_ID:'price_pro'},async()=>Response.json({data:[{id:'sub_old',status:'past_due',items:{data:[{price:{id:'price_pro'},current_period_end:Math.floor(Date.now()/1000)+3600}]}}],has_more:false}));
 service.configuration(id);db.query("UPDATE customer_billing_identities SET stripe_id='cus_owned' WHERE account_id=?").run(id);
 await expect(service.checkout(id)).rejects.toThrow('existing subscription needs attention');
});

test('stale billing reconciliation retries unavailable providers and refreshes known identities',async()=>{
 const {reconcileBilling}=await import('../src/customer-billing.ts');
 const env={REVENUECAT_SECRET_KEY:'secret'};createBillingService(db,env).configuration(id);
 writeSubscription(db,id,'revenuecat',{status:'active',expiresAt:Date.now()+3600_000,renews:true,sandbox:false},1);
 await reconcileBilling(db,env,async()=>new Response('',{status:503}));
 expect(accountPlan(db,id).pro).toBe(true);
 expect((db.query('SELECT next_check_at FROM customer_subscriptions').get() as any).next_check_at).toBeGreaterThan(Date.now());
 db.query('UPDATE customer_subscriptions SET next_check_at=0').run();
 await reconcileBilling(db,env,async()=>new Response('',{status:404}));
 expect(accountPlan(db,id).pro).toBe(false);
});

test('stale purchase cancellation cannot remove a newer restore reservation',async()=>{
 const service=createBillingService(db,{REVENUECAT_SECRET_KEY:'secret',REVENUECAT_WEBHOOK_AUTH:'webhook',REVENUECAT_IOS_PUBLIC_KEY:'appl_testpublic'},async()=>new Response('',{status:404}));
 const first=await service.purchaseCheck(id,'purchase');
 await expect(service.purchaseCheck(id,'purchase')).rejects.toThrow('already pending');
 const restored=await service.purchaseCheck(id,'restore');
 await service.cancelMobilePurchase(id,first.purchaseAttemptId!);await service.cancelMobilePurchase(id,first.purchaseAttemptId!);
 expect(db.query('SELECT id FROM customer_purchase_attempts WHERE account_id=?').all(id)).toEqual([{id:restored.purchaseAttemptId}]);
});

test('production sandbox purchases grant Pro only to explicitly allowed test accounts',async()=>{
 const other=crypto.randomUUID();db.query("INSERT INTO customer_accounts(id,email,name,password_hash,recovery_hash,created_at) VALUES(?,?,'Other','','',0)").run(other,other+'@example.test');
 const service=createBillingService(db,{REVENUECAT_SECRET_KEY:'secret',REVENUECAT_SANDBOX_ACCOUNT_IDS:id},async()=>Response.json({subscriber:subscriber({is_sandbox:true})}));
 await service.syncRevenueCat(id);await service.syncRevenueCat(other);
 expect(accountPlan(db,id).pro).toBe(true);expect(accountPlan(db,other).pro).toBe(false);
});
