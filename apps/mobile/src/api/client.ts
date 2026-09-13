import { normalizeAutomation } from '../billing/automation.ts';
import { getEnvironment, getMobilePlatform } from '../environment.ts';
import type { Account, Capture, CaptureList, Folder, Organization, NativeSession, Usage, RelatedSave } from './types.ts';
import type { Plan, AutomationState, ProcessingState } from '../billing/types.ts';
import type { OAuthIntent, OAuthProvider } from '../auth-oauth.ts';

const REQUEST_TIMEOUT = 15_000;

function appNoteProvenance(capturedAt: number) {
  return {
    schemaVersion: 1, captureMethod: `${getMobilePlatform()}-app-note`, pageUrl: null, canonicalUrl: null,
    pageTitle: null, siteName: null, description: null, authors: [], publishedAt: null, modifiedAt: null,
    language: null, leadImageUrl: null, faviconUrl: null, targetUrl: null, headings: [], capturedAt,
    extractedAt: capturedAt, extractorVersion: 1, contentHash: null, extractionStatus: 'complete', extractionError: null,
  };
}

export class FoundkeepApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message.slice(0, 300));
    this.status = status;
    this.code = code;
  }
}

type ClientOptions = { getToken: () => Promise<string | null>; fetcher?: typeof fetch };
type JsonOptions = { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; authenticated?: boolean; cacheMs?: number; reload?: boolean; signal?: AbortSignal };
type ReadOptions = { reload?: boolean };

export function createFoundkeepClient({ getToken, fetcher = fetch }: ClientOptions) {
  // Private, short-lived memory cache. Never persist account content in public
  // storage, and never reuse a cache after its device credential changes.
  const cache = new Map<string, { value: unknown; expiresAt: number; bytes: number }>();
  const pending = new Map<string, Promise<unknown>>();
  let cacheBytes = 0;
  let generation = 0;
  let scope: string | null = null;
  const listeners = new Set<() => void>();
  const clearCache = () => { generation++; cache.clear(); pending.clear(); cacheBytes = 0; };
  const invalidate = () => { clearCache(); for (const listener of listeners) listener(); };
  function remember(path: string, value: unknown, bytes: number, ttl: number) {
    const previous = cache.get(path);
    if (previous) { cacheBytes -= previous.bytes; cache.delete(path); }
    if (bytes > 4 * 1024 * 1024) return;
    cache.set(path, { value, expiresAt: Date.now() + ttl, bytes }); cacheBytes += bytes;
    while (cache.size > 20 || cacheBytes > 4 * 1024 * 1024) {
      const key = cache.keys().next().value!;
      cacheBytes -= cache.get(key)!.bytes; cache.delete(key);
    }
  }
  async function request<T>(path: string, options: JsonOptions, token: string | null): Promise<{ value: T; bytes: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    try {
      const headers = new Headers({ accept: 'application/json' });
      if (options.body !== undefined) headers.set('content-type', 'application/json');
      if (options.authenticated !== false) {
        if (!token) throw new FoundkeepApiError(401, 'signed_out', 'Sign in to open your Foundkeep collection.');
        headers.set('authorization', `Bearer ${token}`);
      }
      const response = await fetcher(`${getEnvironment().origin}${path}`, {
        method: options.method || 'GET', headers, signal: controller.signal,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      // Capture responses can contain full articles. Truncating before JSON.parse
      // corrupts valid responses and makes populated collections appear broken.
      const raw = await response.text();
      let value: any = null;
      try { value = raw ? JSON.parse(raw) : null; } catch {}
      if (!response.ok) throw new FoundkeepApiError(response.status, String(value?.error || 'request_failed').slice(0, 80), String(value?.message || 'Foundkeep could not complete the request.'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new FoundkeepApiError(response.status, 'invalid_response', 'Foundkeep could not read the response. Please try again.');
      }
      return { value: value as T, bytes: raw.length * 2 };
    } catch (error) {
      if (error instanceof FoundkeepApiError) throw error;
      if ((error as Error)?.name === 'AbortError') throw new FoundkeepApiError(0, 'timeout', 'Foundkeep took too long to respond. Try again.');
      throw new FoundkeepApiError(0, 'offline', 'Foundkeep could not connect. Check your internet connection and try again.');
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
  }

  async function json<T>(path: string, options: JsonOptions = {}): Promise<T> {
    const token = options.authenticated === false ? null : await getToken();
    if (scope !== token) { clearCache(); scope = token; }
    if (options.authenticated !== false && !token) throw new FoundkeepApiError(401, 'signed_out', 'Sign in to open your Foundkeep collection.');
    if (options.method && options.method !== 'GET') {
      clearCache();
      try { return (await request<T>(path, options, token)).value; }
      finally { invalidate(); }
    }
    // Lifecycle-owned reads must be independently cancellable and cannot reuse a
    // request from an earlier focus/account. They never populate the detail cache.
    if (options.signal) {
      const result = await request<T>(path, options, token);
      if (options.signal.aborted || token !== await getToken()) throw new FoundkeepApiError(0, 'account_changed', 'The active account changed.');
      return result.value;
    }
    const cached = cache.get(path);
    if (!options.reload && cached && cached.expiresAt > Date.now()) {
      cache.delete(path); cache.set(path, cached);
      return cached.value as T;
    }
    const existing = pending.get(path);
    if (existing) return existing as Promise<T>;
    const started = generation;
    const operation = request<T>(path, options, token).then(({ value, bytes }) => {
      if (started === generation && options.cacheMs) remember(path, value, bytes, options.cacheMs);
      return value;
    }).catch(error => {
      if (started === generation && error instanceof FoundkeepApiError && error.status === 401) clearCache();
      throw error;
    }).finally(() => { if (pending.get(path) === operation) pending.delete(path); });
    pending.set(path, operation);
    return operation;
  }

  const devicePayload = <T extends { deviceName?: string }>(value: T) => ({ ...value, deviceName: value.deviceName?.trim() || 'iPhone' });
  return {
    invalidate,
    plan: () => json<Plan>('/api/plan'),
    purchaseCheck: (intent?:'purchase'|'restore') => json<Plan>('/api/billing/purchase-check',{method:'POST',body:{intent}}),
    cancelMobilePurchase: (attemptId:string) => json('/api/billing/revenuecat/purchase-cancelled',{method:'POST',body:{attemptId}}),
    automation: async () => normalizeAutomation(await json<AutomationState>('/api/automation')),
    updateAutomation: (value:Partial<Pick<AutomationState,'enabled'|'fetchLinks'|'images'|'consentVersion'|'mode'|'intervalHours'|'monthlyLimit'>>) => json<AutomationState>('/api/automation', {method:'PUT',body:value}).then(normalizeAutomation),
    processingState: (id:string, signal:AbortSignal) => json<ProcessingState>('/api/captures/'+encodeURIComponent(id)+'/processing',{signal}),
    processCapture: (id:string) => json<{id:string;status:string}>('/api/captures/'+encodeURIComponent(id)+'/process',{method:'POST',body:{}}),
    syncRevenueCat: () => json<Omit<Plan, 'billing'>>('/api/billing/revenuecat/sync', { method: 'POST' }),
    subscribeInvalidation(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    oauthProviders: () => json<{ providers: OAuthProvider[] }>(`/api/auth/providers?client=${getMobilePlatform()}`, { authenticated: false }),
    startOAuth(value: { provider: OAuthProvider; intent: OAuthIntent; codeChallenge: string }) {
      return json<{ flow: string; authorizeUrl: string }>('/api/auth/oauth/start', { method: 'POST', body: { ...value, client: getMobilePlatform(), deviceName: getMobilePlatform() === 'android' ? 'Android' : 'iPhone' }, authenticated: value.intent === 'delete' });
    },
    exchangeOAuth(value: { flow: string; code: string; verifier: string; password?: string }, intent: OAuthIntent) {
      return json<NativeSession | { reauthToken: string }>('/api/auth/oauth/exchange', { method: 'POST', body: value, authenticated: intent === 'delete' });
    },
    register(value: { email: string; name: string; password: string; deviceName?: string }) {
      return json<NativeSession>('/api/mobile/register', { method: 'POST', body: devicePayload(value), authenticated: false });
    },
    login(value: { email: string; password: string; deviceName?: string }) {
      return json<NativeSession>('/api/mobile/login', { method: 'POST', body: devicePayload(value), authenticated: false });
    },
    recover(value: { email: string; recoveryCode: string; password: string; deviceName?: string }) {
      return json<NativeSession>('/api/mobile/recover', { method: 'POST', body: devicePayload(value), authenticated: false });
    },
    me: () => json<{ account: Account; connectionId: string; usage: Usage }>('/api/mobile/me'),
    notificationStatus: () => json<{ enabled: boolean }>('/api/mobile/notifications'),
    registerNotifications: (expoPushToken: string) => json<{ ok: true }>('/api/mobile/notifications', { method: 'POST', body: { expoPushToken } }),
    unregisterNotifications: () => json<{ ok: true }>('/api/mobile/notifications', { method: 'DELETE' }),
    logout: () => json<{ ok: true }>('/api/mobile/logout', { method: 'POST' }),
    deleteAccount: (proof: string | { reauthToken: string }) => json<{ ok: true }>('/api/mobile/account', { method: 'DELETE', body: typeof proof === 'string' ? { password: proof } : proof }),
    listCaptures(filters: { q?: string; type?: string; cursor?: string; batchId?: string; folderId?: string; tag?: string }, options: ReadOptions = {}) {
      const query = new URLSearchParams({ view: 'cards', sort: 'recent' });
      if (filters.q) query.set('q', filters.q);
      if (filters.type) query.set('type', filters.type);
      if (filters.cursor) query.set('cursor', filters.cursor);
      if (filters.batchId) query.set('batchId', filters.batchId);
      if (filters.folderId) query.set('folderId', filters.folderId);
      if (filters.tag) query.set('tag', filters.tag);
      return json<CaptureList>(`/api/mobile/captures?${query}`, { cacheMs: 10_000, ...options });
    },
    createNote(value: { clientId: string; noteText: string; capturedAt: number; folderId?: string | null; userTags?: string[] }) {
      return json<{ capture: Capture; duplicate: boolean }>('/api/captures', { method: 'POST', body: { ...value, type: 'note', provenance: appNoteProvenance(value.capturedAt) } });
    },
    getCapture: (id: string, options: ReadOptions = {}) => json<{ capture: Capture }>(`/api/mobile/captures/${encodeURIComponent(id)}`, { cacheMs: 20_000, ...options }),
    relatedCaptures: (id: string, options: ReadOptions = {}) => json<{ items: RelatedSave[] }>(`/api/mobile/captures/${encodeURIComponent(id)}/related`, { cacheMs: 10_000, ...options }),
    updateCapture: (id: string, value: { sourceTitle: string | null; noteText: string | null; expectedUpdatedAt: number; folderId?: string | null; userTags?: string[] }) => json<{ capture: Capture }>(`/api/mobile/captures/${encodeURIComponent(id)}`, { method: 'PUT', body: value }),
    deleteCapture: (id: string) => json<{ ok: true }>(`/api/mobile/captures/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    organization: (options: ReadOptions = {}) => json<Organization>('/api/mobile/organization', { cacheMs: 30_000, ...options }),
    createFolder: (name: string) => json<{ folder: Folder }>('/api/mobile/folders', { method: 'POST', body: { name } }),
    renameFolder: (id: string, name: string) => json<{ folder: Folder }>(`/api/mobile/folders/${encodeURIComponent(id)}`, { method: 'PUT', body: { name } }),
    deleteFolder: (id: string) => json<{ ok: true }>(`/api/mobile/folders/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    fileUrl: (id: string) => `${getEnvironment().origin}/api/mobile/captures/${encodeURIComponent(id)}/file`,
  };
}

export type FoundkeepClient = ReturnType<typeof createFoundkeepClient>;
