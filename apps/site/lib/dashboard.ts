export const captureKinds = { screenshot: 'Screenshot', selection: 'Highlight', bookmark: 'Bookmark', image: 'Image', video: 'Video', audio: 'Audio', document: 'Document', file: 'File', note: 'Note', tweet: 'Tweet' } as const;
export type CaptureKind = keyof typeof captureKinds;
export interface DashboardState { q: string; type: CaptureKind | ''; item: string; panel: 'settings' | 'devices' | 'note' | '' }
type SearchValue = string | string[] | undefined;
export function parseDashboardState(input: URLSearchParams | Record<string, SearchValue>): DashboardState {
  const value = (key: string) => { const result = input instanceof URLSearchParams ? input.get(key) : input[key]; return typeof result === 'string' ? result : ''; };
  const type = value('type');
  const item = value('item');
  const panel = value('panel');
  return { q: value('q').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200), type: Object.hasOwn(captureKinds, type) ? type as CaptureKind : '', item: /^[A-Za-z0-9_-]{1,128}$/.test(item) ? item : '', panel: ['settings', 'devices', 'note'].includes(panel) ? panel as DashboardState['panel'] : '' };
}
export function dashboardHref(state: DashboardState) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.type) params.set('type', state.type);
  if (state.item) params.set('item', state.item);
  if (state.panel) params.set('panel', state.panel);
  return `/dashboard${params.size ? `?${params}` : ''}`;
}
export function capturesPath(state: Pick<DashboardState, 'q' | 'type'>, cursor?: string) {
  const params = new URLSearchParams({ limit: '60', sort: 'recent', view: 'cards' });
  if (state.q) params.set('q', state.q);
  if (state.type) params.set('type', state.type);
  if (cursor) params.set('cursor', cursor);
  return `/captures?${params}`;
}
export interface Provenance {
  pageUrl?: string; canonicalUrl?: string; targetUrl?: string; pageTitle?: string; siteName?: string; description?: string;
  authors?: string[]; publishedAt?: string | number; modifiedAt?: string | number; language?: string; leadImageUrl?: string; faviconUrl?: string;
  captureMethod?: string; capturedAt?: number | string; extractedAt?: number | string; extractorVersion?: number | string;
  schemaVersion?: number; contentHash?: string; extractionStatus?: string; extractionError?: string; headings?: string[];
  sourceApplication?: string; originalFileName?: string; declaredMime?: string; byteSize?: number;
}
export interface Capture {
  id: string; type: string; sourceTitle?: string; sourceUrl?: string; blobUrl?: string; fileUrl?: string;
  previewUrl?: string; width?: number; height?: number; fileName?: string; fileMime?: string; fileBytes?: number; selectionText?: string; noteText?: string; summary?: string; articleText?: string; ocrText?: string;
  createdAt?: number | string; savedVia?: 'iphone' | 'android' | 'browser' | 'dashboard' | null;
  capturedAt: number | string; status: string; category?: string; tags?: string[]; provenance?: Provenance; enrichError?: string;
}
export interface CapturePage { captures: Capture[]; nextCursor: string | null; total: number }
export type PopupAction = 'bookmark' | 'highlight' | 'region' | 'fullPage';
export interface Preferences {
  version: 1;
  capture: { region: boolean; fullPage: boolean; highlight: boolean; bookmark: boolean; image: boolean; tweet: boolean; note: boolean };
  bookmark: { readableText: boolean; extendedMetadata: boolean; headings: boolean };
  notes: { attachSource: boolean };
  popup: { actionOrder: PopupAction[]; showRecent: boolean; recentCount: number };
  sync: { automatic: boolean };
  organization: { ocr: boolean; summaries: boolean; tags: boolean };
  feedback: { success: boolean };
  contextMenus: boolean;
}
export interface PreferenceEnvelope { preferences: Preferences; revision: number; updatedAt: number | null }
export interface ExtensionStatus { id: string; result: { ok: boolean; account?: { id: string; email: string }; version?: string; environment?: 'dev' | 'prod'; origin?: string } }
export function kindLabel(type: string) { return Object.hasOwn(captureKinds, type) ? captureKinds[type as CaptureKind] : 'Capture'; }
export function captureTitle(capture: Capture) { return capture.sourceTitle || capture.fileName || (capture.noteText || capture.selectionText || '').slice(0, 120) || `Untitled ${kindLabel(capture.type).toLowerCase()}`; }
export function safeSource(value?: string) { try { const url = new URL(value || ''); return ['https:', 'http:'].includes(url.protocol) ? url : null; } catch { return null; } }
export function safeBlob(value: string | undefined, id: string) {
  if (!value || !id) return null;
  const expected = `/api/captures/${encodeURIComponent(id)}/blob`;
  if (value === expected) return expected;
  if (typeof window === 'undefined') return null;
  try { const url = new URL(value, window.location.origin); return url.origin === window.location.origin && url.pathname === expected && !url.search && !url.hash ? expected : null; } catch { return null; }
}
export function safeFileUrl(value: string | undefined, id: string) { const expected = `/api/captures/${encodeURIComponent(id)}/file`; return value === expected ? expected : null; }
export function dateLabel(value: string | number, full = false) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Date unavailable' : date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', ...(full ? { year: 'numeric', hour: '2-digit', minute: '2-digit' } : {}) });
}
export function bytes(value: number) { return `${((value || 0) / 1048576).toLocaleString('en-US', { maximumFractionDigits: 1 })} MB`; }
export function fileBytes(value?: number) {
  const amount = Math.max(0, Number(value) || 0);
  return amount < 1024 ? `${amount} B` : amount < 1048576 ? `${(amount / 1024).toLocaleString('en-US', { maximumFractionDigits: 1 })} KB` : bytes(amount);
}
export function messageFor(error: unknown) { return error instanceof Error ? error.message : 'That request could not be completed. Please try again.'; }
export function noteBody(note: string, clientId: string, preferences: Preferences) {
  const capturedAt = Date.now();
  return { clientId, type: 'note', noteText: note, capturedAt, processingOptions: structuredClone(preferences.organization), provenance: {
    schemaVersion: 1, captureMethod: 'library-note', pageUrl: null, canonicalUrl: null, pageTitle: null, siteName: null, description: null,
    authors: [], publishedAt: null, modifiedAt: null, language: null, leadImageUrl: null, faviconUrl: null, targetUrl: null, headings: [],
    capturedAt, extractedAt: capturedAt, extractorVersion: 1, contentHash: null, extractionStatus: 'complete', extractionError: null,
  } };
}

export function safePreviewUrl(value: string | undefined, id: string) { const expected = `/api/captures/${encodeURIComponent(id)}/preview`; return value === expected ? expected : null; }
export function capturePreview(capture: Capture) { return safeBlob(capture.blobUrl, capture.id) || (capture.fileMime?.startsWith('image/') ? safeFileUrl(capture.fileUrl, capture.id) : null) || safePreviewUrl(capture.previewUrl, capture.id); }
export function savedCaptureHref(id: string, state: Pick<DashboardState, 'q' | 'type'>) {
  const params = new URLSearchParams(); if (state.q) params.set('q', state.q); if (state.type) params.set('type', state.type);
  return `/dashboard/saved/${encodeURIComponent(id)}${params.size ? `?${params}` : ''}`;
}

// Only a numeric viewport position is retained; captures and drafts stay in memory.
export function rememberLibraryScroll(accountId: string) { try { sessionStorage.setItem(`foundkeep-library-scroll-${accountId}`, String(window.scrollY)); } catch {} }
export function returnToLibraryScroll(accountId: string) { try { sessionStorage.setItem(`foundkeep-restore-scroll-${accountId}`, '1'); } catch {} }
export function restoreLibraryScroll(accountId: string) {
  try {
    if (sessionStorage.getItem(`foundkeep-restore-scroll-${accountId}`) !== '1') return;
    sessionStorage.removeItem(`foundkeep-restore-scroll-${accountId}`);
    const y = Number(sessionStorage.getItem(`foundkeep-library-scroll-${accountId}`));
    sessionStorage.removeItem(`foundkeep-library-scroll-${accountId}`);
    if (Number.isFinite(y) && y >= 0) requestAnimationFrame(() => window.scrollTo({ top: Math.min(y, 1_000_000), behavior: 'instant' }));
  } catch {}
}
export function clearLibraryScroll(accountId: string) { try { sessionStorage.removeItem(`foundkeep-library-scroll-${accountId}`); sessionStorage.removeItem(`foundkeep-restore-scroll-${accountId}`); } catch {} }
