'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { QueryClient, QueryClientProvider, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type ApiOptions } from '../../lib/api';
import { bytes, captureKinds, capturesPath, dashboardHref, messageFor, parseDashboardState, savedCaptureHref, rememberLibraryScroll, returnToLibraryScroll, restoreLibraryScroll, clearLibraryScroll, type Capture, type CapturePage, type DashboardState, type ExtensionStatus, type PreferenceEnvelope } from '../../lib/dashboard';
import { customerConfig, extensionMessage } from '../../lib/platforms';
import type { Me } from '../../lib/types';
import { DashboardContext } from './context';
import { MasonryGrid } from './masonry-grid';
import { compareRecent } from '../../../../packages/shared/src/collection-presentation';
import { CloseIcon, ConfirmDialog, Dialog, type Confirmation } from './dialog';
import { Sidebar, type AccountSection } from './sidebar';
import { PreviewQueue, PreviewQueueContext } from './dashboard-image';
import { useEntrance } from './motion';
import { ContentSkeleton, RefreshIcon, SectionLoading, Spinner } from './loading';
import Note from './note-dialog';
import './dashboard.css';
import './account-pages.css';
import './sidebar.css';
const Collections = dynamic(() => import('../collections/manager'), { loading: () => <SectionLoading label="Opening collections…" /> });
const Devices = dynamic(() => import('./devices'), { loading: () => <SectionLoading label="Opening apps & devices…" /> });
const Agents = dynamic(() => import('./agents'), { loading: () => <SectionLoading label="Opening agent connections…" /> });
const Plans = dynamic(() => import('./plans'), { loading: () => <SectionLoading label="Opening plans & usage…" kind="plan" /> });
const Settings = dynamic(() => import('./settings'), { loading: () => <SectionLoading label="Opening settings…" /> });
const Detail = dynamic(() => import('./detail-dialog'), { loading: () => <aside className="capture-detail-panel"><SectionLoading label="Opening capture…" kind="detail" /></aside> });
export interface DashboardProps { me: Me; initialCaptures?: CapturePage; initialState: DashboardState; initialError?: string; readingPage?: boolean; initialCapture?: Capture; captureError?: string; section?: AccountSection; collectionId?:string }
export default function Dashboard(props: DashboardProps) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15000, refetchOnWindowFocus: false }, mutations: { retry: false } } }));
  const [previewQueue] = useState(() => new PreviewQueue(2));
  const [expired, setExpired] = useState<string | null>(null);
  const expiredRef = useRef(false);
  const mounted = useRef(true);
  const lifetime = useRef<AbortController | null>(null);
  const endSession = useCallback((code = '') => {
    if (expiredRef.current) return;
    expiredRef.current = true;
    lifetime.current?.abort();
    clearLibraryScroll(props.me.account.id);
    void client.cancelQueries();
    client.clear(); previewQueue.clear();
    flushSync(() => setExpired(code));
  }, [client]);
  const request = useCallback(async <T,>(path: string, options: ApiOptions = {}): Promise<T> => {
    // StrictMode can replay child effects before the parent effect reconnects.
    if (!mounted.current) await Promise.resolve();
    if (expiredRef.current || !mounted.current) throw new DOMException('This library is no longer active.', 'AbortError');
    const controller = lifetime.current ||= new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const result = await api<T>(path, { ...options, signal, accountId: props.me.account.id });
    if (expiredRef.current || !mounted.current || controller.signal.aborted || lifetime.current !== controller) throw new DOMException('This library is no longer active.', 'AbortError');
    return result;
  }, [props.me.account.id]);
  useEffect(() => {
    mounted.current = true;
    if (!lifetime.current || lifetime.current.signal.aborted) lifetime.current = new AbortController();
    const controller = lifetime.current;
    const expired = (event: Event) => endSession((event as CustomEvent<{ code?: string }>).detail?.code);
    const restored = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener('atlas-session-expired', expired);
    window.addEventListener('pageshow', restored);
    return () => { mounted.current = false; controller.abort(); if (lifetime.current === controller) lifetime.current = null; window.removeEventListener('atlas-session-expired', expired); window.removeEventListener('pageshow', restored); void client.cancelQueries(); client.clear(); previewQueue.clear(); };
  }, [endSession, client]);
  return <QueryClientProvider client={client}><PreviewQueueContext.Provider value={previewQueue}>{expired !== null ? <div className="customer-body dashboard-body"><div className="library-shell"><main className="library-main"><h1>Your library.</h1><p>Log in to open your private library.</p><div id="capture-grid" /><textarea id="note-text" hidden readOnly value="" /></main></div><Dialog id="session-dialog" className="confirm-dialog session-dialog" labelledBy="session-title" preventClose><div className="dialog-content"><h2 id="session-title">Log in to your library.</h2><p className="muted" id="session-description">{expired === 'account_changed' ? 'Your signed-in account changed in another tab. This action was stopped to protect your collection. Log in again to open the correct library.' : 'Your session has ended. Log in again to continue collecting.'}</p><a className="button primary wide" href="/login">Log in</a><a className="text-link" href="/signup">Create an account</a></div></Dialog></div> : <Library {...props} request={request} endSession={endSession} />}</PreviewQueueContext.Provider></QueryClientProvider>;
}
function Library({ me: initialMe, initialCaptures, initialState, initialError, readingPage, initialCapture, captureError, section, collectionId, request, endSession }: DashboardProps & { request: <T>(path: string, options?: ApiOptions) => Promise<T>; endSession: (code?: string) => void }) {
  const client = useQueryClient();
  const [state, setState] = useState(initialState);
  const stateRef = useRef(state); stateRef.current = state;
  const [search, setSearch] = useState(state.q);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const [extension, setExtension] = useState<ExtensionStatus | null>(null);
  const detection = useRef(0);
  const alive = useRef(true);
  const [toastText, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pageMessage, setPageMessage] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const confirmationRef = useRef<Confirmation | null>(null);
  const [noteLoaded, setNoteLoaded] = useState(state.panel === 'note');
  const [refreshing, setRefreshing] = useState(false);
  const pageRef = useEntrance<HTMLElement>(true, '.library-header > *, .account-page > nav, .account-page > section');
  const toastRef = useEntrance<HTMLDivElement>(toastText);
  const accountId = initialMe.account.id;
  const navigate = useCallback((changes: Partial<DashboardState>, replace = false) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const next = parseDashboardState(new URLSearchParams({ ...stateRef.current, ...changes }));
    const destination = readingPage ? `${savedCaptureHref(initialState.item, next)}${next.panel ? `${next.q || next.type ? '&' : '?'}panel=${next.panel}` : ''}` : dashboardHref(next);
    window.history[replace ? 'replaceState' : 'pushState'](null, '', destination);
    setState(next); setSearch(next.q);
    if (next.panel === 'note') setNoteLoaded(true);
  }, []);
  const closePanel = useCallback(() => {
    if (readingPage && stateRef.current.panel) { navigate({ panel: '' }); return; }
    if (readingPage) { returnToLibraryScroll(accountId); window.location.assign(dashboardHref({ ...stateRef.current, item: '', panel: '' })); return; }
    navigate({ item: '', panel: '' });
  }, [navigate, readingPage]);
  const toast = useCallback((message: string) => { setToast(message); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 5000); }, []);
  const confirm = useCallback((title: string, description: string, label = 'Continue') => new Promise<boolean>(resolve => { confirmationRef.current?.resolve(false); const next = { title, description, label, resolve }; confirmationRef.current = next; setConfirmation(next); }), []);
  const finishConfirmation = useCallback((accepted: boolean) => { confirmationRef.current?.resolve(accepted); confirmationRef.current = null; setConfirmation(null); }, []);
  const account = useQuery({ queryKey: ['me', accountId], initialData: initialMe, staleTime: 0, queryFn: async ({ signal }) => {
    const result = await request<Me>('/me', { signal });
    if (result.account.id !== accountId) { endSession('account_changed'); throw new ApiError('Your signed-in account changed.', 409, 'account_changed'); }
    return result;
  }, refetchInterval: 15000, refetchIntervalInBackground: false });
  const me = account.data;
  const preferences = useQuery({ queryKey: ['preferences', accountId], queryFn: ({ signal }) => request<PreferenceEnvelope>('/preferences', { signal }), staleTime: 0, enabled: !section || section === 'capture' });
  const captures = useInfiniteQuery({ queryKey: ['captures', accountId, state.q, state.type], queryFn: ({ pageParam, signal }) => request<CapturePage>(capturesPath(state, pageParam), { signal }), initialPageParam: undefined as string | undefined, getNextPageParam: page => page.nextCursor || undefined, initialData: initialCaptures && state.q === initialState.q && state.type === initialState.type ? { pages: [initialCaptures], pageParams: [undefined] } : undefined, enabled: !readingPage && !section, refetchOnWindowFocus: true, refetchInterval: 15000, refetchIntervalInBackground: false });
  const pages = captures.data?.pages || [];
  const unique = new Map<string, Capture>();
  for (const page of pages) for (const capture of page.captures) if (!unique.has(capture.id)) unique.set(capture.id, capture);
  const items = [...unique.values()].sort(compareRecent);
  const total = pages[0]?.total || 0;
  const refreshAccount = useCallback(async () => { const result = await account.refetch({ throwOnError: true }); if (result.error) throw result.error; }, [account.refetch]);
  const detectExtension = useCallback(async () => {
    const serial = ++detection.current;
    const config = await customerConfig();
    if (!alive.current) return null;
    return await new Promise<ExtensionStatus | null>(resolve => {
      let remaining = config.extensionIds.length;
      let best: ExtensionStatus | null = null;
      if (!remaining) { setExtension(null); resolve(null); return; }
      const report = () => { if (alive.current && detection.current === serial) setExtension(best); };
      for (const id of config.extensionIds) void extensionMessage<ExtensionStatus['result']>({ kind: 'atlas-ping' }, id).then(result => {
        if (!best || result.account?.id === accountId) best = { id, result };
        report();
        if (best.result.account?.id === accountId) resolve(alive.current ? best : null);
      }).catch(() => {}).finally(() => { if (--remaining === 0) { report(); resolve(alive.current ? best : null); } });
    });
  }, [accountId]);
  const refresh = useCallback(async () => {
    setRefreshing(true); setPageMessage('');
    try { await Promise.all([refreshAccount(), client.invalidateQueries({ queryKey: ['captures', accountId] }), client.invalidateQueries({ queryKey: ['capture', accountId] })]); }
    catch (error) { if (alive.current) setPageMessage(messageFor(error)); }
    finally { if (alive.current) setRefreshing(false); }
  }, [accountId, client, refreshAccount]);
  useEffect(() => {
    alive.current = true;
    const readLocation = () => { if (searchTimer.current) clearTimeout(searchTimer.current); const next = parseDashboardState(new URLSearchParams(window.location.search)); if (window.location.hash === '#devices' || next.panel === 'devices') { window.location.replace('/dashboard/apps'); return; } if (window.location.hash === '#extension-settings' || next.panel === 'settings') { window.location.replace(window.location.hash === '#extension-settings' ? '/dashboard/settings/capture' : '/dashboard/settings'); return; } if (readingPage) next.item = initialState.item; setState(next); setSearch(next.q); if (next.panel === 'note') setNoteLoaded(true); };
    readLocation(); if (!readingPage && !section) restoreLibraryScroll(accountId); void detectExtension();
    const focus = () => { void Promise.allSettled([refreshAccount(), detectExtension(), ...(!section || section === 'capture' ? [preferences.refetch()] : [])]); };
    const online = () => { toast('You’re back online. Refreshing your library.'); void refresh(); };
    const offline = () => setPageMessage('You’re offline. Reconnect to load or save cloud captures. Your iPhone app and extension keep pending saves on their devices.');
    const keydown = (event: KeyboardEvent) => { if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !document.querySelector('dialog[open], [aria-modal="true"]') && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName || '') && !(document.activeElement as HTMLElement)?.isContentEditable) { event.preventDefault(); searchField.current?.focus(); } };
    window.addEventListener('popstate', readLocation); window.addEventListener('hashchange', readLocation); window.addEventListener('focus', focus); window.addEventListener('online', online); window.addEventListener('offline', offline); document.addEventListener('keydown', keydown);
    return () => { alive.current = false; detection.current++; confirmationRef.current?.resolve(false); if (toastTimer.current) clearTimeout(toastTimer.current); if (searchTimer.current) clearTimeout(searchTimer.current); window.removeEventListener('popstate', readLocation); window.removeEventListener('hashchange', readLocation); window.removeEventListener('focus', focus); window.removeEventListener('online', online); window.removeEventListener('offline', offline); document.removeEventListener('keydown', keydown); };
  }, []);
  const openCapture = useCallback((id: string) => {
    const next = { ...stateRef.current, item: id, panel: '' as const };
    if (window.matchMedia('(max-width: 760px)').matches) { rememberLibraryScroll(accountId); const search = new URLSearchParams(); if (next.q) search.set('q', next.q); if (next.type) search.set('type', next.type); window.location.assign(`/dashboard/saved/${encodeURIComponent(id)}${search.size ? `?${search}` : ''}`); }
    else navigate({ item: id, panel: '' });
  }, [navigate]);
  const openNote = () => { if (preferences.data?.preferences.capture.note === true) navigate({ panel: 'note', item: '' }); else toast('Notes are disabled in extension settings.'); };
  const resetFilters = () => navigate({ q: '', type: '', item: '', panel: '' });
  const activeItem = state.item;
  const listFailed = captures.isError && !items.length;
  const statusMessage = pageMessage || (captures.isError && items.length ? messageFor(captures.error) : '') || (account.isError ? messageFor(account.error) : '');
  return <DashboardContext.Provider value={{ me, request, confirm, toast, refresh, refreshAccount, detectExtension, extension, preferences: preferences.data, closePanel, endSession }}><div className={`customer-body dashboard-body${activeItem && !readingPage ? ' has-capture-panel' : ''}${readingPage ? ' saved-reading-page' : ''}${section ? ' has-account-page' : ''}`}>
    <a className="skip-link" href="#main">Skip to content</a><div className="library-shell"><Sidebar me={me} section={section} collectionId={collectionId} libraryHref={readingPage ? dashboardHref({ ...state, item: '', panel: '' }) : '/dashboard'} onLibrary={section ? undefined : readingPage ? closePanel : resetFilters} /><main ref={pageRef} className="library-main" id="main">
      {section ? <div className="account-page">{statusMessage ? <p className="form-message is-error" role="alert">{statusMessage}<button className="subtle-button" onClick={() => void refresh()}>Try again</button></p> : null}{section === 'collections' ? <Collections id={collectionId} /> : section === 'apps' ? <Devices /> : section === 'agents' ? <Agents /> : section === 'plans' ? <Plans /> : <Settings section={section} />}</div> : <>
      {readingPage ? <Link className="text-link reading-back" onClick={() => returnToLibraryScroll(accountId)} href={dashboardHref({ ...state, item: '', panel: '' })}>← Back to library</Link> : <>
      <header className="library-header compact-library-header"><div className="library-heading"><h1>Your library.</h1><p id="library-description">Recently saved · {me.usage.captures.toLocaleString('en-US')} {me.usage.captures === 1 ? 'find' : 'finds'}</p></div><label className="search-field"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg><span className="sr-only">Search captures</span><input ref={searchField} id="search" type="search" placeholder="Find something you saved…" autoComplete="off" maxLength={200} value={search} onChange={event => { const value = event.target.value; setSearch(value); if (searchTimer.current) clearTimeout(searchTimer.current); searchTimer.current = setTimeout(() => navigate({ q: value }), 250); }} /><kbd aria-hidden="true">/</kbd></label><button className="button primary" id="new-note" type="button" disabled={preferences.data?.preferences.capture.note !== true} title={preferences.data?.preferences.capture.note === false ? 'Notes are disabled in extension settings.' : preferences.isPending ? 'Loading extension settings…' : ''} onClick={openNote}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>New note</button><button className="button secondary compact refresh-button" id="refresh-library" type="button" aria-label="Refresh library" title="Refresh library" aria-busy={refreshing} disabled={refreshing || captures.isFetching} onClick={() => void refresh()}><RefreshIcon active={refreshing} /></button></header>
      </>}
      <div id="page-message" className="form-message is-error" role="alert" hidden={!statusMessage}>{statusMessage}{statusMessage ? <button className="subtle-button" type="button" onClick={() => { if (captures.isFetchNextPageError) void captures.fetchNextPage(); else void refresh(); }}>Try again</button> : null}</div>
      {readingPage ? <Detail id={activeItem} fullPage initialCapture={initialCapture} initialError={captureError} state={state} /> : <div className="collection-workspace"><section className="collection" aria-label="Saved captures"><div className="filter-row"><div className="type-filters" role="group" aria-label="Filter by capture type">{([['', 'All captures'], ...Object.entries(captureKinds).map(([key, value]) => [key, key === 'audio' ? 'Audio' : key === 'selection' ? 'Highlights' : `${value}s`])] as [DashboardState['type'], string][]).map(([type, label]) => <button type="button" key={type} data-type={type} aria-pressed={state.type === type} onClick={() => { navigate({ type, q: type ? search.trim() : '' }); if (!type) void refresh(); }}>{label}</button>)}</div><p className="results-count" id="results-count" role="status" aria-live="polite">{captures.data ? `${total.toLocaleString('en-US')} ${total === 1 ? 'capture' : 'captures'}${state.q ? ` for “${state.q}”` : ''}` : ''}</p></div>
      {captures.isPending || listFailed || !items.length ? <div className={`library-state${captures.isPending ? ' is-loading' : ''}`} id="library-state" role="status" aria-busy={captures.isPending}><h2>{captures.isPending ? 'Opening your library…' : listFailed ? 'Your library couldn’t load.' : state.q || state.type ? 'No finds this time.' : 'Your first good find goes here.'}</h2><p>{captures.isPending ? 'Finding your saved things.' : listFailed ? messageFor(captures.error) || initialError : state.q || state.type ? 'Try a different keyword or clear your filters to see your collection.' : 'Share something from iPhone, save it with the browser extension, or write a note to get your collection started.'}</p>{captures.isPending ? <ContentSkeleton kind="library" /> : <button className="button secondary" type="button" onClick={listFailed ? () => void captures.refetch() : state.q || state.type ? resetFilters : openNote}>{listFailed ? 'Try again' : state.q || state.type ? 'Clear filters' : 'Write a first note'}</button>}</div> : <div id="library-state" hidden />}
      <MasonryGrid items={items} open={openCapture} selected={activeItem} busy={captures.isFetching} /><div className="load-more-wrap"><button className="button secondary" id="load-more" type="button" hidden={!captures.hasNextPage} disabled={captures.isFetching} onClick={() => void captures.fetchNextPage()}>{captures.isFetchingNextPage ? <><Spinner />Loading more…</> : captures.isFetchNextPageError ? 'Retry loading more' : 'Load more captures'}</button></div></section>{activeItem ? <Detail key={activeItem} id={activeItem} state={state} /> : null}</div>}
      </>}<noscript><style>{'.dashboard-body [data-local-image="true"] .capture-image-skeleton{display:none!important}.dashboard-body [data-local-image="true"] img{opacity:1!important}'}</style><p className="form-message">Your saved captures are shown above. Enable JavaScript to search, edit, and manage your library.</p></noscript><footer className="library-footer"><span>Saved with intention.</span><span id="usage-summary">{me.usage.captures.toLocaleString('en-US')} captures · {bytes(me.usage.bytes)}</span></footer></main></div>
      {noteLoaded ? <Note open={state.panel === 'note'} /> : null}<ConfirmDialog confirmation={confirmation} finish={finishConfirmation} /><div ref={toastRef} className="toast" id="toast" role="status" hidden={!toastText}>{toastText}</div>
    </div></DashboardContext.Provider>;
}
