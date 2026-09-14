import { createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode } from 'react';
import { AppState,Platform } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { useSession } from '../session/SessionProvider.tsx';
import { purchases } from './native';
import type { Plan } from './types.ts';

type Billing = {plan:Plan|null;monthly:PurchasesPackage|null;loading:boolean;busy:boolean;error:string;notice:string;refresh():Promise<void>;purchase():Promise<void>;restore():Promise<void>};
const Context=createContext<Billing|null>(null);
export function BillingProvider({children}:{children:ReactNode}) {
  const {account,client}=useSession();const scope=useRef(account?.id);scope.current=account?.id;
  const [plan,setPlan]=useState<Plan|null>(null);const [monthly,setMonthly]=useState<PurchasesPackage|null>(null);
  const [loading,setLoading]=useState(false);const [busy,setBusy]=useState(false);const pending=useRef(false);
  const [error,setError]=useState('');const [notice,setNotice]=useState('');
  const generation=useRef(0);const lifetime=useRef(0);
  const refresh=useCallback(async()=>{
    const owner=account?.id;if (!owner) return;const revision=++generation.current;
    setLoading(true);setError('');
    try {
      const next=await client.plan();if(scope.current!==owner || revision!==generation.current)return;
      setPlan(next);
      const config=next.billing.revenuecat;
      if(Platform.OS==='ios' && config.available && config.publicKey){
        await purchases.setIdentity({appUserId:config.appUserId,publicKey:config.publicKey});
        if(scope.current!==owner || revision!==generation.current)return;
        const offerings=await purchases.offerings(config.appUserId);
        if(scope.current!==owner || revision!==generation.current)return;
        const value=offerings.current?.availablePackages.find(item=>item.product.identifier===config.productId && item.product.subscriptionPeriod==='P1M')||null;
        setMonthly(value);
      }else setMonthly(null);
    }catch(value){if(scope.current===owner && revision===generation.current)setError(value instanceof Error?value.message:'Subscription settings could not load.');}
    finally{if(scope.current===owner && revision===generation.current)setLoading(false);}
  },[account?.id,client]);
  useEffect(()=>{
    setPlan(null);setMonthly(null);setError('');setNotice('');setBusy(false);
    if(account?.id)void refresh();
    return()=>{generation.current++;lifetime.current++;void purchases.setIdentity(null).catch(()=>{});};
  },[account?.id,refresh]);
  useEffect(()=>{const listener=AppState.addEventListener('change',state=>{if(state==='active' && !pending.current)void refresh();});return()=>listener.remove();},[refresh]);
  const act=async(kind:'purchase'|'restore')=>{
    const owner=account?.id;if(!owner || pending.current)return;
    const actionLifetime=lifetime.current;
    const active=()=>scope.current===owner && lifetime.current===actionLifetime;
    let storeStarted=false;let reservation:string|undefined;let cancelled=false;let verified=false;
    pending.current=true;setBusy(true);setError('');setNotice('');
    try{
      const current=await client.purchaseCheck(kind);reservation=current.purchaseAttemptId;
      if(!active())return;
      setPlan(current);
      const config=current.billing.revenuecat;
      if(Platform.OS!=='ios' || !config?.available || !config.publicKey)throw new Error('App Store subscriptions are not available yet. Your free collection is ready to use.');
      await purchases.setIdentity({appUserId:config.appUserId,publicKey:config.publicKey});
      if(!active())return;
      if(current.subscriptions.some(item=>item.provider==='stripe'&&item.active))throw new Error('Your account already has Pro through the web. Manage that subscription in your dashboard.');
      if(kind==='purchase'){
        if(current.pro)throw new Error('You already have Pro on this account.');
        if(current.subscriptions.some(item=>item.provider==='stripe' && !['inactive','canceled','incomplete_expired'].includes(item.status)))throw new Error('Your existing web subscription needs attention. Manage it in your FoundKeep dashboard before starting another subscription.');
        const offerings=await purchases.offerings(config.appUserId);
        if(!active())return;
        const selected=offerings.current?.availablePackages.find(item=>item.product.identifier===config.productId && item.product.subscriptionPeriod==='P1M');
        if(!selected)throw new Error('The monthly plan is unavailable. Refresh and try again.');
        setMonthly(selected);storeStarted=true;await purchases.purchase(config.appUserId,selected);
      }else {storeStarted=true;await purchases.restore(config.appUserId);}
      if(!active())return;
      await client.syncRevenueCat();
      if(!active())return;
      const updated=await client.plan();verified=updated.pro;
      if(!active())return;
      setPlan(updated);setNotice(updated.pro?'Pro is ready across your FoundKeep account.':kind==='restore'?'No active Pro purchase was found for this Apple Account.':'Your purchase is pending verification. You can restore it again shortly.');
    }catch(value){cancelled=!!(value as {userCancelled?:boolean})?.userCancelled;if(active() && !cancelled)setError(value instanceof Error?value.message:'The App Store could not complete this request.');}
    finally{if(reservation&&(!storeStarted||cancelled||verified||kind==='restore'))await client.cancelMobilePurchase(reservation).catch(()=>{});pending.current=false;if(active())setBusy(false);}
  };
  return <Context.Provider value={{plan,monthly,loading,busy,error,notice,refresh,purchase:()=>act('purchase'),restore:()=>act('restore')}}>{children}</Context.Provider>;
}
export function useBilling(){const context=useContext(Context);if(!context)throw new Error('BillingProvider is required.');return context;}
