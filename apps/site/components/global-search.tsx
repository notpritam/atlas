'use client';

import { Command } from 'cmdk';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { captureTitle, kindLabel, type Capture, type CapturePage } from '../lib/dashboard';
import type { CollectionList, SharedCollection } from '../lib/collections';
import { Dialog } from './dashboard/dialog';
import { ContentSkeleton } from './dashboard/loading';
import './global-search.css';

const destinations = [
  ['My library', '/dashboard'], ['Collections', '/dashboard/collections'], ['Explore collections', '/collections'],
  ['Settings', '/dashboard/settings'], ['Apps & devices', '/dashboard/apps'], ['Plans & usage', '/dashboard/plans'], ['Support', '/support'],
];
export function GlobalSearch() {
  const router = useRouter(), pathname = usePathname();
  const [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const [results, setResults] = useState<{ captures: Capture[]; collections: SharedCollection[]; accountId: string | null } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const previousPath = useRef(pathname);
  useEffect(() => {
    const show = () => { setQuery(''); setResults(null); setOpen(true); };
    const key = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.isComposing) {
        event.preventDefault(); setOpen(value => !value); setQuery(''); setResults(null);
      }
    };
    const clear = () => { setOpen(false); setResults(null); setQuery(''); };
    const hidden = () => { if (document.visibilityState === 'hidden') clear(); };
    window.addEventListener('foundkeep:search', show); document.addEventListener('keydown', key);
    window.addEventListener('atlas-session-expired', clear); window.addEventListener('blur', clear); window.addEventListener('pageshow', clear); document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('foundkeep:search', show); document.removeEventListener('keydown', key); window.removeEventListener('atlas-session-expired', clear); window.removeEventListener('blur', clear); window.removeEventListener('pageshow', clear); document.removeEventListener('visibilitychange', hidden); };
  }, []);
  useEffect(() => { if (previousPath.current !== pathname) setOpen(false); previousPath.current = pathname; }, [pathname]);
  useEffect(() => {
    if (!open) { setResults(null); return; }
    const controller = new AbortController();
    setBusy(true); setError(''); setResults(null);
    const timer = setTimeout(async () => {
      try {
        const session = await api<{ account: { id: string } | null }>('/auth/session', { signal: controller.signal });
        const accountId = session.account?.id || null;
        const options = { signal: controller.signal, ...(accountId ? { accountId } : {}) };
        const q = query.trim();
        const [captures, collections] = await Promise.all([
          accountId ? api<CapturePage>('/captures?' + new URLSearchParams({ q, limit: '8' }), options) : Promise.resolve({ captures: [] }),
          accountId ? api<CollectionList>('/collections', options) : api<{ collections: SharedCollection[] }>('/public/collections?' + new URLSearchParams({ q }), options),
        ]);
        if (!controller.signal.aborted) setResults({ accountId, captures: captures.captures.slice(0, 8), collections: collections.collections.filter(c => !q || `${c.title} ${c.description || ''}`.toLowerCase().includes(q.toLowerCase())).slice(0, 6) });
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Search could not load. Please try again.'); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }, query ? 200 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, query, retry]);
  const go = (href: string) => { setOpen(false); setResults(null); if (href.startsWith('/dashboard') && !pathname.startsWith('/dashboard')) { window.location.assign(href); return; } router.push(href); };
  const routes = destinations.filter(([label]) => label.toLowerCase().includes(query.trim().toLowerCase()));
  if (!open) return null;
  return <Dialog id="global-search" className="command-dialog" labelledBy="command-title" onClose={() => setOpen(false)} initialFocus="[cmdk-input]" dismissOnBackdrop><h2 id="command-title" className="sr-only">Search FoundKeep</h2><Command className="command-menu" label="Search FoundKeep" shouldFilter={false} loop>
    <div className="command-input-row"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><Command.Input id="command-input" autoFocus placeholder="Search your finds, collections, or pages…" value={query} onValueChange={setQuery} maxLength={200}/><button type="button" aria-label="Close search" onClick={() => setOpen(false)}><kbd>Esc</kbd></button></div>
    <Command.List aria-busy={busy}>
      {busy ? <div className="command-loading" role="status"><span className="sr-only">Searching…</span><ContentSkeleton kind="settings" /></div> : null}
      {error ? <div className="command-error" role="alert"><p>{error}</p><button onClick={() => setRetry(value => value + 1)}>Try again</button></div> : null}
      {results?.captures.length ? <Command.Group heading={query ? 'Your finds' : 'Recently saved'}>{results.captures.map(c => <Command.Item key={c.id} value={`capture-${c.id}`} onSelect={() => go(`/dashboard?item=${encodeURIComponent(c.id)}`)}><span className="command-result-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4Z"/></svg></span><span className="command-result-copy"><strong>{captureTitle(c)}</strong><small>{kindLabel(c.type)}</small></span><span className="command-enter" aria-hidden="true">↵</span></Command.Item>)}</Command.Group> : null}
      {results?.collections.length ? <Command.Group heading="Collections">{results.collections.map(c => <Command.Item key={c.id} value={`collection-${c.id}`} onSelect={() => go(results.accountId ? `/dashboard/collections/${c.id}` : `/collection/${c.slug}`)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V4h7l3 3h8v13H3Z"/></svg><span>{c.title}</span></Command.Item>)}</Command.Group> : null}
      {routes.length ? <Command.Group heading="Go to">{routes.map(([label, href]) => <Command.Item key={href} value={href} onSelect={() => go(href)}>{label}<span className="command-enter" aria-hidden="true">↵</span></Command.Item>)}</Command.Group> : null}
      {!busy && !error && !results?.captures.length && !results?.collections.length && !routes.length ? <Command.Empty>No matches. Try another word.</Command.Empty> : null}
    </Command.List><footer className="command-footer"><span>↑ ↓ to navigate</span><span>↵ to open</span><span>Search FoundKeep</span></footer>
  </Command></Dialog>;
}
