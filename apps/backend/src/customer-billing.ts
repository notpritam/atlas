import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import type { Hono } from 'hono';
import Stripe from 'stripe';
import { readBoundedText as boundedText } from './customer-network.ts';
import type { CustomerEnv } from './customer.ts';
import { moduleFail, type CustomerServices } from './customer-modules.ts';
import { accountPlan, writeSubscription, type SubscriptionSnapshot } from './customer-plans.ts';
import { paddleSnapshot, gateSandbox } from './paddle-snapshot.ts';
import { verifyPaddleSignature } from './paddle-signature.ts';

type Environment = Record<string,string|undefined>;
type Identity = { account_id:string; revenuecat_id:string; stripe_id:string|null;checkout_id:string|null;checkout_attempt:string|null;paddle_id:string|null };
const inactive = ():SubscriptionSnapshot => ({status:'inactive',expiresAt:0,renews:false,sandbox:false});
const timestamp = (value:unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
export function revenueCatSnapshot(subscriber: any, config:{entitlement:string;product:string;allowSandbox:boolean}):SubscriptionSnapshot {
  const entitlement=subscriber?.entitlements?.[config.entitlement];
  if (!entitlement || entitlement.product_identifier !== config.product) return inactive();
  const subscription=subscriber?.subscriptions?.[config.product];
  if (!subscription || subscription.refunded_at) return inactive();
  const sandbox=subscription.is_sandbox === true;
  if (sandbox && !config.allowSandbox) return {...inactive(),sandbox};
  const expiresAt=Math.max(timestamp(entitlement.expires_date),timestamp(entitlement.grace_period_expires_date));
  return { status:expiresAt>Date.now()?'active':'inactive', expiresAt, sandbox,
    renews:!subscription.unsubscribe_detected_at && !subscription.billing_issues_detected_at };
}

function equalSecret(a:string,b:string) { const x=Buffer.from(a); const y=Buffer.from(b); return x.length===y.length && timingSafeEqual(x,y); }
const billingOperations = new WeakMap<Database, Map<string, Promise<unknown>>>();
export function createBillingService(db:Database, env:Environment=process.env, fetcher:(input:string|URL|Request,init?:RequestInit)=>Promise<Response>=fetch) {
  const rc={ entitlement:env.REVENUECAT_ENTITLEMENT_ID||'pro', product:env.REVENUECAT_MONTHLY_PRODUCT_ID||'app.foundkeep.pro.monthly', allowSandbox:env.REVENUECAT_ALLOW_SANDBOX==='true' };
  const sandboxAccounts=new Set((env.REVENUECAT_SANDBOX_ACCOUNT_IDS||'').split(',').map(value=>value.trim()).filter(Boolean));
  const publicKey=/^appl_[A-Za-z0-9]+$/.test(env.REVENUECAT_IOS_PUBLIC_KEY||'') ? env.REVENUECAT_IOS_PUBLIC_KEY! : null;
  const rcAvailable=!!(publicKey && env.REVENUECAT_SECRET_KEY && env.REVENUECAT_WEBHOOK_AUTH);
  const stripe=env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY,{ maxNetworkRetries:1,timeout:15_000,httpClient:Stripe.createFetchHttpClient(fetcher as typeof fetch) }) : null;
  const stripeAvailable=!!(stripe && env.STRIPE_PRICE_ID && env.STRIPE_WEBHOOK_SECRET);
  const paddle = {
    apiKey: env.PADDLE_API_KEY, base: env.PADDLE_API_BASE || 'https://sandbox-api.paddle.com',
    priceId: env.PADDLE_PRICE_ID, webhookSecret: env.PADDLE_WEBHOOK_SECRET,
    sandbox: (env.PADDLE_ENV || 'sandbox') === 'sandbox',
    checkoutOrigin: env.PADDLE_CHECKOUT_ORIGIN || 'https://foundkeep.app',
    sandboxAccounts: new Set((env.PADDLE_SANDBOX_ACCOUNT_IDS || '').split(',').map(s => s.trim()).filter(Boolean)),
  };
  const paddleAvailable = !!(paddle.apiKey && paddle.webhookSecret && paddle.priceId);
  async function paddleReq(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown) {
    const res = await fetcher(paddle.base + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${paddle.apiKey}`, 'Content-Type': 'application/json', 'Paddle-Version': '1' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) moduleFail(503, 'billing_unavailable', 'Payment provider is temporarily unavailable.');
    try { return (JSON.parse(await boundedText(res)) as any).data; }
    catch { moduleFail(503, 'verification_pending', 'Could not read the payment provider response.'); }
  }
  // Serialize all observations of a provider/account, including webhook and restore.
  // Every event retrieves current provider state; delivery order cannot revert it.
  const operations=billingOperations.get(db)||new Map<string,Promise<unknown>>();
  billingOperations.set(db,operations);
  async function serial<T>(key:string, action:()=>Promise<T>):Promise<T> {
    if (!operations.has(key) && operations.size>=100) moduleFail(503,'billing_busy','Subscription verification is busy. Try again shortly.');
    const operation=(operations.get(key)||Promise.resolve()).catch(() => {}).then(action);
    operations.set(key,operation);
    try { return await operation; } finally { if (operations.get(key)===operation) operations.delete(key); }
  }
  function identity(accountId:string):Identity {
    if (!db.query('SELECT 1 FROM customer_accounts WHERE id=?').get(accountId)) moduleFail(404,'account_not_found','Account not found.');
    db.query('INSERT OR IGNORE INTO customer_billing_identities(account_id,revenuecat_id,created_at) VALUES(?,?,?)').run(accountId,'fk_'+randomBytes(32).toString('base64url'),Date.now());
    return db.query('SELECT account_id,revenuecat_id,stripe_id,checkout_id,checkout_attempt,paddle_id FROM customer_billing_identities WHERE account_id=?').get(accountId) as Identity;
  }
  function configuration(accountId:string) {
    const owned=identity(accountId);
    return { revenuecat:{ available:rcAvailable, publicKey:rcAvailable?publicKey:null, appUserId:owned.revenuecat_id, entitlementId:rc.entitlement, productId:rc.product },
      stripe:{ available:stripeAvailable, canManage:!!owned.stripe_id },
      paddle:{ available:paddleAvailable, canManage:!!owned.paddle_id } };
  }
  async function syncRevenueCat(accountId:string) {
    if (!env.REVENUECAT_SECRET_KEY) moduleFail(503,'billing_unavailable','App Store subscriptions are not configured yet.');
    return serial(`rc:${accountId}`,async () => {
      const owned=identity(accountId);
      const response=await fetcher('https://api.revenuecat.com/v1/subscribers/'+encodeURIComponent(owned.revenuecat_id),{
        headers:{authorization:`Bearer ${env.REVENUECAT_SECRET_KEY}`,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15_000) });
      if(response.status===404){writeSubscription(db,accountId,'revenuecat',inactive());return accountPlan(db,accountId);}
      if (!response.ok) moduleFail(503,'verification_pending','Your purchase is safe. Subscription verification is temporarily unavailable; try restoring again shortly.');
      let data:any; try { data=JSON.parse(await boundedText(response)); } catch { moduleFail(503,'verification_pending','Could not verify the subscription. Try again shortly.'); }
      if (!data?.subscriber || typeof data.subscriber!=='object') moduleFail(503,'verification_pending','Could not verify the subscription. Try again shortly.');
      const snapshot=revenueCatSnapshot(data.subscriber,{...rc,allowSandbox:rc.allowSandbox||sandboxAccounts.has(accountId)});
      writeSubscription(db,accountId,'revenuecat',snapshot);
      if(snapshot.status==='active' && owned.checkout_id){
        if(!stripe)moduleFail(503,'verification_pending','An existing web checkout needs reconciliation.');
        const pending=await stripe.checkout.sessions.retrieve(owned.checkout_id);
        if(pending.status==='open')await stripe.checkout.sessions.expire(pending.id);
        db.query('UPDATE customer_billing_identities SET checkout_id=NULL,checkout_attempt=NULL WHERE account_id=? AND checkout_id=?').run(accountId,owned.checkout_id);
      }
      return accountPlan(db,accountId);
    });
  }
  async function syncStripe(accountId:string) {
    if (!stripe) moduleFail(503,'billing_unavailable','Web subscriptions are not configured yet.');
    return serial(`stripe:${accountId}`,async () => {
      const owned=identity(accountId); if (!owned.stripe_id) return accountPlan(db,accountId);
      const list=await stripe.subscriptions.list({customer:owned.stripe_id,status:'all',limit:100});
      if (list.has_more) moduleFail(503,'verification_pending','Subscription verification needs another attempt.');
      const relevant=list.data.filter(subscription=>subscription.items.data.some(item=>item.price.id===env.STRIPE_PRICE_ID));
      const recoverable=relevant.find(subscription=>!['canceled','incomplete_expired'].includes(subscription.status));
      const active=relevant.filter(subscription => ['active','trialing'].includes(subscription.status))
        .flatMap(subscription => subscription.items.data.filter(item => item.price.id===env.STRIPE_PRICE_ID).map(item => ({subscription,expiresAt:item.current_period_end*1000})))
        .sort((a,b) => b.expiresAt-a.expiresAt)[0];
      writeSubscription(db,accountId,'stripe',active ? {status:'active',expiresAt:active.expiresAt,renews:!active.subscription.cancel_at_period_end,sandbox:!active.subscription.livemode} : recoverable ? {status:recoverable.status,expiresAt:Math.max(0,...recoverable.items.data.map(item=>item.current_period_end*1000)),renews:!recoverable.cancel_at_period_end,sandbox:!recoverable.livemode} : inactive());
      return accountPlan(db,accountId);
    });
  }
  async function syncPaddle(accountId:string) {
    if (!paddleAvailable) moduleFail(503,'billing_unavailable','Web subscriptions are not configured yet.');
    return serial(`paddle:${accountId}`,async () => {
      const owned=identity(accountId);
      if (!owned.paddle_id) { writeSubscription(db,accountId,'paddle',{status:'inactive',expiresAt:0,renews:false,sandbox:paddle.sandbox}); return accountPlan(db,accountId); }
      const subs=await paddleReq(`/subscriptions?customer_id=${encodeURIComponent(owned.paddle_id)}&status=active`);
      const list=Array.isArray(subs) ? subs : [];
      const relevant=list.filter((s:any) => (s.items||[]).some((it:any) => it?.price?.id===paddle.priceId) || list.length===1);
      const chosen=(relevant.length ? relevant : list).map((s:any) => paddleSnapshot(s,{sandbox:paddle.sandbox}))
        .sort((a,b) => b.expiresAt-a.expiresAt)[0] ?? {status:'inactive',expiresAt:0,renews:false,sandbox:paddle.sandbox};
      const gated=gateSandbox(chosen, !paddle.sandbox || paddle.sandboxAccounts.has(accountId));
      writeSubscription(db,accountId,'paddle',gated);
      return accountPlan(db,accountId);
    });
  }
  async function ensurePaddleCustomer(accountId:string):Promise<string> {
    let owned=identity(accountId);
    if (owned.paddle_id) return owned.paddle_id;
    const email=(db.query('SELECT email FROM customer_accounts WHERE id=?').get(accountId) as {email:string}).email;
    // Reuse an existing Paddle customer for this email if present (create 409s otherwise).
    const existing=await paddleReq(`/customers?email=${encodeURIComponent(email)}`);
    const found=Array.isArray(existing) && existing[0]?.id;
    const customerId=found || (await paddleReq('/customers','POST',{email,custom_data:{foundkeep_account:accountId}})).id;
    identity(accountId); // never recreate access if account was deleted mid-request
    db.query('UPDATE customer_billing_identities SET paddle_id=? WHERE account_id=? AND paddle_id IS NULL').run(customerId,accountId);
    owned=identity(accountId);
    return owned.paddle_id!;
  }
  async function paddleCheckout(accountId:string) {
    if (!paddleAvailable) moduleFail(503,'billing_unavailable','Web subscriptions are coming soon. Your free collection stays available.');
    return serial(`purchase:${accountId}`,async () => {
      await refreshProviders(accountId);
      if (accountPlan(db,accountId).pro) moduleFail(409,'already_pro','You already have Pro. Manage the existing subscription instead.');
      if (db.query('SELECT 1 FROM customer_purchase_attempts WHERE account_id=? AND expires_at>?').get(accountId,Date.now())) moduleFail(409,'subscription_pending','An App Store purchase is still pending. Finish or cancel it before opening web checkout.');
      if (accountPlan(db,accountId).subscriptions.some(s => s.provider==='paddle' && !['inactive','canceled'].includes(s.status))) moduleFail(409,'subscription_pending','Your existing subscription needs attention. Manage it instead.');
      const price=await paddleReq(`/prices/${encodeURIComponent(paddle.priceId!)}`);
      if (price.status!=='active' || price.unit_price?.amount!=='500' || price.unit_price?.currency_code!=='USD'
        || price.billing_cycle?.interval!=='month' || price.billing_cycle?.frequency!==1 || price.trial_period) {
        moduleFail(503,'billing_unavailable','The monthly plan is not configured correctly.');
      }
      const customerId=await ensurePaddleCustomer(accountId);
      const txn=await paddleReq('/transactions','POST',{
        items:[{price_id:paddle.priceId,quantity:1}], customer_id:customerId,
        custom_data:{foundkeep_account:accountId},
      });
      if (typeof txn?.id!=='string') moduleFail(503,'billing_unavailable','Could not open checkout.');
      return `${paddle.checkoutOrigin}/checkout?_ptxn=${txn.id}`;
    });
  }
  async function paddlePortal(accountId:string) {
    const owned=identity(accountId);
    if (!paddleAvailable || !owned.paddle_id) moduleFail(409,'no_web_subscription','There is no web subscription to manage.');
    const session=await paddleReq(`/customers/${encodeURIComponent(owned.paddle_id!)}/portal-sessions`,'POST',{});
    const url=session?.urls?.general?.overview;
    if (typeof url!=='string') moduleFail(503,'billing_unavailable','Could not open subscription settings.');
    return url;
  }
  async function refreshProviders(accountId:string){
    const owned=identity(accountId);
    if(stripe&&env.STRIPE_PRICE_ID&&owned.stripe_id)await syncStripe(accountId);
    if(env.REVENUECAT_SECRET_KEY)await syncRevenueCat(accountId);
    if(paddleAvailable&&owned.paddle_id)await syncPaddle(accountId);
    return {...accountPlan(db,accountId),billing:configuration(accountId)};
  }
  async function purchaseCheck(accountId:string,intent?:'purchase'|'restore'){
    return serial(`purchase:${accountId}`,async()=>{
      await refreshProviders(accountId);
      let purchaseAttemptId:string|undefined;
      if(intent){
        if(!rcAvailable)moduleFail(503,'billing_unavailable','App Store subscriptions are not configured yet.');
        db.query('DELETE FROM customer_purchase_attempts WHERE expires_at<=?').run(Date.now());
        if(intent==='purchase' && db.query("SELECT 1 FROM customer_purchase_attempts WHERE account_id=? AND kind='purchase'").get(accountId))moduleFail(409,'subscription_pending','An App Store purchase is already pending. Finish it or restore your purchase.');
        const owned=identity(accountId);
        if(owned.checkout_id){
          if(!stripe)moduleFail(503,'verification_pending','Web checkout must be verified before another purchase.');
          const pending=await stripe.checkout.sessions.retrieve(owned.checkout_id);
          if(pending.status==='open')await stripe.checkout.sessions.expire(pending.id);
          await syncStripe(accountId);
          identity(accountId);
          db.query('UPDATE customer_billing_identities SET checkout_id=NULL,checkout_attempt=NULL WHERE account_id=?').run(accountId);
        }
        const current=accountPlan(db,accountId);
        if(!current.pro && current.subscriptions.some(item=>item.provider==='stripe' && !['inactive','canceled','incomplete_expired'].includes(item.status)))moduleFail(409,'subscription_pending','Your web subscription needs attention. Manage it before starting another subscription.');
        if(!current.pro){purchaseAttemptId=crypto.randomUUID();db.query('INSERT INTO customer_purchase_attempts(id,account_id,kind,expires_at) VALUES(?,?,?,?)').run(purchaseAttemptId,accountId,intent,Date.now()+24*3600_000);}
      }
      return {...accountPlan(db,accountId),billing:configuration(accountId),purchaseAttemptId};
    });
  }
  async function cancelMobilePurchase(accountId:string,attemptId:string){
    return serial(`purchase:${accountId}`,async()=>{identity(accountId);db.query('DELETE FROM customer_purchase_attempts WHERE account_id=? AND id=?').run(accountId,attemptId);});
  }
  function processed(provider:string,id:string) { return !!db.query('SELECT 1 FROM customer_billing_events WHERE provider=? AND event_id=?').get(provider,id); }
  function finishEvent(provider:string,id:string) {
    db.transaction(() => {
      db.query('DELETE FROM customer_billing_events WHERE processed_at<?').run(Date.now()-90*86_400_000);
      db.query('INSERT OR IGNORE INTO customer_billing_events VALUES(?,?,?)').run(provider,id,Date.now());
    })();
  }
  async function revenueCatWebhook(header:string,body:unknown) {
    if (!env.REVENUECAT_WEBHOOK_AUTH || !equalSecret(header,env.REVENUECAT_WEBHOOK_AUTH)) moduleFail(401,'invalid_webhook','Invalid webhook authorization.');
    const event=(body as any)?.event;
    if (!event || typeof event.id!=='string' || event.id.length>200 || typeof event.type!=='string') moduleFail(400,'invalid_webhook','Invalid webhook event.');
    if (processed('revenuecat',event.id)) return;
    if (event.type==='TEST') { finishEvent('revenuecat',event.id); return; }
    const candidates=event.type==='TRANSFER' ? [...(Array.isArray(event.transferred_from)?event.transferred_from:[]),...(Array.isArray(event.transferred_to)?event.transferred_to:[])] : [event.app_user_id];
    if (candidates.length>100) moduleFail(400,'invalid_webhook','Too many subscription identities.');
    for (const candidate of new Set(candidates)) {
      if (typeof candidate!=='string' || candidate.length>100) continue;
      const owned=db.query('SELECT account_id FROM customer_billing_identities WHERE revenuecat_id=?').get(candidate) as {account_id:string}|null;
      if (owned) await syncRevenueCat(owned.account_id);
    }
    finishEvent('revenuecat',event.id);
  }
  async function stripeWebhook(signature:string,raw:string) {
    if (!stripe || !env.STRIPE_WEBHOOK_SECRET) moduleFail(503,'billing_unavailable','Web billing is not configured.');
    let event:Stripe.Event;
    try { event=await stripe.webhooks.constructEventAsync(raw,signature,env.STRIPE_WEBHOOK_SECRET); }
    catch { moduleFail(400,'invalid_webhook','Invalid webhook signature.'); }
    if (processed('stripe',event.id)) return;
    if (['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','checkout.session.completed'].includes(event.type)) {
      const customer=(event.data.object as any).customer;
      const customerId=typeof customer==='string'?customer:customer?.id;
      if (typeof customerId==='string') {
        const owned=db.query('SELECT account_id FROM customer_billing_identities WHERE stripe_id=?').get(customerId) as {account_id:string}|null;
        if (owned) await syncStripe(owned.account_id);
      }
    }
    finishEvent('stripe',event.id);
  }
  async function paddleWebhook(signature:string,rawBody:string) {
    if (!paddleAvailable) moduleFail(503,'billing_unavailable','Web billing is not configured.');
    if (!verifyPaddleSignature(rawBody,signature,paddle.webhookSecret!)) moduleFail(401,'invalid_webhook','Invalid webhook signature.');
    let event:any;
    try { event=JSON.parse(rawBody); } catch { moduleFail(400,'invalid_webhook','Invalid webhook body.'); }
    const eventId=event?.event_id;
    if (typeof eventId!=='string' || eventId.length>200 || typeof event.event_type!=='string') moduleFail(400,'invalid_webhook','Invalid webhook event.');
    if (processed('paddle',eventId)) return;
    // Resolve the account by CUSTOMER ID first: custom_data does not propagate to subscription events.
    const data=event.data||{};
    const customerId=typeof data.customer_id==='string' ? data.customer_id : (data.customer && typeof data.customer==='object' ? data.customer.id : undefined);
    const hint=data.custom_data?.foundkeep_account;
    const owned=(typeof customerId==='string' && db.query('SELECT account_id FROM customer_billing_identities WHERE paddle_id=?').get(customerId) as {account_id:string}|null)
      || (typeof hint==='string' && db.query('SELECT account_id FROM customer_billing_identities WHERE account_id=?').get(hint) as {account_id:string}|null);
    if (owned) await syncPaddle(owned.account_id); // throws on provider error → non-2xx → Paddle retries; finishEvent only after success
    finishEvent('paddle',eventId);
  }
  async function checkout(accountId:string) {
    if (!stripe || !stripeAvailable) moduleFail(503,'billing_unavailable','Web subscriptions are coming soon. Your free collection stays available.');
    return serial(`purchase:${accountId}`,async () => {
      await refreshProviders(accountId);
      if (accountPlan(db,accountId).pro) moduleFail(409,'already_pro','You already have Pro. Manage the existing subscription instead.');
      let owned=identity(accountId);
      if(db.query('SELECT 1 FROM customer_purchase_attempts WHERE account_id=? AND expires_at>?').get(accountId,Date.now()))moduleFail(409,'subscription_pending','An App Store purchase is still pending. Finish or cancel it on your iPhone before opening web checkout.');
      if(accountPlan(db,accountId).subscriptions.some(item=>item.provider==='stripe' && !['inactive','canceled','incomplete_expired'].includes(item.status)))moduleFail(409,'subscription_pending','Your existing subscription needs attention. Manage that subscription instead.');
      const price=await stripe.prices.retrieve(env.STRIPE_PRICE_ID!);
      if (!price.active || price.currency!=='usd' || price.unit_amount!==500 || price.recurring?.interval!=='month' || price.recurring.interval_count!==1) {
        moduleFail(503,'billing_unavailable','The monthly plan is not configured correctly.');
      }
      if (!owned.stripe_id) {
        const customer=await stripe.customers.create({metadata:{foundkeep_account:accountId}},{idempotencyKey:`foundkeep-customer:${accountId}`});
        identity(accountId); // Account deletion during provider request must not recreate access.
        db.query('UPDATE customer_billing_identities SET stripe_id=? WHERE account_id=?').run(customer.id,accountId);
        owned=identity(accountId);
      }
      await syncStripe(accountId);
      if (accountPlan(db,accountId).pro) moduleFail(409,'already_pro','You already have an active subscription.');
      if(owned.checkout_id){
        const pending=await stripe.checkout.sessions.retrieve(owned.checkout_id,{expand:['subscription']});
        if(pending.status==='open' && pending.expires_at*1000>Date.now() && pending.url?.startsWith('https://checkout.stripe.com/'))return pending.url;
        const subscription=pending.subscription;
        if(pending.status==='complete' && subscription && typeof subscription!=='string' && !['canceled','incomplete_expired'].includes(subscription.status)) {
          moduleFail(409,'subscription_pending','An existing subscription is active or awaiting payment. Manage that subscription instead.');
        }
        db.query('UPDATE customer_billing_identities SET checkout_id=NULL,checkout_attempt=NULL WHERE account_id=?').run(accountId);
        owned=identity(accountId);
      }
      if(!owned.checkout_attempt){
        db.query('UPDATE customer_billing_identities SET checkout_attempt=? WHERE account_id=?').run(crypto.randomUUID(),accountId);
        owned=identity(accountId);
      }
      const result=await stripe.checkout.sessions.create({mode:'subscription',customer:owned.stripe_id!,line_items:[{price:price.id,quantity:1}],
        success_url:'https://foundkeep.app/dashboard?billing=success',cancel_url:'https://foundkeep.app/dashboard?billing=cancelled',
        client_reference_id:accountId,subscription_data:{metadata:{foundkeep_account:accountId}} },{idempotencyKey:`foundkeep-checkout:${accountId}:${owned.checkout_attempt}`});
      if (!result.url?.startsWith('https://checkout.stripe.com/')) moduleFail(503,'billing_unavailable','Could not open checkout.');
      identity(accountId);
      db.query('UPDATE customer_billing_identities SET checkout_id=? WHERE account_id=?').run(result.id,accountId);
      return result.url;
    });
  }
  async function portal(accountId:string) {
    const owned=identity(accountId);
    if (!stripe || !owned.stripe_id) moduleFail(409,'no_web_subscription','There is no web subscription to manage.');
    const result=await stripe.billingPortal.sessions.create({customer:owned.stripe_id,return_url:'https://foundkeep.app/dashboard'});
    if (!result.url.startsWith('https://billing.stripe.com/')) moduleFail(503,'billing_unavailable','Could not open subscription settings.');
    return result.url;
  }
  return {configuration,purchaseCheck,cancelMobilePurchase,syncRevenueCat,syncStripe,revenueCatWebhook,stripeWebhook,checkout,portal,syncPaddle,paddleCheckout,paddlePortal,paddleWebhook};
}
export function registerCustomerBilling(app:Hono<CustomerEnv>,db:Database,services:CustomerServices) {
  const billing=createBillingService(db);
  app.get('/plan',c => { const current=services.auth(c); return c.json({...accountPlan(db,current.account.id),billing:billing.configuration(current.account.id)}); });
  app.post('/billing/purchase-check',async c=>{
    services.auth(c);const body=await services.jsonBody(c);if(Object.keys(body).some(key=>key!=='intent') || (body.intent!==undefined && !['purchase','restore'].includes(body.intent as string)))moduleFail(400,'invalid_input','Invalid purchase check.');
    const current=services.auth(c);services.rate('purchase-check:'+current.account.id,10,60_000);
    const result=await billing.purchaseCheck(current.account.id,body.intent as 'purchase'|'restore'|undefined);services.auth(c,false,false);return c.json(result);
  });
  app.post('/billing/revenuecat/purchase-cancelled',async c=>{services.auth(c);const body=await services.jsonBody(c);if(Object.keys(body).some(key=>key!=='attemptId')||typeof body.attemptId!=='string'||!/^[a-f0-9-]{36}$/.test(body.attemptId))moduleFail(400,'invalid_input','A purchase attempt is required.');const current=services.auth(c);services.rate('purchase-cancel:'+current.account.id,10,60_000);await billing.cancelMobilePurchase(current.account.id,body.attemptId as string);services.auth(c,false,false);return c.json({ok:true});});
  app.post('/billing/revenuecat/sync',async c => {
    const current=services.auth(c); services.rate(`purchase-sync:${current.account.id}`,10,60_000);
    const result=await billing.syncRevenueCat(current.account.id); services.auth(c,false,false); return c.json(result);
  });
  app.post('/billing/stripe/sync',async c => {
    const current=services.auth(c,true); services.rate(`purchase-sync:${current.account.id}`,10,60_000);
    const result=await billing.syncStripe(current.account.id); services.auth(c,true,false); return c.json(result);
  });
  for (const [path,fn] of [['checkout',billing.paddleCheckout],['portal',billing.paddlePortal]] as const) app.post('/billing/'+path,async c => {
    const current=services.auth(c,true); services.rate(`billing:${current.account.id}`,5,60_000);
    const body=await services.jsonBody(c); if (Object.keys(body).length) moduleFail(400,'invalid_billing_request','This action does not accept a price or redirect URL.');
    services.auth(c,true,false); const url=await fn(current.account.id); services.auth(c,true,false); return c.json({url});
  });
  app.post('/billing/paddle/sync',async c => {
    const current=services.auth(c,true); services.rate(`purchase-sync:${current.account.id}`,10,60_000);
    const result=await billing.syncPaddle(current.account.id); services.auth(c,true,false); return c.json(result);
  });
  app.post('/billing/webhooks/paddle',async c => { await billing.paddleWebhook(c.req.header('paddle-signature')||'',await boundedText(c.req.raw)); return c.json({ok:true}); });
  app.post('/billing/webhooks/revenuecat',async c => {
    const header=c.req.header('authorization')||'';
    // Authenticate before reading the body to reject unauthenticated load early.
    if (!process.env.REVENUECAT_WEBHOOK_AUTH || !equalSecret(header,process.env.REVENUECAT_WEBHOOK_AUTH)) moduleFail(401,'invalid_webhook','Invalid webhook authorization.');
    await billing.revenueCatWebhook(header,await services.jsonBody(c,256*1024)); return c.json({ok:true});
  });
  app.post('/billing/webhooks/stripe',async c => { await billing.stripeWebhook(c.req.header('stripe-signature')||'',await boundedText(c.req.raw)); return c.json({ok:true}); });
}

export async function processBillingCleanup(db:Database,env:Environment=process.env,fetcher:(input:string|URL|Request,init?:RequestInit)=>Promise<Response>=fetch) {
  const rows=db.query("SELECT provider,external_id,attempts FROM customer_billing_cleanup WHERE next_attempt_at<=? AND ((provider='stripe' AND ?=1) OR (provider='revenuecat' AND ?=1) OR (provider='paddle' AND ?=1)) ORDER BY created_at LIMIT 10").all(Date.now(),Number(!!env.STRIPE_SECRET_KEY),Number(!!env.REVENUECAT_SECRET_KEY),Number(!!env.PADDLE_API_KEY)) as {provider:string;external_id:string;attempts:number}[];
  const stripe=env.STRIPE_SECRET_KEY?new Stripe(env.STRIPE_SECRET_KEY,{maxNetworkRetries:1,timeout:15_000,httpClient:Stripe.createFetchHttpClient(fetcher as typeof fetch)}):null;
  for(const row of rows){
    if(row.provider==='stripe'&&!stripe || row.provider==='revenuecat'&&!env.REVENUECAT_SECRET_KEY || row.provider==='paddle'&&!env.PADDLE_API_KEY)continue;
    try{
      if(row.provider==='stripe'){
        // Stripe customer deletion also immediately cancels its subscriptions.
        try{await stripe!.customers.del(row.external_id);}catch(error){if((error as {code?:string}).code!=='resource_missing')throw error;}
      }else if(row.provider==='paddle'){
        const base=env.PADDLE_API_BASE||'https://sandbox-api.paddle.com';
        const head={Authorization:`Bearer ${env.PADDLE_API_KEY}`,'Content-Type':'application/json','Paddle-Version':'1'};
        // Paddle has no customer-delete API: list every active subscription for the
        // customer, cancel each, then best-effort archive the customer record.
        const list=await fetcher(`${base}/subscriptions?customer_id=${encodeURIComponent(row.external_id)}&status=active`,{headers:head,redirect:'error',signal:AbortSignal.timeout(15_000)});
        if(!list.ok&&list.status!==404)throw new Error('Provider cleanup unavailable.');
        const subs=list.ok?((JSON.parse(await boundedText(list)) as any).data||[]):[];
        for(const s of subs){
          const cancelled=await fetcher(`${base}/subscriptions/${encodeURIComponent(s.id)}/cancel`,{method:'POST',headers:head,body:JSON.stringify({effective_from:'immediately'}),redirect:'error',signal:AbortSignal.timeout(15_000)});
          if(!cancelled.ok&&cancelled.status!==404)throw new Error('Provider cleanup unavailable.');
        }
        await fetcher(`${base}/customers/${encodeURIComponent(row.external_id)}`,{method:'PATCH',headers:head,body:JSON.stringify({status:'archived'}),redirect:'error',signal:AbortSignal.timeout(15_000)}).catch(()=>{});
      }else{
        const result=await fetcher('https://api.revenuecat.com/v1/subscribers/'+encodeURIComponent(row.external_id),{method:'DELETE',headers:{authorization:`Bearer ${env.REVENUECAT_SECRET_KEY}`},redirect:'error',signal:AbortSignal.timeout(15_000)});
        if(!result.ok&&result.status!==404)throw new Error('Provider cleanup unavailable.');
      }
      db.query('DELETE FROM customer_billing_cleanup WHERE provider=? AND external_id=?').run(row.provider,row.external_id);
    }catch{
      const delay=Math.min(86_400_000,60_000*2**Math.min(row.attempts,10));
      db.query('UPDATE customer_billing_cleanup SET attempts=attempts+1,next_attempt_at=? WHERE provider=? AND external_id=?').run(Date.now()+delay,row.provider,row.external_id);
    }
  }
}


/** Webhooks are primary; reconcile stale known subscriptions after missed events. */
export async function reconcileBilling(db:Database,env:Environment=process.env,fetcher:(input:string|URL|Request,init?:RequestInit)=>Promise<Response>=fetch){
  const stamp=Date.now();
  const rows=db.query(`SELECT account_id,provider FROM customer_subscriptions WHERE updated_at<? AND next_check_at<=?
    AND ((provider='stripe' AND ?=1) OR (provider='revenuecat' AND ?=1) OR (provider='paddle' AND ?=1)) ORDER BY next_check_at,updated_at LIMIT 5`)
    .all(stamp-6*3600_000,stamp,Number(!!(env.STRIPE_SECRET_KEY&&env.STRIPE_PRICE_ID)),Number(!!env.REVENUECAT_SECRET_KEY),Number(!!(env.PADDLE_API_KEY&&env.PADDLE_PRICE_ID))) as {account_id:string;provider:string}[];
  const billing=createBillingService(db,env,fetcher);
  for(const row of rows){
    let delay=300_000;
    try{if(row.provider==='stripe')await billing.syncStripe(row.account_id);else if(row.provider==='revenuecat')await billing.syncRevenueCat(row.account_id);else await billing.syncPaddle(row.account_id);delay=6*3600_000;}catch{}
    db.query('UPDATE customer_subscriptions SET next_check_at=? WHERE account_id=? AND provider=?').run(Date.now()+delay,row.account_id,row.provider);
  }
}
