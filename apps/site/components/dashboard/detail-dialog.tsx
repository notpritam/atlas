'use client';
import { savedVia, savedViaLabels, sourcePlatform, savedTimestamp } from '../../../../packages/shared/src/collection-presentation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useEntrance } from './motion';
import { ContentSkeleton, Spinner } from './loading';
import { ApiError } from '../../lib/api';
import { captureTitle, dateLabel, capturePreview, savedCaptureHref, rememberLibraryScroll, type DashboardState, fileBytes, kindLabel, messageFor, safeFileUrl, safeSource, type Capture, type Provenance } from '../../lib/dashboard';
import { useDashboard } from './context';
import { ReaderIcon } from '../reader/reader-tools';
import '../reader/reader.css';
import { DashboardImage } from './dashboard-image';
import {CaptureShare} from '../collections/capture-share';
import {PreservedSource} from './preserved-source';
import { ProcessingDetails } from './processing-details';
import { Dialog } from './dialog';
import { ExternalLink } from '../ui/external-link';
const captureMethods: Record<string, string> = {
  'popup-save-page': 'Saved from popup', 'popup-highlight': 'Highlight from popup', 'popup-region': 'Region from popup', 'popup-full-page': 'Full page from popup',
  'keyboard-highlight': 'Highlight keyboard shortcut', 'keyboard-region': 'Region keyboard shortcut', 'keyboard-full-page': 'Full page keyboard shortcut',
  'context-save-page': 'Saved from right-click menu', 'context-selection': 'Selection from right-click menu', 'context-link': 'Link from right-click menu', 'context-image': 'Image from right-click menu',
  'extension-note': 'Note from extension', 'library-note': 'Note from library', 'twitter-action': 'Saved from X',
  'ios-share-url': 'Shared from iPhone', 'ios-share-text': 'Text shared from iPhone', 'ios-share-image': 'Image shared from iPhone',
  'ios-share-video': 'Video shared from iPhone', 'ios-share-audio': 'Audio shared from iPhone', 'ios-share-document': 'Document shared from iPhone',
  'ios-share-file': 'File shared from iPhone', 'ios-app-note': 'Note from iPhone app',
};
function OriginLink({ value, label }: { value?: string; label: string }) { const url = safeSource(value); return url ? <ExternalLink href={url.href} aria-label={`${label}: ${url.href}`}>{url.href}</ExternalLink> : null; }
function Origin({ value: p, capture }: { value: Provenance; capture: Capture }) {
  const link = (value: string | undefined, label: string) => safeSource(value) ? <OriginLink value={value} label={label} /> : null;
  const via = savedVia(capture);
  const entries: [string, ReactNode][] = [
    ['Platform', sourcePlatform(capture)], ['Saved via', via ? savedViaLabels[via] : null],
    ['Original page', link(p.pageUrl, 'Original page')], ['Canonical page', p.canonicalUrl !== p.pageUrl ? link(p.canonicalUrl, 'Canonical page') : null],
    ['Saved target', link(p.targetUrl, 'Saved target')], ['Page title', p.pageTitle], ['Publisher', p.siteName], ['Description', p.description],
    ['Author', Array.isArray(p.authors) ? p.authors.join(', ') : null], ['Published', p.publishedAt ? dateLabel(p.publishedAt, true) : null],
    ['Last changed', p.modifiedAt ? dateLabel(p.modifiedAt, true) : null], ['Page language', p.language], ['Lead image', link(p.leadImageUrl, 'Lead image')], ['Site icon', link(p.faviconUrl, 'Site icon')],
    ['Capture method', p.captureMethod ? captureMethods[p.captureMethod] || p.captureMethod : null], ['Captured', p.capturedAt ? dateLabel(p.capturedAt, true) : null], ['Extracted', p.extractedAt ? dateLabel(p.extractedAt, true) : null],
    ['Extractor', p.extractorVersion], ['Origin record', p.schemaVersion ? `Version ${p.schemaVersion}` : null], ['Content fingerprint', p.contentHash ? <code>{p.contentHash}</code> : null],
    ['Extraction', p.extractionStatus], ['Extraction note', p.extractionError], ['Source app', p.sourceApplication], ['Original file', p.originalFileName], ['Declared type', p.declaredMime], ['Original size', Number.isSafeInteger(p.byteSize) ? fileBytes(p.byteSize) : null],
  ];
  return <details className="detail-origin" id="capture-origin"><summary>Source details</summary><p className="detail-origin-intro">FoundKeep keeps this record with the capture so you can trace it back to where it came from.</p><dl>{entries.filter(([, value]) => value !== null && value !== undefined && value !== '').map(([label, value]) => <div key={label} style={{ display: 'contents' }}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{Array.isArray(p.headings) && p.headings.length ? <details className="origin-outline"><summary>Page outline · {p.headings.length} headings</summary><ol>{p.headings.map((heading, index) => <li key={index}>{String(heading)}</li>)}</ol></details> : null}</details>;
}
export default function DetailPanel({ id, fullPage = false, initialCapture, initialError, state }: { id: string; fullPage?: boolean; initialCapture?: Capture; initialError?: string; state: DashboardState }) {
  const ref = useEntrance<HTMLElement>(id, undefined, fullPage ? 'y' : 'x');
  const { me, request, confirm, closePanel, refresh, toast } = useDashboard();
  const [error, setError] = useState('');
  const detail = useQuery({ initialData: initialCapture ? { capture: initialCapture } : undefined, queryKey: ['capture', me.account.id, id], queryFn: ({ signal }) => request<{ capture: Capture }>(`/captures/${encodeURIComponent(id)}`, { signal }), staleTime: 0 });
  const capture = detail.data?.capture;
  const remove = useMutation({ mutationFn: () => request(`/captures/${encodeURIComponent(id)}`, { method: 'DELETE' }), onSuccess: async () => { closePanel(); toast('Capture deleted.'); await refresh(); }, onError: error => setError(messageFor(error)) });
  const source = capture ? safeSource(capture.provenance?.pageUrl || capture.sourceUrl) : null;
  const blob = capture ? capturePreview(capture) : null;
  const file = capture ? safeFileUrl(capture.fileUrl, capture.id) : null;
  const missing = detail.error instanceof ApiError && detail.error.status === 404;
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open], [aria-modal="true"]')) { event.preventDefault(); closePanel(); } }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [closePanel]);
  const content = <aside ref={ref} id="detail-panel" className={`capture-detail-panel reader-surface${fullPage ? ' capture-reading-view' : ''}`} aria-labelledby="detail-title"><div className="dialog-bar reader-toolbar"><button className="reader-icon-button reader-close" type="button" data-close="detail-panel" aria-label={fullPage ? 'Back to library' : 'Close capture'} title={fullPage ? 'Back to library' : 'Close capture'} onClick={closePanel}><ReaderIcon kind={fullPage ? 'back' : 'close'} /></button><span className="reader-toolbar-label" id="detail-kind">{capture ? kindLabel(capture.type) : 'Capture'}</span><div className="detail-panel-actions reader-toolbar-actions">{source ? <a className="reader-icon-button" href={source.href} target="_blank" rel="noopener noreferrer" aria-label="Open original source" title="Open original source"><ReaderIcon kind="source" /></a> : null}{!fullPage ? <Link className="reader-icon-button expand-capture" href={savedCaptureHref(id, state)} onClick={() => rememberLibraryScroll(me.account.id)} aria-label="Expand capture" title="Expand capture"><ReaderIcon kind="expand" /></Link> : null}</div></div><div className="detail-body" id="detail-body">
    {capture ? <div className="reader-layout"><article className="reader-content"><header className="reader-heading"><div className="reader-byline"><span>{kindLabel(capture.type)}</span>{source ? <ExternalLink href={source.href}>{source.hostname.replace(/^www\./, '')}</ExternalLink> : null}</div><h2 id="detail-title">{captureTitle(capture)}</h2></header>
      {blob ? <DashboardImage src={blob} alt={capture.fileName || capture.sourceTitle || 'Saved capture'} mode="detail" width={capture.width} height={capture.height} kind={kindLabel(capture.type)} /> : null}
      {file ? <>{capture.fileMime?.startsWith('image/') ? null : capture.fileMime?.startsWith('video/') ? <video src={file} className="detail-media" controls preload="metadata" /> : capture.fileMime?.startsWith('audio/') ? <audio src={file} className="detail-audio" controls preload="metadata" /> : null}<section className="detail-file"><h3>{capture.fileName || 'Shared file'}</h3><p>{capture.fileMime || 'File'} · {fileBytes(capture.fileBytes)}</p><a href={file} target="_blank" rel="noopener noreferrer" className="button secondary compact">{capture.fileMime === 'application/octet-stream' ? 'Download saved file' : 'Open saved file'}</a></section></> : null}
      {([['Highlight', capture.selectionText], ['Note', capture.noteText], ['Summary', capture.summary], ['Article text', capture.articleText], ['Text in image', capture.ocrText]] as const).filter(([, content]) => content).map(([title, content]) => <section className="detail-section" key={title}><h3>{title}</h3><p>{content}</p></section>)}
      <PreservedSource key={`source-${capture.id}`} id={capture.id} sourceUrl={capture.sourceUrl} />
      <ProcessingDetails key={capture.id} id={capture.id} />
      </article><aside className="reader-context" aria-label="Capture details"><h3>Saved in your library</h3><dl className="reader-metadata"><div><dt>Saved</dt><dd>{dateLabel(savedTimestamp(capture), true)}</dd></div><div><dt>Type</dt><dd>{kindLabel(capture.type)}</dd></div></dl>
      {capture.category ? <p className="muted">Category: {capture.category}</p> : null}{Array.isArray(capture.tags) && capture.tags.length ? <ul className="detail-tags" aria-label="Capture tags">{capture.tags.map((tag, index) => <li key={index}>{String(tag)}</li>)}</ul> : null}
      {['pending', 'processing'].includes(capture.status) ? <p className="detail-processing">Your capture is saved. FoundKeep is still adding context; reopen it in a moment to see updates.</p> : capture.status === 'failed' ? <p className="detail-processing">Your capture is safe. Automatic context could not be added.</p> : null}{capture.enrichError ? <p className="detail-processing">{capture.enrichError}</p> : null}
      {capture.provenance && typeof capture.provenance === 'object' ? <Origin value={capture.provenance} capture={capture} /> : null}<CaptureShare key={`share-${capture.id}`} capture={capture}/></aside></div> : detail.isError ? <><h2 id="detail-title">Capture unavailable</h2><p>{missing ? 'This capture may have been deleted. Refresh your library to see your current collection.' : messageFor(detail.error)}</p><button className="button secondary" type="button" onClick={() => { if (missing) { closePanel(); void refresh(); } else void detail.refetch(); }}>{missing ? 'Refresh library' : 'Try again'}</button></> : <div role="status" aria-busy="true"><h2 id="detail-title" className="loading-caption"><Spinner />Opening capture…</h2><ContentSkeleton kind="detail" /></div>}
    <p className="form-message is-error" role="alert" hidden={!error}>{error}</p>
  </div><div className="dialog-footer" id="detail-actions" hidden={!capture}><button className="button danger-quiet compact" id="delete-capture" type="button" disabled={remove.isPending} onClick={async () => { if (await confirm('Delete this capture?', 'This removes it from your cloud library permanently. Any local copy in your extension stays on that device.', 'Delete capture')) remove.mutate(); }}>Delete capture</button></div></aside>;
  return fullPage ? content : <Dialog id="capture-dialog" className="capture-modal" labelledBy="detail-title" onClose={closePanel} initialFocus=".reader-close" dismissOnBackdrop>{content}</Dialog>;
}
