'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDashboard } from './context';
import { gsap, motionAllowed } from './motion';
import type { CollectionList } from '../../lib/collections';
import type { Me } from '../../lib/types';
import {lockDocumentScroll} from '../../lib/scroll-lock';

export type AccountSection = 'collections' | 'mind-map' | 'apps' | 'agents' | 'settings' | 'capture' | 'processing' | 'plans';
const collapsePreference = 'foundkeep.sidebar.collapsed';
const mobileQuery = '(max-width: 760px)';
const icons = {
  library: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 3v18m4-13h4m-4 4h4" /></>,
  collections: <><rect x="3" y="8" width="18" height="13" rx="2" /><path d="M6 8V5h12v3M9 5V2h6v3m-6 10h6" /></>,
  graph: <><circle cx="5" cy="5" r="2.5"/><circle cx="19" cy="7" r="2.5"/><circle cx="10" cy="19" r="2.5"/><path d="m7.5 5 9 1M6 7.5l3 9m8-7.5-5.5 8"/></>,
  agents: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /><path d="M10 6h5a3 3 0 0 1 3 3v5M6 10v5a3 3 0 0 0 3 3h5" /></>,
  devices: <><rect x="2" y="3" width="14" height="12" rx="2" /><path d="M5 20h7m-3-5v5" /><rect x="16" y="8" width="6" height="13" rx="1.5" /></>,
  plans: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M7 16v-3m5 3V7m5 9v-6" /></>,
  settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="var(--surface)" /><circle cx="15" cy="17" r="3" fill="var(--surface)" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01" /></>,
  privacy: <><path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Z" /><path d="m8 12 3 3 5-5" /></>,
  folder: <path d="M3 8V5a2 2 0 0 1 2-2h4l3 4h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  globe: <><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></>,
  switch: <path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" />,
};
function Icon({ children }: { children: ReactNode }) { return <svg aria-hidden="true" viewBox="0 0 24 24">{children}</svg>; }

export function Sidebar({ me, section, collectionId, libraryHref = '/dashboard', onLibrary }: { me: Me; section?: AccountSection; collectionId?: string; libraryHref?: string; onLibrary?: () => void }) {
  const { request } = useDashboard();
  const router = useRouter();
  const pathname = usePathname();
  // Share page queries, but let their hydrated page start the first request.
  // Starting it here can change a still-hydrating page's server snapshot.
  const collections = useQuery({ enabled: section !== 'collections', queryKey: ['social-collections'], queryFn: ({ signal }) => request<CollectionList>('/collections', { signal }) });
  const plan = useQuery({ enabled: section !== 'plans' && section !== 'processing', queryKey: ['plan', me.account.id], queryFn: ({ signal }) => request<{ pro: boolean }>('/plan', { signal }) });
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const logoRef = useRef<HTMLButtonElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const previousMain = useRef<{ left: number; top: number } | null>(null);
  const rail = collapsed && !mobile;

  useLayoutEffect(() => { setMobileOpen(false); }, [pathname]);

  useLayoutEffect(() => {
    const restore = () => { try { setCollapsed(localStorage.getItem(collapsePreference) === 'true'); } catch { /* Navigation also works without storage. */ } };
    restore();
    const changed = (event: StorageEvent) => { if (event.key === collapsePreference || event.key === null) restore(); };
    const media = window.matchMedia(mobileQuery);
    const resize = () => { setMobile(media.matches); setMobileOpen(false); };
    resize();
    window.addEventListener('storage', changed);
    media.addEventListener('change', resize);
    return () => { window.removeEventListener('storage', changed); media.removeEventListener('change', resize); };
  }, []);

  useLayoutEffect(() => {
    const previous = previousMain.current;
    previousMain.current = null;
    if (collapsed && document.activeElement === collapseRef.current) logoRef.current?.focus();
    const main = ref.current?.parentElement?.querySelector<HTMLElement>(':scope > main');
    if (!previous || !main) return;
    const next = main.getBoundingClientRect();
    const media = gsap.matchMedia();
    media.add(motionAllowed, () => {
      gsap.fromTo(main, { x: previous.left - next.left, y: previous.top - next.top }, { x: 0, y: 0, duration: 0.24, ease: 'power2.out', clearProps: 'transform' });
    });
    return () => media.revert();
  }, [collapsed]);

  // The drawer owns focus and background scrolling only while it is open.
  useLayoutEffect(() => {
    if (!mobile || !mobileOpen) return;
    const main = ref.current?.parentElement?.querySelector<HTMLElement>(':scope > main');
    const skip = ref.current?.closest('.dashboard-body')?.querySelector<HTMLElement>('.skip-link');
    const background = [main, skip, headerRef.current].filter((el): el is HTMLElement => Boolean(el));
    const inert = background.map(el => el.inert);
    const unlock = lockDocumentScroll();
    const overscroll = document.documentElement.style.overscrollBehavior;
    background.forEach(el => { el.inert = true; });
    document.documentElement.style.overscrollBehavior = 'none';
    collapseRef.current?.focus({ preventScroll: true });
    return () => {
      background.forEach((el, index) => { el.inert = inert[index]; });
      unlock();
      document.documentElement.style.overscrollBehavior = overscroll;
      if (window.matchMedia(mobileQuery).matches) openRef.current?.focus({ preventScroll: true });
    };
  }, [mobile, mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setMobileOpen(false);
      }
      if (event.key !== 'Tab' || !mobile || !mobileOpen) return;
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),select,summary,[tabindex="0"]') || []).filter(el => el.getClientRects().length && !el.closest('[inert]'));
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [mobile, mobileOpen]);

  const close = () => { setMobileOpen(false); };
  const toggle = () => {
    if (mobile) { close(); return; }
    const main = ref.current?.parentElement?.querySelector<HTMLElement>(':scope > main');
    if (main) { const bounds = main.getBoundingClientRect(); previousMain.current = { left: bounds.left, top: bounds.top }; }

    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(collapsePreference, String(next)); } catch { /* A preference must not block navigation. */ }
  };
  const openLibrary = () => { close(); if (onLibrary) onLibrary(); else router.push(libraryHref); };
  const settings = section === 'settings' || section === 'capture' || section === 'processing';
  const primary = [
    { href: libraryHref, id: 'all-captures', label: 'My library', active: !section, icon: icons.library },
    { href: '/dashboard/collections', id: 'open-collections', label: 'Collections', active: section === 'collections' && !collectionId, icon: icons.collections },
    { href: '/dashboard/mind-map', id: 'open-mind-map', label: 'Mind map', active: section === 'mind-map', icon: icons.graph },
    { href: '/dashboard/agents', id: 'open-agents', label: 'Agents', active: section === 'agents', icon: icons.agents },
  ];
  const manage = [
    { href: '/dashboard/apps', id: 'open-setup', label: 'Apps & devices', active: section === 'apps', icon: icons.devices },
    { href: '/dashboard/plans', id: 'open-plans', label: 'Plans & usage', active: section === 'plans', icon: icons.plans },
    { href: '/dashboard/settings', id: 'open-settings', label: 'Settings', active: settings, icon: icons.settings },
    { href: '/support', id: 'sidebar-support', label: 'Support', active: false, icon: icons.help },
  ];
  const navLink = (link: typeof primary[number]) => <Link key={link.id} id={link.id} href={link.href} aria-label={link.label} title={rail ? link.label : undefined} className={`sidebar-nav-link${link.active ? ' nav-active' : ''}`} aria-current={link.active ? 'page' : undefined} onNavigate={event => { if (link.id === 'all-captures' && onLibrary) { event.preventDefault(); openLibrary(); } else close(); }}><Icon>{link.icon}</Icon><span className="sidebar-nav-label">{link.label}</span>{link.id === 'all-captures' ? <span id="nav-count">{me.usage.captures.toLocaleString('en-US')}</span> : null}</Link>;
  const allCollections = collections.data?.collections || [];
  const visibleCollections = allCollections.slice(0, 8);
  const selected = allCollections.find(collection => collection.id === collectionId);
  if (selected && !visibleCollections.includes(selected)) visibleCollections[7] = selected;
  const planName = plan.data ? (plan.data.pro ? 'Pro plan' : 'Free plan') : 'Your plan';
  return <>
    <div className="sidebar-mobile-header" ref={headerRef}><button id="open-sidebar" ref={openRef} className="sidebar-icon-button" type="button" aria-label="Open sidebar" title="Open sidebar" aria-expanded={mobileOpen} aria-controls="library-sidebar" onClick={() => setMobileOpen(true)}><Icon><path d="M4 7h16M4 12h16M4 17h16" /></Icon></button></div>
    <div className="sidebar-backdrop" data-open={mobile && mobileOpen} aria-hidden="true" onClick={close} />
    <aside ref={ref} id="library-sidebar" className="library-sidebar" data-collapsed={collapsed} data-open={mobileOpen} role={mobile ? 'dialog' : undefined} aria-modal={mobile && mobileOpen ? true : undefined} aria-label="Library navigation" inert={mobile && !mobileOpen}>
      <div className="sidebar-heading"><button ref={logoRef} id="sidebar-logo" className="sidebar-brand" type="button" aria-label={rail ? 'Expand sidebar' : 'FoundKeep — My library'} aria-expanded={rail ? false : undefined} aria-controls={rail ? 'workspace-navigation' : undefined} title={rail ? 'Expand sidebar' : 'My library'} onClick={rail ? toggle : openLibrary}><img src="/assets/studio-mark.svg?v=bookmark-evolved-1" width="32" height="32" alt="" /><span className="sidebar-wordmark">FoundKeep</span></button>
        <button ref={collapseRef} id="toggle-sidebar" className="sidebar-icon-button sidebar-toggle" type="button" aria-label="Collapse sidebar" title="Collapse sidebar" aria-expanded={mobile ? mobileOpen : !collapsed} aria-controls="library-sidebar" onClick={toggle}><Icon><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9 4v16" /></Icon></button>
      </div>
      <button className="sidebar-search sidebar-nav-link" type="button" aria-label="Search FoundKeep" onClick={() => { close(); window.dispatchEvent(new Event('foundkeep:search')); }}><Icon><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></Icon><span className="sidebar-nav-label">Search</span><kbd>⌘ K</kbd></button>
      <div className="sidebar-nav-scroller"><nav className="library-nav" id="workspace-navigation" aria-label="Your library">
        {primary.map(navLink)}
        <details className="sidebar-collection-tree" open><summary>Your collections<Icon><path d="m8 10 4 4 4-4" /></Icon></summary>
          {collections.isPending ? null : collections.isError ? <div className="sidebar-collection-message"><p>Collections couldn’t load.</p><button type="button" onClick={() => void collections.refetch()}>Retry collections</button></div> : allCollections.length ? <>{visibleCollections.map(collection => <Link key={collection.id} className="sidebar-collection-link" href={`/dashboard/collections/${collection.id}`} title={`${collection.title} · ${collection.visibility}${collection.following ? ' · following' : ''}`} aria-current={collection.id === collectionId ? 'page' : undefined} onNavigate={() => close()}><Icon>{collection.visibility === 'public' ? icons.globe : icons.folder}</Icon><span>{collection.title}</span></Link>)}{allCollections.length > 8 ? <Link className="sidebar-collection-link sidebar-all-collections" href="/dashboard/collections" onNavigate={close}>View all {allCollections.length} collections</Link> : null}</> : <p className="sidebar-collection-message">Your collections will appear here.<Link href="/dashboard/collections" onNavigate={close}>Create a collection</Link></p>}
        </details>
        <p className="sidebar-section-title">Manage</p>{manage.map(navLink)}
      </nav></div>
      <div className="sidebar-bottom"><div className="sidebar-plan-summary"><div className="sidebar-plan-title"><strong>{planName}</strong><span>{me.usage.captures.toLocaleString('en-US')} saves</span></div><Link className="sidebar-plan-link" href="/dashboard/plans" onNavigate={close}>{plan.data ? (plan.data.pro ? 'Manage plan' : 'Explore Pro') : 'View plan & usage'}<Icon><path d="M5 12h14m-5-5 5 5-5 5" /></Icon></Link></div>
        <div className="sidebar-account"><Link className="account-button" id="open-account" href="/dashboard/settings" aria-label="Account settings" title={rail ? 'Account settings' : undefined} onNavigate={close}><span className="account-avatar" id="account-avatar" aria-hidden="true">{(me.account.name || me.account.email).slice(0, 1).toUpperCase()}</span><span className="sidebar-account-copy"><strong id="account-name">{me.account.name || me.account.email}</strong><span>{me.account.email}</span></span><Icon>{icons.settings}</Icon></Link></div>
      </div>
    </aside>
  </>;
}
