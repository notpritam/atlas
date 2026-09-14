import Link from 'next/link';
import Form from 'next/form';
import {SegmentedControl} from '@/components/ui/segmented-control';
import type {Metadata} from 'next';
import {serverApi} from '@/lib/server';
import type {SharedCollection} from '@/lib/collections';
import {CollectionIcon,PublicCollectionNav,PublicCollectionCard,PublicCollectionFooter,collectionIcons} from '@/components/collections/public-chrome';
import '../customer.css';
import '@/components/collections/collections.css';
import '@/components/collections/public-collections.css';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Explore public collections',description:'Discover useful links, ideas, agents and skills, curated by people on FoundKeep.',alternates:{canonical:'/collections'},robots:{index:true,follow:true}};
export default async function CollectionsDirectory({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 const query=await searchParams,q=typeof query.q==='string'?query.q.slice(0,100):'',cursor=typeof query.cursor==='string'&&/^\d{1,6}$/.test(query.cursor)?query.cursor:'0';
 const [data,session]=await Promise.all([serverApi<{collections:SharedCollection[];nextCursor:string|null}>('/public/collections?'+new URLSearchParams({q,cursor})),serverApi<{account:{id:string}|null}>('/auth/session')]);
 return <div className="social-collections public-collections-shell collection-editorial collection-discovery"><a className="public-skip-link" href="#explore-results">Skip to collections</a><PublicCollectionNav accountId={session.account?.id}/><main className="public-collection">
  <header className="discovery-heading"><h1>Good finds.<br/><span>Better together.</span></h1><div><p>A useful idea can lead somewhere unexpected. Explore collections made by people who care about what they keep.</p><Form className="collection-search" action="/collections"><label className="sr-only" htmlFor="collection-search">Search public collections</label><input id="collection-search" name="q" type="search" maxLength={100} defaultValue={q} placeholder="Try agents, skills, design…"/><button className="button primary"><CollectionIcon>{collectionIcons.search}</CollectionIcon><span>Search</span></button></Form></div></header>
  <SegmentedControl className="discovery-topics" label="Explore topics" value={q} items={[["","All collections"],["agents","Agents & skills"],["design","Product & design"],["reading","Worth reading"]].map(([value,label])=>({value,label,href:value?'/collections?q='+encodeURIComponent(value):'/collections'}))} />
  <section id="explore-results" aria-labelledby="explore-title"><div className="collection-directory-heading"><div><h2 id="explore-title">{q?`Collections for “${q}”`:'Recently curated'}</h2><p>{q?'Follow a collection to keep it close.':'A few good places to start exploring.'}</p></div><Link className="text-link" href="/dashboard/collections">Create a collection<CollectionIcon>{collectionIcons.plus}</CollectionIcon></Link></div>
  {data.collections.length?<div className="discovery-grid">{data.collections.map(c=><PublicCollectionCard key={c.id} collection={c}/>)}</div>:<section className="collection-empty"><CollectionIcon>{collectionIcons.bookmark}</CollectionIcon><h2>{q?'No collections match yet.':'The first collection could be yours.'}</h2><p>{q?'Try a different topic, or make a collection for it.':'Gather the links and ideas you keep recommending, and give them a public home.'}</p>{q?<Link className="button secondary" href="/collections">Explore all collections</Link>:<Link className="button primary" href="/dashboard/collections">Start a collection</Link>}</section>}
  {data.nextCursor?<div className="discovery-more"><Link className="button secondary" href={'/collections?'+new URLSearchParams({q,cursor:data.nextCursor})}>More collections<CollectionIcon>{collectionIcons.arrow}</CollectionIcon></Link></div>:null}</section>
  <section className="discovery-invitation"><div><h2>Make a little room<br/>for what you love.</h2><p>Gather your links, ideas, and recommendations.<br/>Keep them private or give them a public home.</p><Link className="button primary" href="/dashboard/collections">Start your collection<CollectionIcon>{collectionIcons.arrow}</CollectionIcon></Link></div><div className="invitation-bookmark" aria-hidden="true"><img src="/assets/studio-mark.svg?v=bookmark-evolved-1" alt="" width={88} height={88}/></div></section><PublicCollectionFooter/>
 </main></div>;
}
