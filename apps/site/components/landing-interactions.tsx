'use client';
import {PlatformIcon} from './ui/platform-icon';
import {Children,createContext,isValidElement,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {ExternalIcon} from './ui/external-link';
import {useAnimate} from 'motion/react-mini';
import {customerConfig,DEFAULT_CONFIG,extensionMessage,isIphoneBrowser,type CustomerConfig} from '@/lib/platforms';
import type {Account} from '@/lib/types';
type Extension={account?:Account;version?:string};
type LandingAccount=Pick<Account,'id'>;
const Context=createContext<{config:CustomerConfig;extension:Extension|null;account:LandingAccount|null;checked:boolean;iphone:boolean}>({config:DEFAULT_CONFIG,extension:null,account:null,checked:false,iphone:false});
export function LandingProvider({children}:{children:ReactNode}){
 const router=useRouter();
 const [value,setValue]=useState({config:DEFAULT_CONFIG,extension:null as Extension|null,account:null as LandingAccount|null,checked:false,iphone:false});
 useEffect(()=>{let current=0,disposed=false,pending:Promise<void>|null=null;const check=async()=>{
  const seq=++current;
  const config=await customerConfig();
  if(disposed||seq!==current)return;
  const ids=[...new Set(config.extensionIds)];
  const available=new Map<string,Extension>();
  let remaining=ids.length,account:LandingAccount|null=null,accountChecked=false;
  const publish=()=>{
   if(disposed||seq!==current)return;
   setValue(previous=>{
    const signedIn=accountChecked?account:previous.account;
    const extensions=ids.flatMap(id=>available.has(id)?[available.get(id)!]:[]);
    const detected=extensions.find(item=>signedIn&&item.account?.id===signedIn.id)||extensions[0];
    return {config,extension:detected||(remaining===0?null:previous.extension),account:signedIn,checked:!!detected||remaining===0,iphone:isIphoneBrowser()};
   });
  };
  // Publish each positive response immediately. A silent legacy installation
  // must not delay the current extension or the independent website session.
  const session=fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(8000)})
   .then(r=>r.ok?r.json():null).catch(()=>null).then(me=>{if(disposed||seq!==current)return;account=me?.account||null;accountChecked=true;if(account)router.replace('/dashboard');publish();});
  const extensions=ids.map(id=>extensionMessage<Extension>({kind:'atlas-ping'},id)
   .then(extension=>{available.set(id,extension);},()=>{}).finally(()=>{remaining--;publish();}));
  publish();
  await Promise.all([session,...extensions]);
 };
 // Returning to the tab can fire these three events together. Share the pending
 // check to avoid overlapping session and extension requests.
 const startCheck=()=>{if(!pending)pending=check().finally(()=>{pending=null;});};
 const recheck=()=>{if(document.visibilityState==='hidden')return;let returning=false;try{const t=Number(sessionStorage.getItem('foundkeep-install-return'));returning=t>Date.now()-1800000;sessionStorage.removeItem('foundkeep-install-return');}catch{}startCheck();};
 startCheck();window.addEventListener('focus',recheck);window.addEventListener('pageshow',recheck);document.addEventListener('visibilitychange',recheck);return()=>{disposed=true;current++;window.removeEventListener('focus',recheck);window.removeEventListener('pageshow',recheck);document.removeEventListener('visibilitychange',recheck);};},[]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
const Arrow=()=> <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 12h16m-6-6 6 6-6 6"/></svg>;
export function ExtensionLink({className='text-link',quiet=false}:{className?:string;quiet?:boolean}){const {config,extension,account}=useContext(Context);const connected=!!account&&extension?.account?.id===account.id;const href=extension?connected?'/dashboard':'/dashboard/apps':config.storeUrl;return <a className={className} data-extension-install href={href} target={extension?undefined:'_blank'} rel={extension?undefined:'noopener noreferrer'} onClick={()=>{if(!extension)try{sessionStorage.setItem('foundkeep-install-return',String(Date.now()));}catch{}}}><span data-extension-label>{extension?connected?'Open library':extension.account?'Review connection':'Connect browser':quiet?'Add to Chrome':'Add to Chrome'}</span>{!quiet&&(extension?<Arrow/>:<ExternalIcon/>)}</a>;}
export function ExtensionNote(){const {extension,account,checked}=useContext(Context);return <span className="download-note" role="status">{extension?account&&extension.account?.id===account.id?'Extension installed · Connected to your account.':'Extension installed · Connect your account to sync.':checked?'Chrome Web Store · Version 1.0.0 · Automatic updates':'Checking this browser…'}</span>;}
export function IphoneLink({className='text-link'}:{className?:string}){const {config}=useContext(Context);return <a className={className} data-iphone-install href={config.iphone.url}><span data-iphone-label>{config.iphone.distribution==='private-beta'?'Request iPhone beta':config.iphone.label}</span></a>;}
export function IphoneBadge(){const {config}=useContext(Context);return <span className="beta-badge" data-iphone-badge>{config.iphone.badge}</span>;}
export function IphoneAvailability(){const {config}=useContext(Context);return <span data-iphone-availability>{config.iphone.description}</span>;}
export function HeroActions(){const {config}=useContext(Context);return <div className="hero-action-group"><a className="button button-white" href="/signup">Start collecting<Arrow/></a><div className="hero-platforms" aria-label="Available platforms"><span>Made for your everyday</span><a href={config.storeUrl} target="_blank" rel="noopener noreferrer" aria-label="Get the Chrome extension" title="Chrome extension"><PlatformIcon platform="chrome"/><span>Chrome</span></a><Link href="/beta#ios" aria-label="iPhone beta via TestFlight" title="iPhone · TestFlight beta"><PlatformIcon platform="ios"/><span>iOS <small>beta</small></span></Link><Link href="/beta#android" aria-label="Android beta" title="Android · beta"><PlatformIcon platform="android"/><span>Android <small>beta</small></span></Link></div></div>;}
export function PlatformGrid({children}:{children:ReactNode}){const {iphone}=useContext(Context);const items=Children.toArray(children);if(iphone){const i=items.findIndex(item=>isValidElement<{className?:string}>(item)&&item.props.className?.includes('phone-platform'));if(i>0)items.unshift(...items.splice(i,1));}return <div className="platform-grid">{items}</div>;}
export function LandingHeader(){
 const [open,setOpen]=useState(false);
 const toggle=useRef<HTMLButtonElement>(null),nav=useRef<HTMLElement>(null);
 const {account}=useContext(Context);
 useEffect(()=>{
  if(!open)return;
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);toggle.current?.focus();}};
  const outside=(event:Event)=>{if(event.target instanceof Node&&!nav.current?.contains(event.target)&&!toggle.current?.contains(event.target))setOpen(false);};
  const desktop=matchMedia('(min-width: 541px)');
  const resize=()=>{if(desktop.matches)setOpen(false);};
  document.addEventListener('keydown',key);
  document.addEventListener('pointerdown',outside);
  document.addEventListener('focusin',outside);
  desktop.addEventListener('change',resize);
  return()=>{document.removeEventListener('keydown',key);document.removeEventListener('pointerdown',outside);document.removeEventListener('focusin',outside);desktop.removeEventListener('change',resize);};
 },[open]);
 return <header className="site-header"><Link className="brand" href="/" aria-label="FoundKeep home"><img src="/assets/studio-mark.svg?v=bookmark-evolved-1" width="32" height="32" alt="" aria-hidden="true"/><span>FoundKeep</span></Link><nav className="desktop-nav" aria-label="Primary"><a href="#capture">Features</a><Link href="/collections">Explore</Link><a href="#pricing">Pricing</a></nav><div className="header-actions"><a className="button button-white button-small" href="/signup">Start collecting</a><button className="menu-toggle" ref={toggle} type="button" aria-label={open?'Close navigation':'Open navigation'} aria-expanded={open} aria-controls="mobile-nav" onClick={()=>setOpen(v=>!v)}><svg aria-hidden="true" viewBox="0 0 24 24"><use href="#i-menu"/></svg></button></div><nav ref={nav} id="mobile-nav" className="mobile-nav" aria-label="Mobile navigation" hidden={!open} onClick={()=>setOpen(false)}><a href="#capture">Features</a><Link href="/collections">Explore</Link><a href="#pricing">Pricing</a></nav></header>;
}
export function Reveal({children,className}:{children:ReactNode;className?:string}){
 const [scope,animate]=useAnimate();
 useEffect(()=>{
  const element=scope.current as HTMLElement;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let playback:ReturnType<typeof animate>|undefined;
  const observer=new IntersectionObserver(entries=>{
   if(!reduced.matches&&entries.some(entry=>entry.isIntersecting)){
    playback=animate(element,{opacity:[0.65,1],transform:['translateY(12px)','translateY(0px)']},{duration:0.5,ease:[0.16,1,0.3,1]});
    observer.disconnect();
   }
  },{threshold:0.12});
  const preferenceChanged=()=>{
   if(reduced.matches){observer.disconnect();playback?.stop();element.style.opacity='1';element.style.transform='none';}
  };
  if(!reduced.matches)observer.observe(element);
  reduced.addEventListener('change',preferenceChanged);
  return()=>{observer.disconnect();playback?.stop();reduced.removeEventListener('change',preferenceChanged);};
 },[animate,scope]);
 return <div ref={scope} className={className}>{children}</div>;
}
