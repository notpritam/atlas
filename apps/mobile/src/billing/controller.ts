import type { Plan } from './types.ts';

// The SDK is process-wide. Serialize identity changes with StoreKit operations;
// never return a purchase result into a different FoundKeep session.
export type PurchaseIdentity = { appUserId:string; publicKey:string };
type PurchasesSdk<Package,Offerings> = {
  configure(options:{apiKey:string;appUserID:string}):void;
  getAppUserID():Promise<string>;
  logIn(id:string):Promise<unknown>;
  logOut():Promise<unknown>;
  isAnonymous():Promise<boolean>;
  getOfferings():Promise<Offerings>;
  purchasePackage(value:Package):Promise<unknown>;
  restorePurchases():Promise<unknown>;
};
export function createPurchasesController<Package,Offerings>(sdk:PurchasesSdk<Package,Offerings>) {
  let desired:PurchaseIdentity|null=null;let generation=0;let configuredKey:string|null=null;let queue:Promise<unknown>=Promise.resolve();
  function serial<T>(action:()=>Promise<T>):Promise<T> {
    const operation=queue.catch(()=>{}).then(action);queue=operation;return operation;
  }
  async function identify() {
    if (!desired) {
      if (configuredKey && !await sdk.isAnonymous()) await sdk.logOut();
      return;
    }
    if (!configuredKey) {sdk.configure({apiKey:desired.publicKey,appUserID:desired.appUserId});configuredKey=desired.publicKey;}
    else if (configuredKey!==desired.publicKey) throw new Error('Restart FoundKeep to refresh App Store settings.');
    if (await sdk.getAppUserID()!==desired.appUserId) await sdk.logIn(desired.appUserId);
  }
  function authenticated<T>(expectedUserId:string,action:()=>Promise<T>):Promise<T> {
    const expected=desired;const revision=generation;
    const check=()=>{if (!expected) throw new Error('Sign in before managing a subscription.');if (revision!==generation || expected.appUserId!==expectedUserId) throw new Error('Your account changed. Open subscriptions again.');};
    return serial(async()=>{check();await identify();check();const result=await action();check();return result;});
  }
  return {
    setIdentity(value:PurchaseIdentity|null) {
      if (value?.appUserId!==desired?.appUserId || value?.publicKey!==desired?.publicKey) {desired=value;generation++;}
      return serial(identify);
    },
    offerings:(expectedUserId:string)=>authenticated(expectedUserId,()=>sdk.getOfferings()),
    purchase:(expectedUserId:string,value:Package)=>authenticated(expectedUserId,()=>sdk.purchasePackage(value)),
    restore:(expectedUserId:string)=>authenticated(expectedUserId,()=>sdk.restorePurchases()),
  };
}

export function appStorePurchaseOutcome(plan: Pick<Plan, 'pro' | 'complimentaryPro' | 'subscriptions'>, kind: 'purchase' | 'restore') {
  const verified=plan.subscriptions.some(item=>item.provider==='revenuecat' && item.active);
  const notice=verified ? 'Pro is ready across your FoundKeep account.' : kind === 'restore'
    ? 'No active Pro purchase was found for this Apple Account.'+(plan.complimentaryPro?' Your complimentary beta access remains available.':'')
    : 'Your purchase is pending verification. You can restore it again shortly.';
  return {verified,notice};
}
