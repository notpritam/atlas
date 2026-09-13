'use client';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useDashboard} from './context';
import Link from 'next/link';
import {SectionLoading,Spinner} from './loading';
import './processing-controls.css';

type Plan={pro:boolean};
type Automation={available:boolean;enabled:boolean;fetchLinks:boolean;images:boolean;consentVersion:string;mode:'instant'|'scheduled'|'manual'|'paused';intervalHours:number;monthlyLimit:number;nextRunAt:number|null;usage:{used:number;reserved:number;limit:number};activity:{id:string;captureId:string;status:string;error:string|null}[]};
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
  if(!settings.enabled&&!await confirm('Let FoundKeep organize your saves?','Selected saved text, titles and source URLs will be sent to OpenAI. Your original files and personal organization stay yours. You can turn this off anytime.','Enable processing'))return;
  action.mutate({kind:'automation',value:{enabled:!settings.enabled,consentVersion:settings.consentVersion}});
 };
 return <div className="collection-services" aria-busy={busy}>
  <section className="settings-section"><h3>Let your collection organize itself.</h3><p className="muted">Foundkeep can suggest tags, summarize content and connect related saves. Choose when new saves are processed and how much of your allowance to use. Older items wait until you request processing.</p>
   {plan.data && !plan.data.pro ? <p className="processing-plan-note">Managed processing is included with Pro. <Link className="text-link" href="/dashboard/plans">Explore plans</Link></p> : null}
   {plan.isError ? <p className="form-message is-error" role="alert">{plan.error.message} <button className="subtle-button" onClick={()=>void plan.refetch()}>Retry plan</button></p> : null}
   {busy&&action.variables?.kind==='automation'?<p className="loading-caption" role="status"><Spinner/>Saving processing settings…</p>:null}
   {settings?<><label className="preference-toggle"><span><strong>Managed processing</strong><small>{settings.available?'Uses OpenAI with your permission':'Provider setup is still in progress'}</small></span><input type="checkbox" checked={settings.enabled} disabled={busy||(!settings.enabled&&(!settings.available||!plan.data?.pro))} onChange={()=>void enable()}/></label>
    <label className="preference-toggle"><span><strong>Read public link contents</strong><small>Fetch accessible articles and post metadata. Sign-in walls stay respected.</small></span><input type="checkbox" checked={settings.fetchLinks} disabled={busy||!settings.enabled} onChange={event=>action.mutate({kind:'automation',value:{fetchLinks:event.target.checked}})}/></label>
    <label className="preference-toggle"><span><strong>Understand images</strong><small>Send a bounded image or video preview to OpenAI for tagging.</small></span><input type="checkbox" checked={settings.images} disabled={busy||!settings.enabled} onChange={async event=>{const checked=event.target.checked;if(checked&&!await confirm('Include images in processing?','Saved images and video previews may be sent to OpenAI to understand their contents.','Allow images'))return;action.mutate({kind:'automation',value:{images:checked}});}}/></label>
    <fieldset className="processing-timing" disabled={busy||!settings.enabled}><legend>When should processing run?</legend><div className="processing-mode-grid">{([
     ['instant','As I save','Organize each new save when it arrives.'],['scheduled','On a schedule','Collect new saves and process them in batches.'],['manual','Only when I ask','Use Process in a saved item or ask your agent.'],['paused','Pause processing','Keep saving. No processing credits will be used.'],
    ] as const).map(([mode,label,description])=><label key={mode} className={settings.mode===mode?'is-selected':''}><input type="radio" name="processing-mode" value={mode} checked={settings.mode===mode} onChange={()=>action.mutate({kind:'automation',value:{mode}})}/><span><strong>{label}</strong><small>{description}</small></span></label>)}</div>
     {settings.mode==='scheduled'?<div className="processing-schedule"><label htmlFor="processing-interval">Run every</label><select id="processing-interval" value={settings.intervalHours} onChange={event=>action.mutate({kind:'automation',value:{intervalHours:Number(event.target.value)}})}><option value={1}>1 hour</option><option value={6}>6 hours</option><option value={24}>24 hours</option></select>{settings.nextRunAt?<p className="field-help">Next batch: {new Date(settings.nextRunAt).toLocaleString()}. Explicit processing requests can still run now.</p>:null}</div>:settings.mode==='paused'?<p className="field-help" role="status">Queued work is held and reserved credits are released. Choose a timing option to resume.</p>:null}
    </fieldset>
    <form className="processing-budget" key={settings.monthlyLimit} onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);action.mutate({kind:'automation',value:{monthlyLimit:Number(form.get('monthlyLimit'))}});}}><label htmlFor="processing-budget"><strong>Your monthly credit cap</strong><span>Set a cap below your included allowance. Use 0 to stop spending until you raise it.</span></label><div><input id="processing-budget" name="monthlyLimit" aria-label="Monthly processing credit cap" type="number" min={0} max={settings.usage.limit} step={1} required defaultValue={settings.monthlyLimit} disabled={busy||!settings.enabled}/><span>of {settings.usage.limit}</span><button type="submit" className="button secondary" disabled={busy||!settings.enabled}>Save cap</button></div></form>
    <p className="field-help">{settings.usage.used} used · {settings.usage.reserved} queued · {settings.usage.limit} credits this month. Failed or cancelled jobs do not use a credit.</p>
    {settings.activity.length?<details className="service-details"><summary>Recent processing</summary><ul className="service-list">{settings.activity.slice(0,6).map(job=><li key={job.id}><a href={'/dashboard/saved/'+encodeURIComponent(job.captureId)}>Open saved item</a><span>{job.status}{job.error?' · '+job.error:''}</span></li>)}</ul></details>:null}</>:automation.isPending?<SectionLoading label="Loading processing preferences…"/>:<p className="muted" role={automation.isError?'alert':'status'}>{automation.error?.message||'Loading processing preferences…'}{automation.isError?<button className="subtle-button" onClick={()=>void automation.refetch()}>Try again</button>:null}</p>}
  </section>
  {action.error?<p className="form-message is-error" role="alert">{action.error.message}</p>:null}
 </div>;
}
