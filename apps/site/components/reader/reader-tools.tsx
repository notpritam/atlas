export function sourceLink(value:string|null|undefined):URL|null {
 if(!value)return null;
 try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url:null;}catch{return null;}
}
export function ReaderIcon({kind}:{kind:'back'|'close'|'source'|'expand'}) {
 return <svg viewBox="0 0 24 24" aria-hidden="true">{kind==='back'?<path d="m10 5-7 7 7 7M3 12h18"/>:kind==='close'?<path d="m6 6 12 12M6 18 18 6"/>:kind==='expand'?<path d="M14 3h7v7m0-7-7 7M10 21H3v-7m0 7 7-7"/>:<><path d="M14 3h7v7m0-7L10 14"/><path d="M10 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5"/></>}</svg>;
}
