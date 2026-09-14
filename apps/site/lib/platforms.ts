export const STORE_EXTENSION_ID='cficnecbdbiddngllpfbacabgbcjinmk';
export const LEGACY_EXTENSION_ID='mjfcgmboaijfcaanepdipbgmipnccnpn';
export const STORE_URL=`https://chromewebstore.google.com/detail/${STORE_EXTENSION_ID}`;
export interface IphoneConfig { distribution:'private-beta'|'testflight'|'app-store'; url:string; label:string; badge:string; description:string }
export interface CustomerConfig { extensionIds:string[];extensionEnvironment:'dev'|'prod';storeUrl:string;iphone:IphoneConfig }
export function iphoneConfig(value?:{distribution?:unknown;url?:unknown}):IphoneConfig {
 const fallback:IphoneConfig={distribution:'private-beta',url:'/support#iphone-beta',label:'Get iPhone beta',badge:'TestFlight beta',description:'The iPhone app is in a private TestFlight beta. Request access to try it.'};
 try{const url=new URL(String(value?.url));if(url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash)return fallback;
 if(value?.distribution==='app-store'&&url.hostname==='apps.apple.com'&&/\/id\d+$/.test(url.pathname))return {distribution:'app-store',url:url.href,label:'Get the iPhone app',badge:'App Store',description:'Get FoundKeep for iPhone from the App Store.'};
 if(value?.distribution==='testflight'&&url.hostname==='testflight.apple.com'&&/^\/join\/[A-Za-z0-9]+$/.test(url.pathname))return {distribution:'testflight',url:url.href,label:'Get iPhone beta',badge:'TestFlight beta',description:'Join the FoundKeep iPhone beta through TestFlight.'};
 }catch{}return fallback;
}
export const DEFAULT_CONFIG:CustomerConfig={extensionIds:[STORE_EXTENSION_ID,LEGACY_EXTENSION_ID],extensionEnvironment:'prod',storeUrl:STORE_URL,iphone:iphoneConfig()};
export function defaultCustomerConfig():CustomerConfig {
 return typeof window!=='undefined'&&window.location.hostname==='dev.foundkeep.app'
  ? {...DEFAULT_CONFIG,extensionEnvironment:'dev',extensionIds:[]}
  : DEFAULT_CONFIG;
}
let configRequest:Promise<CustomerConfig>|undefined;
let configFetchedAt=0;
export function customerConfig():Promise<CustomerConfig>{
 if(!configRequest||Date.now()-configFetchedAt>60000){
  const fallback=defaultCustomerConfig();configFetchedAt=Date.now();
  configRequest=fetch('/customer-config.json',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(5000)}).then(async r=>{
   if(!r.ok)throw new Error();const data=await r.json();
   const environment=data.extensionEnvironment==='dev'?'dev':'prod';
   if(fallback.extensionEnvironment==='dev'&&environment!=='dev')throw new Error('Wrong extension environment');
   if(typeof window!=='undefined'&&window.location.hostname==='foundkeep.app'&&environment!=='prod')throw new Error('Wrong extension environment');
   const ids=Array.isArray(data.extensionIds)?data.extensionIds.filter((id:unknown)=>typeof id==='string'&&/^[a-p]{32}$/.test(id)&&(environment!=='dev'||![STORE_EXTENSION_ID,LEGACY_EXTENSION_ID].includes(id))).slice(0,5):environment==='dev'?[]:fallback.extensionIds;
   let storeUrl=STORE_URL;try{const url=new URL(data.storeUrl);if(url.protocol==='https:'&&url.hostname==='chromewebstore.google.com'&&url.pathname.startsWith('/detail/')&&!url.username&&!url.password)storeUrl=url.href;}catch{}
   return {extensionIds:ids,extensionEnvironment:environment,storeUrl,iphone:iphoneConfig(data.iphone)} as CustomerConfig;
  }).catch(()=>fallback);
 }
 return configRequest;
}
export function isIphoneBrowser(){return typeof navigator!=='undefined'&&(/iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1));}
export function isMobileBrowser(){return typeof navigator!=='undefined'&&(/Android/i.test(navigator.userAgent)||isIphoneBrowser());}
interface Runtime {sendMessage:(id:string,message:unknown,callback:(response:any)=>void)=>void;lastError?:unknown}
export function extensionMessage<T=any>(message:unknown,extensionId=LEGACY_EXTENSION_ID):Promise<T>{return new Promise((resolve,reject)=>{
 const runtime=(globalThis as typeof globalThis&{chrome?:{runtime?:Runtime}}).chrome?.runtime;
 if(!runtime?.sendMessage){reject(new Error('FoundKeep is not detected in this browser.'));return;}
 let settled=false;const finish=(error:Error|null,response?:T)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(response as T);};
 const timer=setTimeout(()=>finish(new Error('FoundKeep did not respond. Reload the extension and try again.')),15000);
 try{runtime.sendMessage(extensionId,message,response=>{if(runtime.lastError||!response)return finish(new Error('FoundKeep could not be detected. Install or reload the extension, then refresh this page.'));if(!response.ok)return finish(new Error(response.error||'The extension could not connect.'));finish(null,response);});}catch{finish(new Error('FoundKeep could not be detected. Use a supported browser and reload the page.'));}
 });}
