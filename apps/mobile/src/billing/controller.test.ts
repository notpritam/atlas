import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appStorePurchaseOutcome, createPurchasesController } from './controller.ts';
function sdk() {
  let user=''; const calls:string[]=[];
  return {calls,configure:({appUserID}:any) => {user=appUserID; calls.push('configure:'+user);},getAppUserID:async()=>user,
    logIn:async(id:string)=>{user=id;calls.push('login:'+id);},logOut:async()=>{user='$RCAnonymousID';calls.push('logout');},isAnonymous:async()=>user==='$RCAnonymousID',
    getOfferings:async()=>({current:{availablePackages:[]}}),purchasePackage:async(_:unknown)=>{calls.push('purchase:'+user);},restorePurchases:async()=>{calls.push('restore:'+user);} };
}
const a={appUserId:'account-a',publicKey:'appl_public'};const b={...a,appUserId:'account-b'};
test('purchases require an authenticated identity; restore uses the current account',async()=>{
  const native=sdk();const controller=createPurchasesController(native);
  await assert.rejects(controller.purchase(a.appUserId,{}),/Sign in/);
  await controller.setIdentity(a);await controller.restore(a.appUserId);await controller.setIdentity(b);await controller.restore(b.appUserId);await controller.setIdentity(null);
  assert.deepEqual(native.calls,['configure:account-a','restore:account-a','login:account-b','restore:account-b','logout']);
  await assert.rejects(controller.restore(a.appUserId),/Sign in/);
});
test('a purchase finishing after an account switch cannot update the new account',async()=>{
  let finish!:()=>void;let started!:()=>void;const waiting=new Promise<void>(resolve=>{started=resolve;});const native=sdk();
  native.purchasePackage=async()=>{started();await new Promise<void>(resolve=>{finish=resolve;});};
  const controller=createPurchasesController(native);await controller.setIdentity(a);
  const purchase=controller.purchase(a.appUserId,{});await waiting;const switchAccount=controller.setIdentity(b);finish();
  await assert.rejects(purchase,/account changed/);await switchAccount;await controller.restore(b.appUserId);
  assert.equal(native.calls.at(-1),'restore:account-b');
});
test('repeat configuration does not log in again and SDK key changes require a restart',async()=>{
  const native=sdk();const controller=createPurchasesController(native);await controller.setIdentity(a);await controller.setIdentity(a);
  assert.deepEqual(native.calls,['configure:account-a']);
  await assert.rejects(controller.setIdentity({...a,publicKey:'appl_changed'}),/Restart/);
});

test('a stale screen cannot begin a purchase or restore under a newly signed-in account',async()=>{
  const native=sdk();const controller=createPurchasesController(native);
  await controller.setIdentity(a);await controller.setIdentity(null);await controller.setIdentity(b);
  await assert.rejects(controller.purchase(a.appUserId,{}),/account changed/);
  await assert.rejects(controller.restore(a.appUserId),/account changed/);
  assert.equal(native.calls.some(call=>call.startsWith('purchase:')||call.startsWith('restore:')),false);
});


test('complimentary and web Pro cannot verify an App Store transaction',()=>{
  for (const plan of [
    {pro:true,complimentaryPro:true,subscriptions:[]},
    {pro:true,complimentaryPro:false,subscriptions:[{provider:'stripe' as const,status:'active',expiresAt:0,renews:true,sandbox:false,active:true}]},
    {pro:true,complimentaryPro:true,subscriptions:[{provider:'revenuecat' as const,status:'expired',expiresAt:0,renews:false,sandbox:false,active:false}]},
  ]) {
    const restore=appStorePurchaseOutcome(plan,'restore');
    assert.equal(restore.verified,false);
    assert.match(restore.notice,/No active Pro purchase/);
    const purchase=appStorePurchaseOutcome(plan,'purchase');
    assert.equal(purchase.verified,false);
    assert.match(purchase.notice,/pending verification/);
  }
});
test('an active RevenueCat subscription verifies the transaction and complimentary restoration stays truthful',()=>{
  const result=appStorePurchaseOutcome({pro:true,subscriptions:[{provider:'revenuecat',status:'active',expiresAt:0,renews:true,sandbox:false,active:true}]},'restore');
  assert.equal(result.verified,true);
  assert.match(result.notice,/Pro is ready/);
  const complimentary=appStorePurchaseOutcome({pro:true,complimentaryPro:true,subscriptions:[]},'restore');
  assert.match(complimentary.notice,/complimentary beta access remains available/);
});
