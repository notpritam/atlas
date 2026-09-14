'use client';
import {useEffect,useRef,useState} from 'react';
import {captureMedia,captureTitle,type Capture} from '../../lib/dashboard';
import {DashboardImage} from './dashboard-image';

function VideoPreview({url,title}:{url:string;title:string}){
 const holder=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false),[failed,setFailed]=useState(false);
 useEffect(()=>{
  if(!('IntersectionObserver' in window)){setVisible(true);return;}
  const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'240px'});
  if(holder.current)observer.observe(holder.current);return()=>observer.disconnect();
 },[]);
 return <div ref={holder} className="capture-video-preview">{visible&&!failed?<video src={url+'#t=0.1'} muted playsInline preload="metadata" tabIndex={-1} aria-label={title} onError={()=>setFailed(true)}/>:null}<span className="capture-video-mark" aria-hidden="true">▶</span><span className="sr-only">{failed?'Saved video; open this item to play it.':'Saved video preview'}</span></div>;
}

export function CardMedia({capture}:{capture:Capture}){
 const items=captureMedia(capture),media=capture.preservedMedia;
 if(!items.length||!media)return null;
 const label=[media.imageCount?`${media.imageCount} ${media.imageCount===1?'photo':'photos'}`:'',media.videoCount?`${media.videoCount} ${media.videoCount===1?'video':'videos'}`:''].filter(Boolean).join(' · ');
 return <div className={`capture-media-grid capture-media-${items.length}`} aria-label={`Saved media: ${label}`}>
  {items.map((item,index)=><div className="capture-media-tile" key={item.id}>{item.kind==='image'?<DashboardImage src={item.url} alt={`Photo ${index+1} from ${captureTitle(capture)}`} mode="card" kind="Saved photo"/>:<VideoPreview url={item.url} title={`Video from ${captureTitle(capture)}`}/>}</div>)}
  <span className="capture-media-count">{label}</span>
 </div>;
}
