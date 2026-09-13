import type {Metadata} from 'next';
import {cache} from 'react';
import {notFound} from 'next/navigation';
import {serverApi} from '@/lib/server';
import {ApiError} from '@/lib/api';
import type {CollectionDetail} from '@/lib/collections';
import {PublicCollection} from '@/components/collections/public-page';
import '../../customer.css';
export const dynamic='force-dynamic';
const read=cache(async(slug:string,q='',tag='')=>{try{return await serverApi<CollectionDetail>('/collections/by-slug/'+encodeURIComponent(slug)+(q||tag?'?'+new URLSearchParams({q,tag}):''));}catch(e){if(e instanceof ApiError&&e.status===404)notFound();throw e;}});
export async function generateMetadata({params}:{params:Promise<{slug:string}>}):Promise<Metadata> {const {collection:c}=await read((await params).slug);if(c.visibility!=='public')return {title:'Private collection',robots:{index:false,follow:false}};return {title:c.title,description:c.description||`A collection curated by ${c.ownerName} on Foundkeep.`,alternates:{canonical:`/collection/${c.slug}`},robots:{index:true,follow:true},openGraph:{type:'website',title:c.title,description:c.description,url:`https://foundkeep.app/collection/${c.slug}`,images:[{url:'/assets/foundkeep-scenic-social.png',width:1200,height:630}]}};}
export default async function CollectionPage({params,searchParams}:{params:Promise<{slug:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {const query=await searchParams,q=typeof query.q==='string'?query.q.slice(0,100):'',tag=typeof query.tag==='string'?query.tag.slice(0,40):'';const data=await read((await params).slug,q,tag);const session=await serverApi<{account:{id:string}|null}>('/auth/session');return <PublicCollection key={`${data.collection.id}:${session.account?.id||'anonymous'}:${q}:${tag}`} initial={data} accountId={session.account?.id} q={q} tag={tag}/>;}
