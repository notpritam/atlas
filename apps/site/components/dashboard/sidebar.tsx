'use client';

import Link from 'next/link';
import { useLayoutEffect, useRef, useState } from 'react';
import { NavigationPending } from './loading';
import { gsap, motionAllowed } from './motion';
import type { Me } from '../../lib/types';
import './sidebar.css';

export type AccountSection = 'collections' | 'apps' | 'agents' | 'settings' | 'capture' | 'processing' | 'plans';
const collapsePreference = 'foundkeep.sidebar.collapsed';
export function Sidebar({ me, section, libraryHref = '/dashboard', onLibrary }: { me: Me; section?: AccountSection; libraryHref?: string; onLibrary?: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const previousMain = useRef<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const restore = () => { try { setCollapsed(localStorage.getItem(collapsePreference) === 'true'); } catch { /* The control still works when storage is unavailable. */ } };
    restore();
    const changed = (event: StorageEvent) => { if (event.key === collapsePreference || event.key === null) restore(); };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  useLayoutEffect(() => {
    const previous = previousMain.current;
    previousMain.current = null;
    const main = ref.current?.parentElement?.querySelector<HTMLElement>(':scope > main');
    if (!previous || !main) return;
    const next = main.getBoundingClientRect();
    const media = gsap.matchMedia();
    media.add(motionAllowed, () => {
      gsap.fromTo(main, { x: previous.left - next.left, y: previous.top - next.top }, { x: 0, y: 0, duration: 0.24, ease: 'power2.out', clearProps: 'transform' });
    });
    return () => media.revert();
  }, [collapsed]);
  const toggle = () => {
    const main = ref.current?.parentElement?.querySelector<HTMLElement>(':scope > main');
    if (main) { const bounds = main.getBoundingClientRect(); previousMain.current = { left: bounds.left, top: bounds.top }; }
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(collapsePreference, String(next)); } catch { /* A visual preference must not block navigation. */ }
  };
  const settings = section === 'settings' || section === 'capture' || section === 'processing';
  const links = [
    { href: libraryHref, id: 'all-captures', label: 'My library', active: !section, icon: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></> },
    { href: '/dashboard/collections', id: 'open-collections', label: 'Collections', active: section === 'collections', icon: <><rect x="4" y="7" width="16" height="14" rx="2"/><path d="M8 7V3h8v4M8 12h8m-8 4h5"/></> },
    { href: '/dashboard/agents', id: 'open-agents', label: 'Agents', active: section === 'agents', icon: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /><path d="M10 6h4a4 4 0 0 1 4 4v4M6 10v4a4 4 0 0 0 4 4h4" /></> },
    { href: '/dashboard/apps', id: 'open-setup', label: 'Apps & devices', active: section === 'apps', icon: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></> },
    { href: '/dashboard/plans', id: 'open-plans', label: 'Plans & usage', active: section === 'plans', icon: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M7 15h4" /></> },
    { href: '/dashboard/settings', id: 'open-settings', label: 'Settings', active: settings, icon: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></> },
  ];
  return <aside ref={ref} className="library-sidebar" data-collapsed={collapsed}>
    <div className="sidebar-heading"><Link className="brand" href="/" aria-label="Foundkeep home"><img src="/assets/studio-mark.svg?v=bookmark-evolved-1" width="34" height="34" alt="" /><span>Foundkeep</span></Link>
      <button id="toggle-sidebar" className="sidebar-toggle" type="button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} aria-controls="workspace-navigation" onClick={toggle}><svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /><path d={collapsed ? 'm13 9 3 3-3 3' : 'm16 9-3 3 3 3'} /></svg><span className="sidebar-toggle-label">{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span></button>
    </div>
    <nav className="library-nav" id="workspace-navigation" aria-label="Your workspace">{links.map(link => <Link key={link.id} id={link.id} href={link.href} aria-label={link.label} title={collapsed ? link.label : undefined} className={link.active ? 'nav-active' : undefined} aria-current={link.active ? 'page' : undefined} prefetch={false} onNavigate={link.id === 'all-captures' && onLibrary ? event => { event.preventDefault(); onLibrary(); } : undefined}><svg aria-hidden="true" viewBox="0 0 24 24">{link.icon}</svg><span className="sidebar-nav-label">{link.label}</span>{link.id === 'all-captures' ? <span id="nav-count">{me.usage.captures.toLocaleString('en-US')}</span> : null}<NavigationPending /></Link>)}</nav>
    <div className="sidebar-bottom"><p>Your next good find<br />belongs here.</p>
      <Link className="account-button" id="open-account" href="/dashboard/settings" aria-label="Account & settings" title={collapsed ? 'Account & settings' : undefined} prefetch={false}><span className="account-avatar" id="account-avatar" aria-hidden="true">{(me.account.name || me.account.email).slice(0, 1).toUpperCase()}</span><span className="sidebar-account-copy"><strong id="account-name">{me.account.name || me.account.email}</strong><span>Account &amp; settings</span></span><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg><span className="sidebar-account-tooltip" aria-hidden="true">Account &amp; settings</span><NavigationPending /></Link>
      <Link className="sidebar-footer-link" href="/support" aria-label="Support" title={collapsed ? 'Support' : undefined}><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01" /></svg><span className="sidebar-nav-label">Support</span></Link><Link className="sidebar-footer-link" href="/privacy" aria-label="Privacy & data" title={collapsed ? 'Privacy & data' : undefined}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Z" /><path d="m8 12 3 3 5-5" /></svg><span className="sidebar-nav-label">Privacy &amp; data</span></Link>
    </div>
  </aside>;
}
