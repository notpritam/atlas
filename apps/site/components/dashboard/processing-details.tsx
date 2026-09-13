'use client';
import Link from 'next/link';
import {useMutation,useQuery} from '@tanstack/react-query';
import {Spinner} from './loading';
import {useDashboard} from './context';
import {captureTitle,type Capture} from '../../lib/dashboard';
type Processing={derivatives?:{kind:'preview'|'compact';mime:string;bytes:number}[];model:string;processedAt:number;source:{url:string;requestedUrl:string;fetchedAt:number;text:string;contentHash:string}|null;result:{sourceError?:string|null;mediaNote?:string|null;extractedText?:string|null}};
export function ProcessingDetails({id}:{id:string}){
 const {me,request,toast}=useDashboard();
 const settings=useQuery({queryKey:['automation',me.account.id],queryFn:({signal})=>request<{enabled:boolean;available:boolean;pro:boolean}>('/automation',{signal}),staleTime:30_000});
 const details=useQuery({queryKey:['processing',me.account.id,id],queryFn:({signal})=>request<{processing:Processing|null}>('/captures/'+encodeURIComponent(id)+'/processing',{signal})});
 const related=useQuery({queryKey:['related',me.account.id,id],queryFn:({signal})=>request<{items:{capture:Capture;reasons:{label:string}[]}[]}>('/captures/'+encodeURIComponent(id)+'/related',{signal})});
 const process=useMutation({mutationFn:()=>request('/captures/'+encodeURIComponent(id)+'/process',{method:'POST',body:{}}),onSuccess:()=>toast('Queued for processing. Follow progress in your account settings.')});
 const result=details.data?.processing;
 return <>
  {settings.data?.enabled&&settings.data.available&&settings.data.pro?<section className="detail-section"><button className="button secondary compact" disabled={process.isPending} onClick={()=>process.mutate()}>{process.isPending?<><Spinner/>Queueing…</>:'Organize with Foundkeep'}</button>{process.error?<p role="alert">{process.error.message}</p>:null}</section>:null}
  {result?<details className="detail-origin"><summary>Processing &amp; preserved source</summary><p className="field-help">Processed {new Date(result.processedAt).toLocaleString()} · {result.model}</p>{result.result.sourceError?<p>{result.result.sourceError}</p>:null}{result.result.mediaNote?<p>{result.result.mediaNote}</p>:null}{result.source?<><a href={result.source.url} target="_blank" rel="noopener noreferrer">Open processed source ↗</a><p className="field-help">Fetched {new Date(result.source.fetchedAt).toLocaleString()}</p><p style={{whiteSpace:'pre-wrap'}}>{result.source.text}</p><p className="field-help" style={{overflowWrap:'anywhere'}}>Source fingerprint: {result.source.contentHash}</p></>:null}{result.derivatives?.filter(file=>file.kind==='compact').map(file=><p key={file.kind}><a href={'/api/captures/'+encodeURIComponent(id)+'/derivatives/compact'} download>Download smaller video · {(file.bytes/1024/1024).toFixed(1)} MB</a></p>)}{result.result.extractedText?<p style={{whiteSpace:'pre-wrap'}}>{result.result.extractedText}</p>:null}</details>:null}
  {related.data?.items.length?<section className="detail-section"><h3>Connected saves</h3><ul className="service-list">{related.data.items.map(item=><li key={item.capture.id}><Link href={'/dashboard?item='+encodeURIComponent(item.capture.id)}>{captureTitle(item.capture)}</Link><span>{item.reasons.map(reason=>reason.label).join(' · ')}</span></li>)}</ul></section>:null}
 </>;
}
