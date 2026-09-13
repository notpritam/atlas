import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {parseHTML} from 'linkedom';
import {previewSourceUrl,isPublicPreviewAddress,resolvePublicHost,requestPinned,type PreviewAddress,type PreviewTarget,type PreviewUpstream} from './customer-preview.ts';
export type SourceSnapshot={url:string;requestedUrl:string;fetchedAt:number;contentHash:string;text:string;title:string|null;description:string|null;imageUrl:string|null;author:string|null;publishedAt:string|null;siteName:string|null;platform?:'web'|'youtube'|'instagram'|'x';contentKind?:'article'|'post'|'video'|'image'|'page';extractionStatus?:'readable'|'metadata-only'|'unavailable';transcriptStatus?:'available'|'unavailable'|'not-applicable';notice?:string|null};
const cleaned=(value:unknown,max:number)=>typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,max)||null:null;
const shell=(text:string|null)=>!!text&&text.length<240&&/^(?:(?:please )?(?:sign in|log in|login|enable javascript|enable cookies)|you need to enable javascript|javascript is not available|something went wrong|just a moment|verify (?:you are|you're) human|instagram$|x \/ x$)/i.test(text);
function sourcePlatform(url:string):NonNullable<SourceSnapshot['platform']>{
 const host=new URL(url).hostname.toLowerCase(),isHost=(domain:string)=>host===domain||host.endsWith('.'+domain);
 return isHost('youtube.com')||isHost('youtu.be')?'youtube':isHost('instagram.com')?'instagram':isHost('x.com')||isHost('twitter.com')?'x':'web';
}
/** Platform-only titles identify application shells independently of the description's language.
 * Item-specific JSON-LD still supplies its own evidence when the page head is generic. */
function platformOnlyTitle(title:string|null,platform:NonNullable<SourceSnapshot['platform']>){
 if(!title||platform==='web')return false;
 const label=title.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
 return platform==='youtube'?label==='youtube':platform==='instagram'?label==='instagram':/^(?:x|twitter|xx|xtwitter|twitterx)$/.test(label);
}
function blockedRoute(url:string){
 // Route evidence is language-independent and does not reject ordinary cross-host redirects.
 const path=new URL(url).pathname;
 return /^\/(?:unsupportedbrowser|checkpoint|challenge|login|log-in|signin|sign-in)(?:\.php)?(?:\/|$)/i.test(path)||/^\/(?:accounts\/(?:login|signin)|i\/flow\/login|auth\/(?:login|signin))(?:\/|$)/i.test(path);
}
function structuredContent(document:ReturnType<typeof parseHTML>['document']){
 const entries:Record<string,unknown>[]=[];
 const collect=(value:unknown,depth=0)=>{if(depth>4||entries.length>=200||!value||typeof value!=='object')return;if(Array.isArray(value)){for(const item of value.slice(0,100))collect(item,depth+1);return;}const entry=value as Record<string,unknown>;entries.push(entry);collect(entry['@graph'],depth+1);collect(entry.mainEntity,depth+1);};
 for(const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0,12)){try{const value=(script as {textContent:string|null}).textContent||'';if(value.length<=500_000)collect(JSON.parse(value));}catch{}}
 return entries.find(entry=>[entry['@type']].flat().some(type=>typeof type==='string'&&/^(Article|NewsArticle|BlogPosting|SocialMediaPosting|DiscussionForumPosting|VideoObject|ImageObject)$/.test(type)))||{};
}
export function extractSource(html:string,url:string,requestedUrl=url):Omit<SourceSnapshot,'requestedUrl'|'fetchedAt'|'contentHash'>{
  if(blockedRoute(url)){
   const platform=sourcePlatform(requestedUrl),video=platform==='youtube'||platform==='instagram'&&/^\/(reel|reels|tv)\//.test(new URL(requestedUrl).pathname);
   return {url,text:'',title:null,description:null,imageUrl:null,author:null,publishedAt:null,siteName:null,platform,contentKind:video?'video':platform==='instagram'||platform==='x'?'post':'page',extractionStatus:'unavailable',transcriptStatus:video?'unavailable':'not-applicable',notice:'The source led to a sign-in, verification, or unsupported-browser page. Save the page text with the extension, or add a note.'};
  }
  const {document}=parseHTML(html),data=structuredContent(document);
  const meta=(name:string)=>document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.getAttribute('content');
  const usable=(value:unknown,max:number)=>{const text=cleaned(value,max);return shell(text)?null:text;};
  const platform=sourcePlatform(url);
  const headTitle=cleaned(meta('og:title')||meta('twitter:title')||document.querySelector('title')?.textContent,1000);
  const rawTitle=cleaned(meta('og:title')||meta('twitter:title')||data.headline||data.name||headTitle,1000);
  const genericHead=platformOnlyTitle(headTitle,platform);
  const title=usable(genericHead?data.headline||data.name:rawTitle,1000);
  const dataImage=Array.isArray(data.image)?data.image[0]:data.image;
  const image=meta('og:image')||meta('twitter:image')||cleaned(typeof dataImage==='object'&&dataImage?(dataImage as Record<string,unknown>).url:dataImage,4096);let imageUrl:string|null=null;
  try{imageUrl=image?previewSourceUrl(new URL(image,url).href)?.href||null:null;}catch{}
  // A social caption paired with a valid item preview is evidence even when the title is only the platform.
  // Ordinary site-description metadata alone (including a platform logo) cannot make that distinction.
  const socialDescription=usable(meta('og:description')||meta('twitter:description'),2000);
  const description=usable(genericHead?data.description||imageUrl&&socialDescription:meta('og:description')||meta('twitter:description')||meta('description')||data.description,2000);
  const dataAuthor=Array.isArray(data.author)?data.author[0]:data.author;
  const author=cleaned(meta('author')||meta('article:author')||(typeof dataAuthor==='object'&&dataAuthor?(dataAuthor as Record<string,unknown>).name:dataAuthor),200),publishedAt=cleaned(meta('article:published_time')||data.datePublished||data.uploadDate,100),siteName=cleaned(meta('og:site_name'),200);
  const types=[data['@type']].flat(),video=platform==='youtube'||platform==='instagram'&&/^\/(reel|reels|tv)\//.test(new URL(url).pathname)||types.includes('VideoObject')||meta('og:type')?.startsWith('video');
  const transcript=usable(data.transcript,100_000),article=usable(data.articleBody||data.text,100_000);
  const contentKind:NonNullable<SourceSnapshot['contentKind']>=video?'video':types.includes('ImageObject')?'image':platform==='x'||platform==='instagram'?'post':types.some(type=>typeof type==='string'&&/Article|BlogPosting/.test(type))||document.querySelector('article')?'article':'page';
  document.querySelectorAll('script,style,nav,footer,header,aside,noscript,iframe,form,svg,[aria-hidden="true"]').forEach((node:{remove():void})=>node.remove());
  const root=document.querySelector('article')||document.querySelector('main')||document.querySelector('body')||document.documentElement;
  const paragraphs=Array.from(root?.querySelectorAll('h1,h2,h3,p,li,blockquote,pre')||[]).slice(0,200).map(node=>usable((node as {textContent:string|null}).textContent,5000)).filter((value):value is string=>!!value&&value!==title);
  // Social pages often expose a login/application shell. Only their explicit post data is treated as full text.
  const fallback=usable(root?.textContent,100_000);
  const body=platform==='web'?(paragraphs.length?[...new Set(paragraphs)].join('\n\n'):fallback!==title?fallback||'':''):'';
  const readable=transcript||article||body;
  const text=(readable||description||'').slice(0,100_000),extractionStatus=readable?'readable':description||title?'metadata-only':'unavailable';
  const transcriptStatus=video?(transcript?'available':'unavailable'):'not-applicable';
  const notice=extractionStatus==='unavailable'?'This page did not expose readable public content. Save the text from the page with the extension, or add a note.':video&&!transcript?'Video metadata is available, but no transcript was exposed by this page.':extractionStatus==='metadata-only'?'Only the public preview was available. The full post or article was not exposed by this page.':null;
  return {url,text,title,description,imageUrl,author,publishedAt,siteName,platform,contentKind,extractionStatus,transcriptStatus,notice};
}
export function createSourceFetcher(options:{resolve?:(host:string,signal:AbortSignal)=>Promise<PreviewAddress[]>;transport?:(target:PreviewTarget,signal:AbortSignal,accept?:string)=>Promise<PreviewUpstream>}={}){
 return async(raw:string):Promise<SourceSnapshot>=>{
  let url=previewSourceUrl(raw);if(!url)throw new Error('This source is not a public web page.');
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;let current:PreviewUpstream|undefined;
  const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('The source took too long to respond.'));},12_000);});
  try{
   for(let hop=0;hop<4;hop++){
    const host=url.hostname.replace(/^\[|\]$/g,'');const family=isIP(host);
    const addresses:PreviewAddress[]=family?[{address:host,family:family as 4|6}]:await Promise.race([(options.resolve||resolvePublicHost)(host,controller.signal),timeout]);
    if(!addresses.length||addresses.some(item=>!isPublicPreviewAddress(item.address)))throw new Error('This source is not a public web page.');
    current=await Promise.race([(options.transport||requestPinned)({...addresses[0]!,url},controller.signal,'text/html,application/xhtml+xml'),timeout]);
    if([301,302,303,307,308].includes(current.status)){
      const next=current.headers.get('location');current.cancel();if(!next)throw new Error('The source redirected without a destination.');url=previewSourceUrl(new URL(next,url).href);if(!url)throw new Error('The source redirected to an unsupported address.');continue;
    }
    if(current.status!==200||!/^text\/html|^application\/xhtml\+xml/.test(current.headers.get('content-type')||'')||!['identity',''].includes(current.headers.get('content-encoding')||''))throw new Error('This source does not expose a readable public page.');
    if(Number(current.headers.get('content-length')||0)>2*1024*1024)throw new Error('This source is too large to process.');
    const chunks:Uint8Array[]=[];let bytes=0;const iterator=current.body[Symbol.asyncIterator]();
    while(true){const item=await Promise.race([iterator.next(),timeout]);if(item.done)break;bytes+=item.value.byteLength;if(bytes>2*1024*1024)throw new Error('This source is too large to process.');chunks.push(item.value);}
    const body=Buffer.concat(chunks);return {...extractSource(body.toString('utf8'),url.href,raw),requestedUrl:raw,fetchedAt:Date.now(),contentHash:createHash('sha256').update(body).digest('hex')};
   }
   throw new Error('The source redirected too many times.');
  }finally{clearTimeout(timer);controller.abort();current?.cancel();}
 };
}
export const fetchCustomerSource=createSourceFetcher();
