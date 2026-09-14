'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { captureKinds, capturesPath, dashboardHref, messageFor, parseDashboardState, savedCaptureHref, returnToLibraryScroll, restoreLibraryScroll, type Capture, type CapturePage, type DashboardState } from '../../lib/dashboard';
import type { Me } from '../../lib/types';
import { DashboardContext, useDashboard } from './context';
import { useRouter, useSearchParams } from 'next/navigation';
import { SegmentedControl } from '../ui/segmented-control';
import { MasonryGrid } from './masonry-grid';
import { compareRecent } from '../../../../packages/shared/src/collection-presentation';
import { ContentSkeleton, RefreshIcon, Spinner } from './loading';
import Note from './note-dialog';
import {AccountBoundary} from './account-boundary';
import Detail from './detail-dialog';
export interface DashboardProps { me: Me; initialCaptures?: CapturePage; initialState: DashboardState; initialError?: string; readingPage?: boolean; initialCapture?: Capture; captureError?: string }
export default function Dashboard(props: DashboardProps) {
  return <AccountBoundary accountId={props.me.account.id}><Library {...props}/></AccountBoundary>;
}
function Library({ me: initialMe, initialCaptures, initialState, initialError, readingPage, initialCapture, captureError }: DashboardProps) {
  const shared = useDashboard();
  const { me, request, refreshAccount, toast, preferences: savedPreferences } = shared;
  const router = useRouter();
  const params = useSearchParams();
  const client = useQueryClient();
  const [state, setState] = useState(initialState);
  const stateRef = useRef(state); stateRef.current = state;
  const [search, setSearch] = useState(state.q);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const [pageMessage, setPageMessage] = useState('');
  const [noteLoaded, setNoteLoaded] = useState(state.panel === 'note');
  const [refreshing, setRefreshing] = useState(false);
  const accountId = initialMe.account.id;
  const navigate = useCallback((changes: Partial<DashboardState>, replace = false) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const next = parseDashboardState(new URLSearchParams({ ...stateRef.current, ...changes }));
    const destination = readingPage ? `${savedCaptureHref(initialState.item, next)}${next.panel ? `${next.q || next.type ? '&' : '?'}panel=${next.panel}` : ''}` : dashboardHref(next);
    window.history[replace ? 'replaceState' : 'pushState'](null, '', destination);
    setState(next); setSearch(next.q);
    if (next.panel === 'note') setNoteLoaded(true);
  }, [readingPage, initialState.item]);
  const closePanel = useCallback(() => {
    if (readingPage && stateRef.current.panel) { navigate({ panel: '' }); return; }
    if (readingPage) { returnToLibraryScroll(accountId); router.push(dashboardHref({ ...stateRef.current, item: '', panel: '' })); return; }
    navigate({ item: '', panel: '' });
  }, [navigate, readingPage, accountId, router]);
  const preferences = { data: savedPreferences, isPending: !savedPreferences };
  const captures = useInfiniteQuery({ queryKey: ['captures', accountId, state.q, state.type], queryFn: ({ pageParam, signal }) => request<CapturePage>(capturesPath(state, pageParam), { signal }), initialPageParam: undefined as string | undefined, getNextPageParam: page => page.nextCursor || undefined, initialData: initialCaptures && state.q === initialState.q && state.type === initialState.type ? { pages: [initialCaptures], pageParams: [undefined] } : undefined, enabled: !readingPage, refetchOnWindowFocus: true, refetchInterval: 15000, refetchIntervalInBackground: false });
  const pages = captures.data?.pages || [];
  const unique = new Map<string, Capture>();
  for (const page of pages) for (const capture of page.captures) if (!unique.has(capture.id)) unique.set(capture.id, capture);
  const items = [...unique.values()].sort(compareRecent);
  const total = pages[0]?.total || 0;
  const refresh = useCallback(async () => {
    setRefreshing(true); setPageMessage('');
    try { await Promise.all([refreshAccount(), client.invalidateQueries({ queryKey: ['captures', accountId] }), client.invalidateQueries({ queryKey: ['capture', accountId] })]); }
    catch (error) { if (alive.current) setPageMessage(messageFor(error)); }
    finally { if (alive.current) setRefreshing(false); }
  }, [accountId, client, refreshAccount]);
  useEffect(() => {
    alive.current = true;
    const readLocation = () => { if (searchTimer.current) clearTimeout(searchTimer.current); const next = parseDashboardState(new URLSearchParams(window.location.search)); if (window.location.hash === '#devices' || next.panel === 'devices') { router.replace('/dashboard/apps'); return; } if (window.location.hash === '#extension-settings' || next.panel === 'settings') { router.replace(window.location.hash === '#extension-settings' ? '/dashboard/settings/capture' : '/dashboard/settings'); return; } if (readingPage) next.item = initialState.item; setState(next); setSearch(next.q); if (next.panel === 'note') setNoteLoaded(true); };
    readLocation(); if (!readingPage) restoreLibraryScroll(accountId);
    const online = () => { toast('You’re back online. Refreshing your library.'); void refresh(); };
    const offline = () => setPageMessage('You’re offline. Reconnect to load or save cloud captures. Your iPhone app and extension keep pending saves on their devices.');
    const keydown = (event: KeyboardEvent) => { if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !document.querySelector('dialog[open], [aria-modal="true"]') && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName || '') && !(document.activeElement as HTMLElement)?.isContentEditable) { event.preventDefault(); searchField.current?.focus(); } };
    window.addEventListener('popstate', readLocation); window.addEventListener('hashchange', readLocation); window.addEventListener('online', online); window.addEventListener('offline', offline); document.addEventListener('keydown', keydown);
    return () => { alive.current = false; if (searchTimer.current) clearTimeout(searchTimer.current); window.removeEventListener('popstate', readLocation); window.removeEventListener('hashchange', readLocation); window.removeEventListener('online', online); window.removeEventListener('offline', offline); document.removeEventListener('keydown', keydown); };
  }, []);
  useEffect(() => {
    const next = parseDashboardState(new URLSearchParams(params.toString()));
    if (readingPage) next.item = initialState.item;
    setState(next); setSearch(next.q);
    if (next.panel === 'note') setNoteLoaded(true);
  }, [params, readingPage, initialState.item]);
  const openCapture = useCallback((id: string) => navigate({ item: id, panel: '' }), [navigate]);
  const openNote = () => { if (preferences.data?.preferences.capture.note === true) navigate({ panel: 'note', item: '' }); else toast('Notes are disabled in extension settings.'); };
  const resetFilters = () => navigate({ q: '', type: '', item: '', panel: '' });
  const activeItem = state.item;
  const listFailed = captures.isError && !items.length;
  const statusMessage = pageMessage || (captures.isError && items.length ? messageFor(captures.error) : '');
  return <DashboardContext.Provider value={{ ...shared, refresh, closePanel }}>
      {readingPage ? null : <>
      <header className="library-header compact-library-header"><div className="library-heading"><h1>Your library.</h1><p id="library-description">Recently saved · {me.usage.captures.toLocaleString('en-US')} {me.usage.captures === 1 ? 'find' : 'finds'}</p></div><label className="search-field"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg><span className="sr-only">Search captures</span><input ref={searchField} id="search" type="search" placeholder="Find something you saved…" autoComplete="off" maxLength={200} value={search} onChange={event => { const value = event.target.value; setSearch(value); if (searchTimer.current) clearTimeout(searchTimer.current); searchTimer.current = setTimeout(() => navigate({ q: value }), 250); }} /><kbd aria-hidden="true">/</kbd></label><button className="button primary" id="new-note" type="button" disabled={preferences.data?.preferences.capture.note !== true} title={preferences.data?.preferences.capture.note === false ? 'Notes are disabled in extension settings.' : preferences.isPending ? 'Loading extension settings…' : ''} onClick={openNote}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>New note</button><button className="button secondary compact refresh-button" id="refresh-library" type="button" aria-label="Refresh library" title="Refresh library" aria-busy={refreshing} disabled={refreshing || captures.isFetching} onClick={() => void refresh()}><RefreshIcon active={refreshing} /></button></header>
      </>}
      <div id="page-message" className="form-message is-error" role="alert" hidden={!statusMessage}>{statusMessage}{statusMessage ? <button className="subtle-button" type="button" onClick={() => { if (captures.isFetchNextPageError) void captures.fetchNextPage(); else void refresh(); }}>Try again</button> : null}</div>
      {readingPage ? <Detail id={activeItem} fullPage initialCapture={initialCapture} initialError={captureError} state={state} /> : <div className="collection-workspace"><section className="collection" aria-label="Saved captures"><div className="filter-row"><SegmentedControl className="type-filters" label="Filter by capture type" value={state.type} dataAttribute="data-type" items={[{value:'',label:'All captures',count:me.usage.captures.toLocaleString('en-US')},...Object.entries(captureKinds).map(([key,label])=>({value:key,label:key==='audio'?'Audio':key==='selection'?'Highlights':`${label}s`}))]} onChange={type=>{navigate({type:type as DashboardState['type'],q:type?search.trim():''});}} /><p className="results-count" id="results-count" role="status" aria-live="polite">{captures.data ? `${total.toLocaleString('en-US')} ${total === 1 ? 'capture' : 'captures'}${state.q ? ` for “${state.q}”` : ''}` : ''}</p></div>
      {captures.isPending || listFailed || !items.length ? <div className={`library-state${captures.isPending ? ' is-loading' : ''}`} id="library-state" role="status" aria-busy={captures.isPending}><h2>{captures.isPending ? 'Opening your library…' : listFailed ? 'Your library couldn’t load.' : state.q || state.type ? 'No finds this time.' : 'Your first good find goes here.'}</h2><p>{captures.isPending ? 'Finding your saved things.' : listFailed ? messageFor(captures.error) || initialError : state.q || state.type ? 'Try a different keyword or clear your filters to see your collection.' : 'Share something from iPhone, save it with the browser extension, or write a note to get your collection started.'}</p>{captures.isPending ? <ContentSkeleton kind="library" /> : <button className="button secondary" type="button" onClick={listFailed ? () => void captures.refetch() : state.q || state.type ? resetFilters : openNote}>{listFailed ? 'Try again' : state.q || state.type ? 'Clear filters' : 'Write a first note'}</button>}</div> : <div id="library-state" hidden />}
      <MasonryGrid items={items} open={openCapture} selected={activeItem} busy={captures.isFetching} /><div className="load-more-wrap"><button className="button secondary" id="load-more" type="button" hidden={!captures.hasNextPage} disabled={captures.isFetching} onClick={() => void captures.fetchNextPage()}>{captures.isFetchingNextPage ? <><Spinner />Loading more…</> : captures.isFetchNextPageError ? 'Retry loading more' : 'Load more captures'}</button></div></section>{activeItem ? <Detail key={activeItem} id={activeItem} state={state} /> : null}</div>}
      <noscript><style>{'.dashboard-body [data-local-image="true"] .capture-image-skeleton{display:none!important}.dashboard-body [data-local-image="true"] img{opacity:1!important}'}</style><p className="form-message">Your saved captures are shown above. Enable JavaScript to search, edit, and manage your library.</p></noscript>
      {noteLoaded ? <Note open={state.panel === 'note'} /> : null}
    </DashboardContext.Provider>;

}
