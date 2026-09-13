'use client';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useDashboard} from './context';
import Link from 'next/link';
import {SectionLoading,Spinner} from './loading';

type Plan={pro:boolean};
type Automation={available:boolean;enabled:boolean;fetchLinks:boolean;images:boolean;consentVersion:string;usage:{used:number;reserved:number;limit:number};activity:{id:string;captureId:string;status:string;error:string|null}[]};
export function CollectionServices(){
 const {me,request,confirm}=useDashboard(),cache=useQueryClient();const account=me.account.id;
 const plan=useQuery({queryKey:['plan',account],queryFn:({signal})=>request<Plan>('/plan',{signal})});
 const automation=useQuery({queryKey:['automation',account],queryFn:({signal})=>request<Automation>('/automation',{signal}),refetchInterval:30_000});
 const action=useMutation({mutationFn:async({value}:{kind:'automation';value:unknown})=>{
  await request('/automation',{method:'PUT',body:value});
  await Promise.all(['plan','automation'].map(key=>cache.invalidateQueries({queryKey:[key,account]})));
 }});
 const busy=action.isPending,settings=automation.data;
 const enable=async()=>{
  if(!settings)return;
  if(!settings.enabled&&!await confirm('Let Foundkeep organize your saves?','Selected saved text, titles and source URLs will be sent to OpenAI. Your original files and personal organization stay yours. You can turn this off anytime.','Enable processing'))return;
  action.mutate({kind:'automation',value:{enabled:!settings.enabled,consentVersion:settings.consentVersion}});
 };
 return <div className="collection-services" aria-busy={busy}>
  <section className="settings-section"><h3>Let your collection organize itself.</h3><p className="muted">Foundkeep can suggest tags, summarize content and connect related saves. New saves are processed after you enable it; you choose when to process older items.</p>
   {plan.data && !plan.data.pro ? <p className="processing-plan-note">Managed processing is included with Pro. <Link className="text-link" href="/dashboard/plans">Explore plans</Link></p> : null}
   {plan.isError ? <p className="form-message is-error" role="alert">{plan.error.message} <button className="subtle-button" onClick={()=>void plan.refetch()}>Retry plan</button></p> : null}
   {busy&&action.variables?.kind==='automation'?<p className="loading-caption" role="status"><Spinner/>Saving processing settings…</p>:null}
   {settings?<><label className="preference-toggle"><span><strong>Managed processing</strong><small>{settings.available?'Uses OpenAI with your permission':'Provider setup is still in progress'}</small></span><input type="checkbox" checked={settings.enabled} disabled={busy||!settings.available||(!settings.enabled&&!plan.data?.pro)} onChange={()=>void enable()}/></label>
    <label className="preference-toggle"><span><strong>Read public link contents</strong><small>Fetch accessible articles and post metadata. Sign-in walls stay respected.</small></span><input type="checkbox" checked={settings.fetchLinks} disabled={busy||!settings.enabled} onChange={event=>action.mutate({kind:'automation',value:{fetchLinks:event.target.checked}})}/></label>
    <label className="preference-toggle"><span><strong>Understand images</strong><small>Send a bounded image or video preview to OpenAI for tagging.</small></span><input type="checkbox" checked={settings.images} disabled={busy||!settings.enabled} onChange={async event=>{const checked=event.target.checked;if(checked&&!await confirm('Include images in processing?','Saved images and video previews may be sent to OpenAI to understand their contents.','Allow images'))return;action.mutate({kind:'automation',value:{images:checked}});}}/></label>
    <p className="field-help">{settings.usage.used} used · {settings.usage.reserved} queued · {settings.usage.limit} credits this month. Failed or cancelled jobs do not use a credit.</p>
    {settings.activity.length?<details className="service-details"><summary>Recent processing</summary><ul className="service-list">{settings.activity.slice(0,6).map(job=><li key={job.id}><a href={'/dashboard/saved/'+encodeURIComponent(job.captureId)}>Open saved item</a><span>{job.status}{job.error?' · '+job.error:''}</span></li>)}</ul></details>:null}</>:automation.isPending?<SectionLoading label="Loading processing preferences…"/>:<p className="muted" role={automation.isError?'alert':'status'}>{automation.error?.message||'Loading processing preferences…'}{automation.isError?<button className="subtle-button" onClick={()=>void automation.refetch()}>Try again</button>:null}</p>}
  </section>
  {action.error?<p className="form-message is-error" role="alert">{action.error.message}</p>:null}
 </div>;
}
