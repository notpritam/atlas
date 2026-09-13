import Link from 'next/link';
import type {ReactNode} from 'react';
import type {SharedCollection} from '@/lib/collections';

export function CollectionIcon({children}:{children:ReactNode}) {return <svg aria-hidden="true" viewBox="0 0 24 24">{children}</svg>;}
export const collectionIcons={
 arrow:<path d="M5 12h14m-5-5 5 5-5 5"/>,
 bookmark:<path d="M6 3h12v18l-6-4-6 4Z"/>,
 globe:<><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></>,
 lock:<><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></>,
 search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
 plus:<path d="M12 5v14M5 12h14"/>,
 check:<path d="m5 12 4 4L19 6"/>,
 share:<><path d="M12 16V3m-4 4 4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></>,
 grid:<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
 list:<><path d="M8 5h13M8 12h13M8 19h13"/><path d="M3 5h.01M3 12h.01M3 19h.01"/></>,
};
export function PublicCollectionNav({accountId}:{accountId?:string}) {
 return <header className="public-collection-nav"><Link className="brand" href="/" aria-label="FoundKeep home"><img src="/assets/studio-mark.svg?v=bookmark-evolved-1" alt="" width={30} height={30}/><span>FoundKeep</span></Link><nav aria-label="Collection navigation"><Link className="explore-nav-link" href="/collections">Explore collections</Link><Link className="public-nav-account" href={accountId?'/dashboard/collections':'/login'}>{accountId?'My collections':'Log in'}<CollectionIcon>{collectionIcons.arrow}</CollectionIcon></Link></nav></header>;
}
export function collectionTheme(c:Pick<SharedCollection,'title'|'tags'>) {
 const words=[c.title,...c.tags].join(' ').toLowerCase();
 if(/design|interface|product|ux|creative/.test(words))return 'design';
 if(/read|book|essay|note|think|writing/.test(words))return 'reading';
 return 'connections';
}
/** First-party editorial covers, derived from the collection topic. No remote image requests. */
export function CollectionArtwork({collection}:{collection:Pick<SharedCollection,'title'|'tags'>}) {
 const theme=collectionTheme(collection);
 return <div className={`collection-artwork artwork-${theme}`} aria-hidden="true"><svg viewBox="0 0 480 300" fill="none" preserveAspectRatio="xMidYMid slice">
 {theme==='connections'?<><path d="M-10 225h90a35 35 0 0 0 35-35V98a30 30 0 0 1 30-30h97m0 0h47a30 30 0 0 1 30 30v120a28 28 0 0 0 28 28h146M238 69v152" stroke="#ffffff" strokeOpacity=".45" strokeWidth="2"/><rect x="50" y="168" width="114" height="93" rx="18" fill="#e0f0fc"/><path d="M79 195h53m-53 13h34m-34 13h46" stroke="#086ca8" strokeWidth="3" strokeLinecap="round"/><rect x="182" y="27" width="115" height="103" rx="18" fill="#d5f8cf"/><path d="M220 51h39v60l-19-13-20 13Z" fill="#182b30"/><rect x="297" y="153" width="123" height="108" rx="18" fill="#fff"/><rect x="321" y="178" width="31" height="28" rx="6" fill="#086ca8"/><rect x="365" y="211" width="31" height="27" rx="6" fill="#d5f8cf"/><path d="M352 191h15a13 13 0 0 1 13 13v7" stroke="#182b30" strokeWidth="2"/><circle cx="239" cy="221" r="8" fill="#d5f8cf"/></>:theme==='design'?<><path d="M0 70h480M0 230h480M86 0v300M390 0v300" stroke="#182b30" strokeOpacity=".12"/><rect x="110" y="42" width="255" height="211" rx="14" fill="#fff"/><rect x="110" y="42" width="255" height="35" rx="14" fill="#e0f0fc"/><circle cx="132" cy="60" r="3" fill="#086ca8"/><circle cx="145" cy="60" r="3" fill="#086ca8"/><path d="m153 207 34-98h23l34 98m-77-33h61" stroke="#182b30" strokeWidth="13" strokeLinejoin="round"/><path d="M278 196h60m-60-26h60m-60-26h39" stroke="#086ca8" strokeWidth="4" strokeLinecap="round"/><path d="m352 218 9 39 9-12 16-2Z" fill="#086ca8" stroke="#fff" strokeWidth="3"/></>:<><path d="M65 285V74l76-18v212m276 13V77l-76-20v211" stroke="#e0f0fc" strokeOpacity=".25" strokeWidth="2"/><path d="M111 57c47-9 88 2 129 29 41-27 82-38 129-29v188c-48-9-89 1-129 21-40-20-81-30-129-21Z" fill="#e0f0fc"/><path d="M240 86v180" stroke="#086ca8" strokeOpacity=".35" strokeWidth="2"/><path d="m137 100 64 18m-64 9 64 18m-64 9 47 13m74-49 64-18m-64 45 64-18m-64 45 46-13" stroke="#182b30" strokeOpacity=".55" strokeWidth="3" strokeLinecap="round"/><path d="M287 45h31v103l-15-13-16 13Z" fill="#d5f8cf"/></>}
 </svg></div>;
}
export function CuratorAvatar({name}:{name:string}) {return <span className="curator-avatar" aria-hidden="true">{name.trim().split(/\s+/).slice(0,2).map(word=>Array.from(word)[0]).join('').toUpperCase()||'F'}</span>;}
export function PublicCollectionCard({collection:c}:{collection:SharedCollection}) {
 return <Link href={`/collection/${c.slug}`} className="discovery-card" prefetch={false}><CollectionArtwork collection={c}/><div className="discovery-card-content"><div className="discovery-card-topics">{c.tags.slice(0,2).map(tag=><span key={tag}>{tag}</span>)}</div><h2>{c.title}</h2><p>{c.description||'The links, notes, and ideas this curator keeps coming back to.'}</p><footer><span><CuratorAvatar name={c.ownerName}/>{c.ownerName}</span><span>{c.entries} {c.entries===1?'find':'finds'}<CollectionIcon>{collectionIcons.arrow}</CollectionIcon></span></footer></div></Link>;
}
export function PublicCollectionFooter() {return <footer className="public-collection-footer"><Link className="footer-brand" href="/"><img src="/assets/studio-mark.svg?v=bookmark-evolved-1" width={24} height={24} alt=""/>FoundKeep</Link><span>Good finds, kept together.</span><nav aria-label="Footer"><Link href="/support">Support</Link><Link href="/privacy">Privacy</Link></nav></footer>;}
