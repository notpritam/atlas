'use client';
import {useEffect,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useDashboard} from './context';

type Plan={pro:boolean;subscriptions:{provider:string;active:boolean;renews:boolean;expiresAt:number}[];billing:{stripe:{available:boolean;canManage:boolean};paddle:{available:boolean;canManage:boolean}}};
type Automation={available:boolean;enabled:boolean;fetchLinks:boolean;images:boolean;consentVersion:string;usage:{used:number;reserved:number;limit:number};activity:{id:string;captureId:string;status:string;error:string|null}[]};
type Agent={id:string;name:string;scopes:string[];expiresAt:number;lastSeenAt:number|null};
type Connections={agents:Agent[];nudges:{id:string;text:string;status:string}[]};
export function CollectionServices(){
 const {me,request,confirm,toast}=useDashboard(),cache=useQueryClient();const account=me.account.id;
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const [name,setName]=useState('My agent'),[write,setWrite]=useState(false),[files,setFiles]=useState(false),[secret,setSecret]=useState(''),[nudge,setNudge]=useState('');
 const plan=useQuery({queryKey:['plan',account],queryFn:({signal})=>request<Plan>('/plan',{signal})});
 const automation=useQuery({queryKey:['automation',account],queryFn:({signal})=>request<Automation>('/automation',{signal}),refetchInterval:30_000});
 const agents=useQuery({queryKey:['agents',account],queryFn:({signal})=>request<Connections>('/agents',{signal})});
 const update=()=>Promise.all(['plan','automation','agents'].map(key=>cache.invalidateQueries({queryKey:[key,account]})));
 const action=useMutation({mutationFn:async({kind,id,value}:{kind:string;id?:string;value?:unknown})=>{
  if(kind==='checkout'||kind==='portal'){
   const result=await request<{url:string}>('/billing/'+kind,{method:'POST',body:{}});
   if(!alive.current)return;
   const dest=new URL(result.url,window.location.origin);
   if(dest.origin!==window.location.origin&&!/(^|\.)paddle\.com$/.test(dest.hostname))throw new Error('The payment destination is unavailable.');
   window.location.assign(dest.href);return;
  }
  if(kind==='sync'){await request('/billing/paddle/sync',{method:'POST',body:{}});await update();return;}
  if(kind==='automation'){await request('/automation',{method:'PUT',body:value});await update();return;}
  if(kind==='create'){
   const result=await request<{token:string}>('/agents',{method:'POST',body:{name,days:90,scopes:['library:read',...(files?['files:read']:[]),...(write?['library:write']:[])]}});
   if(alive.current)setSecret(result.token);await update();return;
  }
  if(kind==='revoke'){await request('/agents/'+encodeURIComponent(id!),{method:'DELETE'});await update();return;}
  if(kind==='nudge'){await request('/agents/nudges',{method:'POST',body:{text:nudge}});if(alive.current)setNudge('');await update();toast('Instruction saved for your connected agent.');}
 }});
 const busy=action.isPending,settings=automation.data;
 const config=secret?JSON.stringify({mcpServers:{foundkeep:{type:'http',url:'https://foundkeep.app/api/mcp',headers:{Authorization:'Bearer '+secret}}}},null,2):'';
 const enable=async()=>{
  if(!settings)return;
  if(!settings.enabled&&!await confirm('Let Foundkeep organize your saves?','Selected saved text, titles and source URLs will be sent to OpenAI. Your original files and personal organization stay yours. You can turn this off anytime.','Enable processing'))return;
  action.mutate({kind:'automation',value:{enabled:!settings.enabled,consentVersion:settings.consentVersion}});
 };
 return <div className="collection-services">
  <section className="settings-section plan-section"><div className="service-heading"><div><span className="service-kicker">YOUR PLAN</span><h3>{plan.data?.pro?'Foundkeep Pro':'A collection, freely yours.'}</h3></div><span className="plan-pill">{plan.data?.pro?'PRO':'FREE'}</span></div>
   <p className="muted">Free includes saving, bookmark imports, folders, tags, and your own connected agent.</p>
   <p className="muted">Pro adds 500 managed processing credits each month and 2 GB of storage. USD $5 / month on the web. Cancel anytime.</p>
   <div className="service-actions">{!plan.data?.pro && plan.data?.billing.paddle.canManage ? <button className="button secondary compact" disabled={busy} onClick={()=>action.mutate({kind:'portal'})}>Manage subscription</button> : null}{plan.data?.pro?<>{plan.data.subscriptions.some(s=>s.provider==='paddle')||plan.data?.billing.paddle.canManage?<button className="button secondary compact" disabled={busy} onClick={()=>action.mutate({kind:'portal'})}>Manage subscription</button>:plan.data.subscriptions.some(s=>s.provider==='revenuecat')?<a className="text-link" href="https://apps.apple.com/account/subscriptions" target="_blank" rel="noopener noreferrer">Manage in your Apple Account ↗</a>:null}</>:<button className="button primary compact" disabled={busy||!plan.data?.billing.paddle.available||!settings?.available} onClick={()=>action.mutate({kind:'checkout'})}>{plan.data?.billing.paddle.available&&settings?.available?'Get Pro · $5/month':'Pro checkout coming soon'}</button>}
    {plan.data?.billing.paddle.available?<button className="subtle-button" disabled={busy} onClick={()=>action.mutate({kind:'sync'})}>Refresh plan</button>:null}</div>
   <p className="field-help">App Store purchases use local pricing. Pro follows your Foundkeep account across all devices.</p>
   {plan.error?<p role="alert">{plan.error.message}</p>:null}
  </section>
  <section className="settings-section"><h3>Let your collection organize itself.</h3><p className="muted">Foundkeep can suggest tags, summarize content and connect related saves. New saves are processed after you enable it; you choose when to process older items.</p>
   {settings?<><label className="preference-toggle"><span><strong>Managed processing</strong><small>{settings.available?'Uses OpenAI with your permission':'Provider setup is still in progress'}</small></span><input type="checkbox" checked={settings.enabled} disabled={busy||!settings.available||(!settings.enabled&&!plan.data?.pro)} onChange={()=>void enable()}/></label>
    <label className="preference-toggle"><span><strong>Read public link contents</strong><small>Fetch accessible articles and post metadata. Sign-in walls stay respected.</small></span><input type="checkbox" checked={settings.fetchLinks} disabled={busy||!settings.enabled} onChange={event=>action.mutate({kind:'automation',value:{fetchLinks:event.target.checked}})}/></label>
    <label className="preference-toggle"><span><strong>Understand images</strong><small>Send a bounded image or video preview to OpenAI for tagging.</small></span><input type="checkbox" checked={settings.images} disabled={busy||!settings.enabled} onChange={async event=>{const checked=event.target.checked;if(checked&&!await confirm('Include images in processing?','Saved images and video previews may be sent to OpenAI to understand their contents.','Allow images'))return;action.mutate({kind:'automation',value:{images:checked}});}}/></label>
    <p className="field-help">{settings.usage.used} used · {settings.usage.reserved} queued · {settings.usage.limit} credits this month. Failed or cancelled jobs do not use a credit.</p>
    {settings.activity.length?<details className="service-details"><summary>Recent processing</summary><ul className="service-list">{settings.activity.slice(0,6).map(job=><li key={job.id}><a href={'/dashboard/saved/'+encodeURIComponent(job.captureId)}>Open saved item</a><span>{job.status}{job.error?' · '+job.error:''}</span></li>)}</ul></details>:null}</>:<p className="muted">{automation.error?.message||'Loading processing preferences…'}</p>}
  </section>
  <section className="settings-section"><h3>Your agent. Your collection.</h3><p className="muted">Connect an MCP client to work with your library. Available on Free and Pro. The agent you connect controls its model, schedule, and any costs.</p>
   <details className="service-details"><summary>Connect an agent</summary><form className="service-form" onSubmit={event=>{event.preventDefault();if(!busy&&!secret)action.mutate({kind:'create'});}}>
    <label className="field">Connection name<input value={name} maxLength={60} required onChange={event=>setName(event.target.value)}/></label>
    <p className="field-help">Read access includes saved text, source information, tags and folders. Grant access only to an agent you trust. Connections expire after 90 days.</p>
    <label className="check-field"><input type="checkbox" checked={files} onChange={event=>setFiles(event.target.checked)}/><span>Allow reading original images and files</span></label>
    <label className="check-field"><input type="checkbox" checked={write} onChange={event=>setWrite(event.target.checked)}/><span>Allow organizing tags, folders and related saves</span></label>
    <button className="button secondary compact" disabled={busy||!!secret}>Create connection</button>
   </form></details>
   {secret?<div className="agent-secret"><h4>Save this connection privately.</h4><p className="field-help">The credential is shown once. Add this to a client that supports HTTP MCP with an Authorization header.</p><textarea aria-label="Private MCP configuration" readOnly value={config} rows={10} spellCheck={false}/><div className="service-actions"><button className="button secondary compact" onClick={()=>void navigator.clipboard.writeText(config).then(()=>toast('Configuration copied.')).catch(()=>toast('Select the configuration and copy it manually.'))}>Copy configuration</button><button className="subtle-button" onClick={()=>setSecret('')}>I saved it</button></div></div>:null}
   <ul className="device-list">{agents.data?.agents.map(agent=><li key={agent.id}><div><strong>{agent.name}</strong><span>{agent.scopes.includes('library:write')?'Can organize':'Read only'} · Expires {new Date(agent.expiresAt).toLocaleDateString()}</span></div><button className="subtle-button danger-text" disabled={busy} onClick={async()=>{if(await confirm('Disconnect this agent?',agent.name+' will immediately lose access to your library.','Revoke access'))action.mutate({kind:'revoke',id:agent.id});}}>Revoke</button></li>)}</ul>
   {agents.data?.agents.length?<form className="service-form" onSubmit={event=>{event.preventDefault();if(!busy)action.mutate({kind:'nudge'});}}><label className="field">Ask your connected agent<textarea value={nudge} onChange={event=>setNudge(event.target.value)} maxLength={1000} required rows={2} placeholder="Organize my recent design references into a folder…"/></label><button className="button secondary compact" disabled={busy||!nudge.trim()}>Save instruction</button><p className="field-help">Your agent receives this when it next checks Foundkeep. Keep it running to handle new saves automatically.</p></form>:null}
   {agents.data?.nudges.filter(item=>item.status==='pending').map(item=><p className="field-help" key={item.id}>Waiting for your agent: {item.text}</p>)}
   {agents.error?<p role="alert">{agents.error.message}</p>:null}
  </section>
  {action.error?<p className="form-message is-error" role="alert">{action.error.message}</p>:null}
 </div>;
}
