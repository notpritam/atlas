'use client';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useCallback,useEffect,useRef,useState,useTransition} from 'react';
import {api,ApiError} from '@/lib/api';
import type {CollectionDetail,CollectionRequest} from '@/lib/collections';
import {CollectionRules} from './shared';
import {EntryForm} from './entry-form';
import {Entries} from './entries';
import {useEntrance} from '../dashboard/motion';
import {Spinner} from '../dashboard/loading';
import {CollectionIcon,CuratorAvatar,PublicCollectionNav,PublicCollectionFooter,collectionIcons} from './public-chrome';
import './collections.css';
import './public-collections.css';

export function PublicCollection({initial,accountId,q='',tag=''}:{initial:CollectionDetail;accountId?:string;q?:string;tag?:string}) {
 const router=useRouter();
 const [data,setData]=useState(initial),[unavailable,setUnavailable]=useState(false),[adding,setAdding]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [view,setView]=useState<'list'|'grid'>('grid'),[shareMessage,setShareMessage]=useState(''),[copyFallback,setCopyFallback]=useState(''),[searching,startSearch]=useTransition();
 const loadedPages=useRef(1),readEpoch=useRef(0),alive=useRef(true),lifetime=useRef<AbortController|null>(null),formRef=useRef<HTMLDivElement>(null);
 const request:CollectionRequest=useCallback((path,options)=>{
  if(!accountId&&options?.method&&options.method!=='GET')return Promise.reject(new Error('Log in and reopen this collection before contributing.'));
  const controller=lifetime.current||=new AbortController();
  return api(path,{...options,accountId,signal:options?.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal});
 },[accountId]);
 const basePath='/collection/'+initial.collection.slug;
 const readBase=(accountId?'/collections/by-slug/':'/public/collections/')+initial.collection.slug;
 const readPath=useCallback((cursor?:string)=>{const params=new URLSearchParams();if(q)params.set('q',q);if(tag)params.set('tag',tag);if(cursor)params.set('cursor',cursor);return readBase+(params.size?'?'+params:'');},[readBase,q,tag]);
 const ref=useEntrance<HTMLElement>(initial.collection.id,':scope > .collection-profile');
 const refresh=useCallback(async()=>{
  const serial=++readEpoch.current;
  try{
   let result=await request<CollectionDetail>(readPath());let entries=result.entries;
   for(let i=1;i<loadedPages.current&&result.nextCursor;i++){const next=await request<CollectionDetail>(readPath(result.nextCursor));entries=[...entries,...next.entries];result=next;}
   if(!alive.current||serial!==readEpoch.current)return;
   setData({...result,entries:entries.filter((entry,index,all)=>all.findIndex(other=>other.id===entry.id)===index)});setError('');
  }catch(e){if(!alive.current||serial!==readEpoch.current)return;if(e instanceof ApiError&&[401,403,404,409].includes(e.status))setUnavailable(true);else setError(e instanceof Error?e.message:'Could not refresh collection.');}
 },[readPath,request]);
 useEffect(()=>{
  alive.current=true;
  const expired=()=>setUnavailable(true),restored=(e:PageTransitionEvent)=>{if(e.persisted)location.reload();},focus=()=>void refresh();
  window.addEventListener('atlas-session-expired',expired);window.addEventListener('pageshow',restored);window.addEventListener('focus',focus);
  const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},15000);
  return()=>{alive.current=false;readEpoch.current++;lifetime.current?.abort();lifetime.current=null;clearInterval(timer);window.removeEventListener('atlas-session-expired',expired);window.removeEventListener('pageshow',restored);window.removeEventListener('focus',focus);};
 },[refresh]);
 useEffect(()=>{if(adding)formRef.current?.querySelector('input')?.focus();},[adding]);
 const follow=async()=>{
  setBusy(true);setError('');
  try{await request(`/collections/${data.collection.id}/follow`,{method:data.collection.following?'DELETE':'POST',...(data.collection.following?{}:{body:{}})});await refresh();}
  catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not update following.');}
  finally{if(alive.current)setBusy(false);}
 };
 const more=async()=>{
  if(!data.nextCursor||busy)return;setBusy(true);setError('');const serial=++readEpoch.current;
  try{const next=await request<CollectionDetail>(readPath(data.nextCursor));if(!alive.current||serial!==readEpoch.current)return;loadedPages.current++;setData(previous=>({...next,entries:[...previous.entries,...next.entries].filter((entry,index,all)=>all.findIndex(other=>other.id===entry.id)===index)}));}
  catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not load more finds.');}
  finally{if(alive.current)setBusy(false);}
 };
 const share=async()=>{
  const url=new URL(basePath,window.location.origin).href;
  try{await navigator.clipboard.writeText(url);setCopyFallback('');setShareMessage(data.collection.visibility==='private'?'Link copied. Only invited members can open it.':'Collection link copied. Ready to share.');}
  catch{setCopyFallback(url);setShareMessage('Copy the collection link below.');}
 };
 if(unavailable)return <div className="social-collections public-collections-shell collection-editorial"><PublicCollectionNav/><main className="public-collection collection-unavailable"><h1>Collection unavailable</h1><p>This collection is private, your access changed, or your session ended.</p><div className="collection-toolbar"><a className="button primary" href="/login">Log in</a><Link className="button secondary" href="/collections">Explore public collections</Link></div></main></div>;
 const c=data.collection,total=data.total??c.entries;
 const topics=[...new Set([...(data.availableTags||[]),...(tag?[tag]:[])])];
 const canSuggest=c.canSubmit||(!accountId&&c.submissionPolicy==='anyone');
 return <div className="social-collections public-collections-shell collection-editorial">
  <a className="public-skip-link" href="#collection-finds">Skip to finds</a><PublicCollectionNav accountId={accountId}/>
  <main ref={ref} className="public-collection">
   <nav className="collection-breadcrumb" aria-label="Breadcrumb"><Link href="/collections">Explore collections</Link><CollectionIcon>{collectionIcons.arrow}</CollectionIcon><span>{c.visibility==='public'?'Public collection':'Private collection'}</span></nav>
   <header className="collection-profile">
    <div className="collection-profile-copy"><h1>{c.title}</h1>{c.description?<p className="collection-description">{c.description}</p>:null}
     <div className="collection-hero-meta"><div className="collection-identity"><CuratorAvatar name={c.ownerName}/><div><span>Curated by <strong>{c.ownerName}</strong></span><small>Updated {new Date(c.updatedAt).toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})}</small></div></div><div className="collection-profile-meta"><span><CollectionIcon>{collectionIcons.bookmark}</CollectionIcon>{c.entries.toLocaleString('en-US')} {c.entries===1?'find':'finds'}</span><span>{c.followers.toLocaleString('en-US')} {c.followers===1?'follower':'followers'}</span><span><CollectionIcon>{c.visibility==='public'?collectionIcons.globe:collectionIcons.lock}</CollectionIcon>{c.visibility==='public'?'Public':'Private'}</span></div></div>
    </div>
    <div className="collection-profile-actions"><div className="collection-toolbar profile-actions">{accountId?<button className="button primary" disabled={busy} onClick={()=>void follow()}>{busy?<Spinner/>:<CollectionIcon>{c.following?collectionIcons.check:collectionIcons.plus}</CollectionIcon>}{c.following?'Following · unfollow':'Follow collection'}</button>:<Link className="button primary" href="/login"><CollectionIcon>{collectionIcons.plus}</CollectionIcon>Log in to follow</Link>}<button className="button secondary share-collection" onClick={()=>void share()}><CollectionIcon>{collectionIcons.share}</CollectionIcon>Share collection</button></div>
     {canSuggest?<div className="collection-suggest-action">{c.canSubmit?<button className="text-link" aria-expanded={adding} onClick={()=>setAdding(!adding)}>{adding?'Close submission':c.requireApproval&&!c.canModerate?'Suggest a find':'Add a find'}<CollectionIcon>{collectionIcons.plus}</CollectionIcon></button>:<Link className="text-link" href="/login">Log in to contribute<CollectionIcon>{collectionIcons.plus}</CollectionIcon></Link>}</div>:null}
     {c.role?<Link className="text-link collection-manage-link" href={`/dashboard/collections/${c.id}`}>{c.canModerate?'Manage collection':'Open in my collections'}<CollectionIcon>{collectionIcons.arrow}</CollectionIcon></Link>:null}
     <p className="collection-share-status" role="status">{shareMessage}</p>{copyFallback?<label className="share-link-fallback">Collection link<input readOnly value={copyFallback} onFocus={event=>event.currentTarget.select()}/></label>:null}
    </div>
    <details id="collection-context" className="collection-about"><summary>About &amp; contribution rules<CollectionIcon><path d="m8 10 4 4 4-4"/></CollectionIcon></summary><CollectionRules collection={c} title="Contribution rules"/></details>
   </header>
   {error?<div className="collection-error" role="alert">{error}<button className="subtle-button" onClick={()=>void refresh()}>Retry</button></div>:null}
   <div className="collection-reading-layout">
    <section className="collection-find-feed" id="collection-finds" aria-labelledby="collection-finds-title" data-view={view} aria-busy={searching}>
     <div className="collection-feed-heading"><h2 id="collection-finds-title">Finds <span>{c.entries}</span></h2><div className="collection-view-control" role="group" aria-label="Find layout"><button type="button" aria-label="List view" title="List view" aria-pressed={view==='list'} onClick={()=>setView('list')}><CollectionIcon>{collectionIcons.list}</CollectionIcon></button><button type="button" aria-label="Grid view" title="Grid view" aria-pressed={view==='grid'} onClick={()=>setView('grid')}><CollectionIcon>{collectionIcons.grid}</CollectionIcon></button></div></div>
     <form className="collection-find-search" action={basePath} onSubmit={event=>{event.preventDefault();const values=new FormData(event.currentTarget),params=new URLSearchParams();for(const name of ['q','tag']){const value=String(values.get(name)||'').trim();if(value)params.set(name,value);}startSearch(()=>router.push(basePath+(params.size?'?'+params:'')+'#collection-finds',{scroll:false}));}}><div className="find-search-input"><CollectionIcon>{collectionIcons.search}</CollectionIcon><label className="sr-only" htmlFor="find-search">Search this collection</label><input id="find-search" name="q" type="search" defaultValue={q} maxLength={100} placeholder="Search this collection…"/></div><label className="sr-only" htmlFor="find-topic">Filter by topic</label><select name="tag" id="find-topic" defaultValue={tag}><option value="">All topics</option>{topics.map(topic=><option key={topic} value={topic}>{topic}</option>)}</select><button type="submit" className="button secondary find-search-submit" aria-label="Search" title="Search" disabled={searching}>{searching?<Spinner/>:<><CollectionIcon>{collectionIcons.search}</CollectionIcon><span>Search</span></>}</button></form>
     <nav className="collection-topic-filters" aria-label="Collection topics"><Link aria-current={!tag?'page':undefined} href={basePath+(q?'?'+new URLSearchParams({q}):'')+'#collection-finds'} scroll={false}>All finds</Link>{topics.slice(0,10).map(topic=><Link key={topic} aria-current={tag===topic?'page':undefined} href={basePath+'?'+new URLSearchParams({...q?{q}:{},tag:topic})+'#collection-finds'} scroll={false}>{topic}</Link>)}</nav><div className="collection-result-summary"><p role="status">{q||tag?`${total} ${total===1?'match':'matches'}${q?` for “${q}”`:''}${tag?` in ${tag}`:''}`:`${total} ${total===1?'find':'finds'} · Newest first`}</p>{q||tag?<Link href={basePath+'#collection-finds'} scroll={false}>Clear filters</Link>:<span>Curated by {c.ownerName}</span>}</div>
     {adding?<div ref={formRef} className="public-submission"><button type="button" className="subtle-button close-submission" onClick={()=>setAdding(false)}>Close submission</button><EntryForm collection={c} request={request} done={()=>void refresh()}/></div>:null}
     {data.entries.length||(!q&&!tag)?<Entries collection={c} entries={data.entries} request={request} changed={()=>void refresh()} publicView masonry={view==='grid'}/>:<div className="collection-no-matches"><CollectionIcon>{collectionIcons.search}</CollectionIcon><h2>No finds match yet.</h2><p>Try another word or explore all the finds in this collection.</p><Link className="button secondary" href={basePath+'#collection-finds'}>Clear filters</Link></div>}
     {data.nextCursor?<div className="collection-load-more"><p>{data.entries.length} of {total} finds</p><button className="button secondary" disabled={busy} onClick={()=>void more()}>{busy?<><Spinner/>Loading…</>:'Load more finds'}</button></div>:null}
    </section>
   </div><PublicCollectionFooter/>
  </main>
 </div>;
}
