'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type ApiOptions } from '../../lib/api';
import { bytes, clearLibraryScroll, messageFor, type ExtensionStatus, type PreferenceEnvelope } from '../../lib/dashboard';
import { customerConfig, extensionMessage } from '../../lib/platforms';
import type { Me } from '../../lib/types';
import { DashboardContext } from './context';
import { Sidebar, type AccountSection } from './sidebar';
import { ConfirmDialog, Dialog, type Confirmation } from './dialog';
import { PreviewQueue, PreviewQueueContext } from './dashboard-image';
import './dashboard.css';
import './account-pages.css';
import './sidebar.css';

export default function DashboardShell({ me, children }: { me: Me; children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30000, refetchOnWindowFocus: false }, mutations: { retry: false } } }));
  const [previewQueue] = useState(() => new PreviewQueue(2));
  const [expired, setExpired] = useState<string | null>(null);
  const expiredRef = useRef(false);
  const mounted = useRef(true);
  const lifetime = useRef<AbortController | null>(null);
  const endSession = useCallback((code = '') => {
    if (expiredRef.current) return;
    expiredRef.current = true;
    lifetime.current?.abort();
    clearLibraryScroll(me.account.id);
    void client.cancelQueries();
    client.clear(); previewQueue.clear();
    flushSync(() => setExpired(code));
  }, [client, me.account.id, previewQueue]);
  const request = useCallback(async <T,>(path: string, options: ApiOptions = {}): Promise<T> => {
    if (!mounted.current) await Promise.resolve();
    if (expiredRef.current || !mounted.current) throw new DOMException('This library is no longer active.', 'AbortError');
    const controller = lifetime.current ||= new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const result = await api<T>(path, { ...options, signal, accountId: me.account.id });
    if (expiredRef.current || !mounted.current || controller.signal.aborted || lifetime.current !== controller) throw new DOMException('This library is no longer active.', 'AbortError');
    return result;
  }, [me.account.id]);
  useEffect(() => {
    mounted.current = true;
    if (!lifetime.current || lifetime.current.signal.aborted) lifetime.current = new AbortController();
    const controller = lifetime.current;
    const expired = (event: Event) => endSession((event as CustomEvent<{ code?: string }>).detail?.code);
    window.addEventListener('atlas-session-expired', expired);
    return () => { mounted.current = false; controller.abort(); if (lifetime.current === controller) lifetime.current = null; window.removeEventListener('atlas-session-expired', expired); void client.cancelQueries(); client.clear(); previewQueue.clear(); };
  }, [endSession, client, previewQueue]);
  return <QueryClientProvider client={client}><PreviewQueueContext.Provider value={previewQueue}>{expired !== null ? <div className="customer-body dashboard-body"><main className="route-error"><h1>Your library.</h1><p>Log in to open your private library.</p><div id="capture-grid" /><textarea id="note-text" hidden readOnly value="" /></main><Dialog id="session-dialog" className="confirm-dialog session-dialog" labelledBy="session-title" preventClose><div className="dialog-content"><h2 id="session-title">Log in to your library.</h2><p className="muted">{expired === 'account_changed' ? 'Your signed-in account changed in another tab. Log in again to open the correct library.' : 'Your session has ended. Log in again to continue collecting.'}</p><a className="button primary wide" href="/login">Log in</a></div></Dialog></div> : <ShellContent me={me} request={request} endSession={endSession}>{children}</ShellContent>}</PreviewQueueContext.Provider></QueryClientProvider>;
}

function ShellContent({ me: initialMe, request, endSession, children }: { me: Me; request: <T>(path: string, options?: ApiOptions) => Promise<T>; endSession: (code?: string) => void; children: ReactNode }) {
  const client = useQueryClient(), pathname = usePathname(), router = useRouter();
  const accountId = initialMe.account.id;
  const part = pathname.split('/')[2];
  const section: AccountSection | undefined = part === 'settings' ? pathname.endsWith('/capture') ? 'capture' : pathname.endsWith('/processing') ? 'processing' : 'settings' : ['collections', 'apps', 'agents', 'plans', 'mind-map'].includes(part) ? part as AccountSection : undefined;
  const collectionId = section === 'collections' ? pathname.split('/')[3] : undefined;
  const readingPage = part === 'saved';
  const [restoring, setRestoring] = useState(false), [restoreError, setRestoreError] = useState('');
  const [extension, setExtension] = useState<ExtensionStatus | null>(null);
  const detection = useRef(0), alive = useRef(true);
  const [toastText, setToast] = useState(''), toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null), confirmationRef = useRef<Confirmation | null>(null);
  const account = useQuery({ queryKey: ['me', accountId], initialData: initialMe, queryFn: async ({ signal }) => {
    const result = await request<Me>('/me', { signal });
    if (result.account.id !== accountId) { endSession('account_changed'); throw new ApiError('Your signed-in account changed.', 409, 'account_changed'); }
    return result;
  }, refetchInterval: 15000, refetchIntervalInBackground: false, refetchOnWindowFocus: true });
  // The capture page owns the first request while its SSR boundary hydrates.
  const preferences = useQuery({ enabled: section !== 'capture', queryKey: ['preferences', accountId], queryFn: ({ signal }) => request<PreferenceEnvelope>('/preferences', { signal }), refetchOnWindowFocus: true });
  const refreshAccount = useCallback(async () => { await account.refetch({ throwOnError: true }); }, [account.refetch]);
  const refresh = useCallback(async () => { await Promise.all([refreshAccount(), client.invalidateQueries({ queryKey: ['captures', accountId] }), client.invalidateQueries({ queryKey: ['capture', accountId] })]); }, [accountId, client, refreshAccount]);
  const toast = useCallback((message: string) => { setToast(message); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 5000); }, []);
  const confirm = useCallback((title: string, description: string, label = 'Continue') => new Promise<boolean>(resolve => { confirmationRef.current?.resolve(false); const next = { title, description, label, resolve }; confirmationRef.current = next; setConfirmation(next); }), []);
  const finishConfirmation = useCallback((accepted: boolean) => { confirmationRef.current?.resolve(accepted); confirmationRef.current = null; setConfirmation(null); }, []);
  const detectExtension = useCallback(async () => {
    const serial = ++detection.current, config = await customerConfig();
    if (!alive.current) return null;
    let best: ExtensionStatus | null = null;
    await Promise.allSettled(config.extensionIds.map(async id => {
      const result = await extensionMessage<ExtensionStatus['result']>({ kind: 'atlas-ping' }, id);
      if (!best || result.account?.id === accountId) best = { id, result };
      if (alive.current && detection.current === serial) setExtension(best);
    }));
    if (alive.current && detection.current === serial) setExtension(best);
    return best;
  }, [accountId]);
  useEffect(() => {
    alive.current = true;
    void detectExtension();
    const focus = () => { void Promise.allSettled([refreshAccount(), preferences.refetch(), detectExtension()]); };
    const verifyRestored = async () => { setRestoring(true); setRestoreError(''); try { await refreshAccount(); if (alive.current) setRestoring(false); } catch { if (alive.current) setRestoreError('Reconnect to verify your session before opening your library.'); } };
    const leaving = () => { flushSync(() => setRestoring(true)); };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) void verifyRestored(); };
    window.addEventListener('pagehide', leaving);
    window.addEventListener('focus', focus); window.addEventListener('pageshow', restored);
    return () => { alive.current = false; detection.current++; confirmationRef.current?.resolve(false); if (toastTimer.current) clearTimeout(toastTimer.current); window.removeEventListener('focus', focus); window.removeEventListener('pageshow', restored); window.removeEventListener('pagehide', leaving); };
  }, [detectExtension, refreshAccount, preferences.refetch]);
  const me = account.data;
  return <DashboardContext.Provider value={{ me, request, endSession, preferences: preferences.data, refresh, refreshAccount, toast, confirm, extension, detectExtension, closePanel: () => router.push('/dashboard') }}><div className={`customer-body dashboard-body${readingPage ? ' saved-reading-page' : ''}${section ? ' has-account-page' : ''}${section === 'mind-map' ? ' has-mind-map' : ''}${restoring ? ' session-verifying' : ''}`}>
    {restoring ? <Dialog id="session-verification" className="session-verification" labelledBy="verification-title" preventClose><h1 id="verification-title">{restoreError ? 'Reconnect to your library' : 'Opening your library…'}</h1><p>{restoreError || 'Verifying your session.'}</p>{restoreError ? <button className="button secondary" onClick={async () => { setRestoreError(''); try { await refreshAccount(); setRestoring(false); } catch { setRestoreError('Reconnect to verify your session before opening your library.'); } }}>Try again</button> : null}</Dialog> : null}
    <a className="skip-link" href="#main">Skip to content</a><div className="library-shell"><Sidebar me={me} section={section} collectionId={collectionId} /><main className="library-main" id="main">{account.isError ? <p className="form-message is-error" role="alert">{messageFor(account.error)}<button className="subtle-button" onClick={() => void refreshAccount()}>Try again</button></p> : null}{children}<footer className="library-footer"><span>Saved with intention.</span><span id="usage-summary">{me.usage.captures.toLocaleString('en-US')} captures · {bytes(me.usage.bytes)}</span></footer></main></div>
    <ConfirmDialog confirmation={confirmation} finish={finishConfirmation} /><div className="toast" id="toast" role="status" hidden={!toastText}>{toastText}</div>
  </div></DashboardContext.Provider>;
}
