import {downloadCustomerRemoteMedia,type RemoteMediaOptions,type RemoteMediaResult} from './customer-remote-media.ts';
import {writeCustomerFile,removeCustomerFile,safeFileName,type StoredCustomerFile} from './customer-files.ts';
import type {SourceSnapshot} from './customer-source.ts';
export type RemoteDownloader=(url:string,options:RemoteMediaOptions)=>Promise<RemoteMediaResult>;
const notices={
 downloaded:'A video copy is preserved. Only the supplied text, subtitles or consented preview can be used for organization.',
 unavailable:'A public video copy was unavailable. No video was downloaded.',
 unsupported:'This source or video format is not supported. No video was downloaded.',
 too_large:'The video exceeds the download limit. No video was downloaded.',
 cancelled:'The video download was cancelled. No video was downloaded.',
 timeout:'The video download reached its time limit. No video was downloaded.',
 error:'The video could not be safely downloaded. No video was downloaded.',
};
export type DownloadEvidence={status:RemoteMediaResult['status'];sourceUrl:string;notice:string;transcriptStatus:'available'|'unavailable';bytes?:number;mime?:string;sha256?:string;durationSeconds?:number};
export type Preservation={evidence:DownloadEvidence;file?:StoredCustomerFile;fileName?:string;text?:string};
export function remoteVideoCandidate(url:string,snapshot:SourceSnapshot|null):boolean{
 try{
  const u=new URL(url),host=u.hostname.toLowerCase(),is=(domain:string)=>host===domain||host.endsWith('.'+domain);
  if(!['https:','http:'].includes(u.protocol))return false;
  return snapshot?.contentKind==='video'||/\.mp4$/i.test(u.pathname)||is('youtu.be')&&u.pathname.length>1||is('youtube.com')&&(/^\/(?:shorts|embed|live)\//.test(u.pathname)||u.pathname==='/watch'&&u.searchParams.has('v'))||is('instagram.com')&&/^\/(?:p|reel|reels|tv)\//.test(u.pathname)||(is('x.com')||is('twitter.com'))&&/^\/(?:[^/]+\/status\/\d+|i\/web\/status\/\d+)/.test(u.pathname);
 }catch{return false;}
}
/** Owns extractor temp files until disposal and transfers only validated bytes to staging. */
export async function preserveRemoteVideo(url:string,root:string,signal:AbortSignal,download:RemoteDownloader=downloadCustomerRemoteMedia):Promise<Preservation>{
 const remote=await download(url,{signal,deadlineMs:120_000});
 const evidence:DownloadEvidence={status:remote.status,sourceUrl:url,notice:notices[remote.status],transcriptStatus:'unavailable'};
 if(remote.status!=='downloaded')return {evidence};
 let file:StoredCustomerFile|undefined;
 try{
  signal.throwIfAborted();
  file=await writeCustomerFile(new Request('http://localhost/preserved-video',{method:'POST',headers:{'content-type':remote.mime,'content-length':String(remote.bytes)},body:Bun.file(remote.absolutePath).stream()}),{root,namespace:"remote"});
  signal.throwIfAborted();
  if(file.bytes!==remote.bytes||file.mime!==remote.mime||file.sha256!==remote.sha256)throw new Error('The downloaded video changed before preservation.');
  const subtitles=remote.subtitles.filter(subtitle=>subtitle.text.trim());
  return {file,fileName:safeFileName((remote.title||'Saved video')+'.mp4'),evidence:{...evidence,bytes:file.bytes,mime:file.mime,sha256:file.sha256,durationSeconds:remote.durationSeconds,transcriptStatus:subtitles.length?'available':'unavailable'},text:[remote.description?`Source description (not a transcript):\n${remote.description}`:'',...subtitles.map(subtitle=>`Supplied ${subtitle.automatic?'automatic ':''}subtitles (${subtitle.language}):\n${subtitle.text}`)].filter(Boolean).join('\n\n')};
 }catch(error){if(file)removeCustomerFile(root,file.relativePath);throw error;}
 finally{try{await remote.dispose();}catch(error){if(file)removeCustomerFile(root,file.relativePath);throw error;}}
}
