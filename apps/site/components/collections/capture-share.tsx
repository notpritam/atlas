'use client';
import Link from 'next/link';
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {useDashboard} from '../dashboard/context';
import {captureTitle,type Capture} from '@/lib/dashboard';
import type {CollectionList} from '@/lib/collections';
import {EntryForm} from './entry-form';
import './collections.css';
export function CaptureShare({capture}:{capture:Capture}) {
 const {request,toast}=useDashboard(),[open,setOpen]=useState(false),[selected,setSelected]=useState('');
 const list=useQuery({queryKey:['share-targets'],queryFn:({signal})=>request<CollectionList>('/collections',{signal}),enabled:open});
 const targets=list.data?.collections.filter(c=>c.canSubmit)||[],target=targets.find(c=>c.id===selected);
 return <section className="social-collections capture-collection-share"><button className="button secondary" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'Close collection sharing':'Add to a collection'}</button>{open?<><p>Your saved original stays in your private library. Choose what to share below.</p>{list.isPending?<p role="status">Loading your collections…</p>:list.isError?<p role="alert">{list.error.message} <button onClick={()=>void list.refetch()}>Try again</button></p>:<><label htmlFor="capture-share-target">Collection</label><select id="capture-share-target" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Choose a collection</option>{targets.map(c=><option key={c.id} value={c.id}>{c.title} · {c.visibility}</option>)}</select>{!targets.length?<p><Link href="/dashboard/collections">Create a collection</Link> or follow one that accepts contributions.</p>:null}{target?<EntryForm key={target.id} collection={target} request={request} initial={{captureId:capture.id,title:captureTitle(capture),url:capture.sourceUrl||'',hasImage:!!capture.blobUrl}} done={()=>toast('Collection submission saved.')}/>:null}</>}</>:null}</section>;
}
