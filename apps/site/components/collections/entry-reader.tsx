'use client';

import {useEffect,useRef} from 'react';
import type {SharedEntry} from '@/lib/collections';
import {ReaderIcon,sourceLink} from '../reader/reader-tools';
import '../reader/reader.css';
import {lockDocumentScroll} from '../../lib/scroll-lock';

/** Read the published snapshot only. Public entries have no private capture identity. */
export function EntryReader({entry,collectionTitle,onClose}:{entry:SharedEntry;collectionTitle:string;onClose:()=>void}) {
 const dialog=useRef<HTMLDialogElement>(null);
 const close=useRef(onClose);close.current=onClose;
 const source=sourceLink(entry.url);
 useEffect(()=>{
  const element=dialog.current;if(!element)return;
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const unlock=lockDocumentScroll();
  element.showModal();
  element.querySelector<HTMLButtonElement>('.reader-close')?.focus({preventScroll:true});
  return()=>{element.close();unlock();if(previous?.isConnected)previous.focus({preventScroll:true});};
 },[]);
 return <dialog ref={dialog} className="snapshot-reader reader-surface" aria-labelledby="entry-reader-title" onKeyDown={event=>{if(event.key!=='Tab')return;const items=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),[tabindex="0"]')).filter(element=>element.getClientRects().length);const first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}} onCancel={event=>{event.preventDefault();close.current();}} onClick={event=>{if(event.target===event.currentTarget){const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)close.current();}}}>
  <div className="reader-toolbar"><button type="button" className="reader-icon-button reader-close" onClick={onClose} aria-label="Close find" title="Close find"><ReaderIcon kind="close"/></button><span className="reader-toolbar-label">{collectionTitle}</span><div className="reader-toolbar-actions">{source?<a className="reader-icon-button" href={source.href} target="_blank" rel="noopener noreferrer ugc nofollow" aria-label="Open original source" title="Open original source"><ReaderIcon kind="source"/></a>:null}</div></div>
  <div className="reader-layout"><article className="reader-content"><header className="reader-heading"><div className="reader-byline"><span>{entry.imageUrl?'Image':source?'Link':'Note'}</span>{source?<span>{source.hostname.replace(/^www\./,'')}</span>:null}</div><h2 id="entry-reader-title">{entry.title}</h2></header>{entry.imageUrl?<figure className="snapshot-media"><img src={entry.imageUrl} alt={entry.title}/></figure>:null}{entry.body?<div className="reader-prose snapshot-body">{entry.body}</div>:null}</article>
   <aside className="reader-context" aria-label="Find details"><h3>In this collection</h3><p className="reader-collection-name">{collectionTitle}</p><dl className="reader-metadata"><div><dt>Added by</dt><dd>{entry.authorName}</dd></div><div><dt>Added</dt><dd><time dateTime={new Date(entry.createdAt).toISOString()}>{new Date(entry.createdAt).toLocaleDateString('en',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'})}</time></dd></div>{source?<div><dt>Source</dt><dd><a href={source.href} target="_blank" rel="noopener noreferrer ugc nofollow">{source.hostname.replace(/^www\./,'')}<ReaderIcon kind="source"/></a></dd></div>:null}{entry.status!=='approved'?<div><dt>Status</dt><dd>{entry.status==='pending'?'Awaiting approval':'Not accepted'}</dd></div>:null}</dl>{entry.tags.length?<><h3>Tags</h3><ul className="reader-tags">{entry.tags.map(tag=><li key={tag}>{tag}</li>)}</ul></>:null}</aside>
  </div>
 </dialog>;
}
