'use client';
import Link from 'next/link';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useEffect,useRef} from 'react';
import {Spinner} from './loading';
import {useDashboard} from './context';
import {captureTitle,type Capture} from '../../lib/dashboard';
type Download={status:string;sourceUrl:string;notice:string;transcriptStatus:'available'|'unavailable';bytes?:number;mime?:string;sha256?:string;durationSeconds?:number};
type Job={id:string;status:string;error:string|null;updatedAt:number};
type Processing={derivatives?:{kind:'preview'|'compact';mime:string;bytes:number}[];model:string;processedAt:number;source:{url:string;requestedUrl:string;fetchedAt:number;text:string;contentHash:string;notice?:string|null;extractionStatus?:string;transcriptStatus?:string}|null;result:{download?:Download|null;sourceError?:string|null;mediaNote?:string|null;extractedText?:string|null}};
export function ProcessingDetails({id}:{id:string}){
 const {me,request,toast}=useDashboard(),cache=useQueryClient();
 const openedAt=useRef(Date.now());
 const settings=useQuery({queryKey:['automation',me.account.id],queryFn:({signal})=>request<{enabled:boolean;available:boolean;pro:boolean;canProcess?:boolean}>('/automation',{signal}),staleTime:30_000});
 const details=useQuery({queryKey:['processing',me.account.id,id],queryFn:({signal})=>request<{processing:Processing|null;job:Job|null}>('/captures/'+encodeURIComponent(id)+'/processing',{signal}),refetchInterval:query=>{
  const elapsed=Date.now()-openedAt.current,job=query.state.data?.job;
  // Briefly discover jobs created by the worker after this reader opens; bound active polling too.
  return elapsed<30*60_000&&(job?['pending','running'].includes(job.status):elapsed<30_000&&!!settings.data?.enabled&&!!settings.data.available)?5000:false;
 },refetchIntervalInBackground:false});
 const job=details.data?.job;
 useEffect(()=>{
  if(!job||['pending','running'].includes(job.status))return;
  for(const key of [['capture',me.account.id,id],['related',me.account.id,id],['captures',me.account.id],['automation',me.account.id]])void cache.invalidateQueries({queryKey:key});
 },[cache,id,me.account.id,job?.id,job?.status,job?.updatedAt]);
 const related=useQuery({queryKey:['related',me.account.id,id],queryFn:({signal})=>request<{items:{capture:Capture;reasons:{label:string}[]}[]}>('/captures/'+encodeURIComponent(id)+'/related',{signal})});
 const process=useMutation({mutationFn:()=>request('/captures/'+encodeURIComponent(id)+'/process',{method:'POST',body:{}}),onSuccess:()=>{openedAt.current=Date.now();void details.refetch();toast('Queued for processing. This saved item will update when it finishes.');}});
 const result=details.data?.processing;
 const download=result?.result.download;
 return <>
  {settings.data?.enabled&&settings.data.available&&(settings.data.canProcess??settings.data.pro)?<section className="detail-section"><button className="button secondary compact" disabled={process.isPending} onClick={()=>process.mutate()}>{process.isPending?<><Spinner/>Queueing…</>:'Organize with FoundKeep'}</button>{process.error?<p role="alert">{process.error.message}</p>:null}</section>:null}
  {job&&['pending','running'].includes(job.status)?<p className="field-help" role="status">Processing this save… The saved copy and details will appear here when ready.</p>:job?.error?<p className="field-help" role="status">{job.error}</p>:job?.status==='paused'?<p className="field-help" role="status">Processing is paused. Resume it in your processing settings.</p>:null}
  {result?<details className="detail-origin"><summary>Processing &amp; preserved source</summary><p className="field-help">Processed {new Date(result.processedAt).toLocaleString()} · {result.model}</p>{download?<section><p>{download.notice}</p><a href={download.sourceUrl} target="_blank" rel="noopener noreferrer">Open original video source ↗</a>{download.status==='downloaded'?<><p className="field-help">Saved {(Number(download.bytes)/1024/1024).toFixed(1)} MB · {download.mime} · {Math.round(download.durationSeconds||0)} seconds. {download.transcriptStatus==='available'?'Supplied subtitles are included below.':'No subtitles were supplied; this is not a transcript.'}</p><p className="field-help" style={{overflowWrap:'anywhere'}}>File fingerprint: {download.sha256}</p></>:null}</section>:null}{result.result.sourceError?<p>{result.result.sourceError}</p>:null}{result.result.mediaNote?<p>{result.result.mediaNote}</p>:null}{result.source?<>{result.source.notice?<p className="field-help">{result.source.notice}</p>:null}<a href={result.source.url} target="_blank" rel="noopener noreferrer">Open processed source ↗</a><p className="field-help">Fetched {new Date(result.source.fetchedAt).toLocaleString()}</p><p style={{whiteSpace:'pre-wrap'}}>{result.source.text}</p><p className="field-help" style={{overflowWrap:'anywhere'}}>Source fingerprint: {result.source.contentHash}</p></>:null}{result.derivatives?.filter(file=>file.kind==='compact').map(file=><p key={file.kind}><a href={'/api/captures/'+encodeURIComponent(id)+'/derivatives/compact'} download>Download smaller video · {(file.bytes/1024/1024).toFixed(1)} MB</a></p>)}{result.result.extractedText?<p style={{whiteSpace:'pre-wrap'}}>{result.result.extractedText}</p>:null}</details>:null}
  {related.data?.items.length?<section className="detail-section"><h3>Connected saves</h3><ul className="service-list">{related.data.items.map(item=><li key={item.capture.id}><Link href={'/dashboard?item='+encodeURIComponent(item.capture.id)}>{captureTitle(item.capture)}</Link><span>{item.reasons.map(reason=>reason.label).join(' · ')}</span></li>)}</ul></section>:null}
 </>;
}
