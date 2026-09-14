'use client';
import { memo } from 'react';
import { sourcePlatform, savedVia, savedViaLabels, savedTimestamp } from '../../../../packages/shared/src/collection-presentation';
import { DashboardImage } from './dashboard-image';
import {CardMedia} from './card-media';
import { useCardMotion } from './motion';
import { captureKinds, captureTitle, capturePreview, captureMedia, dateLabel, fileBytes, kindLabel, safeFileUrl, type Capture } from '../../lib/dashboard';
export const CaptureCard = memo(function CaptureCard({ capture, open, selected }: { capture: Capture; selected?: boolean; open: (id: string) => void }) {
  const ref = useCardMotion();
  const blob = capturePreview(capture);
  const file = safeFileUrl(capture.fileUrl, capture.id);
  const title = captureTitle(capture);
  const excerpt = capture.noteText || capture.selectionText || capture.summary || capture.articleText || capture.preservedMedia?.excerpt;
  const tags=[...new Map([...(capture.userTags||[]),...(capture.tags||[])].map(tag=>[tag.normalize('NFC').toLowerCase(),tag])).values()];
  const preserving=['pending','running'].includes(capture.preservedMedia?.status||'');
  const source = sourcePlatform(capture);
  const via = savedVia(capture);
  return <article ref={ref} className={`capture-card capture-${Object.hasOwn(captureKinds, capture.type) ? capture.type : 'note'}${selected ? ' capture-selected' : ''}`} aria-current={selected ? 'true' : undefined}><button className="capture-open" type="button" aria-label={`Open ${kindLabel(capture.type)}: ${title}`} onClick={() => open(capture.id)}>
    {captureMedia(capture).length ? <CardMedia capture={capture}/> : blob ? <DashboardImage src={blob} alt="" mode="card" width={capture.width} height={capture.height} kind={kindLabel(capture.type)} /> : file ? <div className="file-card-preview"><span className="file-card-kind">{kindLabel(capture.type)}</span><strong>{capture.fileName || 'Shared file'}</strong><span className="file-card-size">{fileBytes(capture.fileBytes)}</span></div> : ['screenshot', 'image'].includes(capture.type) ? <div className="capture-preview-placeholder"><span>{kindLabel(capture.type)}</span><p>No saved preview</p></div> : null}
    <div className="capture-card-body"><div className="capture-meta"><span>{kindLabel(capture.type)}</span><time dateTime={new Date(savedTimestamp(capture)).toISOString()} title="Added to your collection">{dateLabel(savedTimestamp(capture))}</time></div><h2>{title}</h2>{excerpt && excerpt !== title ? <p className="capture-excerpt">{excerpt.slice(0, 700)}</p> : null}{tags.length ? <ul className="capture-card-tags" aria-label="Tags">{tags.slice(0,3).map(tag=><li key={tag}>{tag}</li>)}{tags.length>3?<li aria-label={`${tags.length-3} more tags`}>+{tags.length-3}</li>:null}</ul>:null}<div className="capture-card-footer"><span className="capture-source-platform">{source || 'FoundKeep'}</span>{via ? <span className="capture-saved-via">{savedViaLabels[via]}</span> : null}{preserving ? <span className="processing-status">Saving media</span> : ['pending', 'processing'].includes(capture.status) ? <span className="processing-status">Adding context</span> : capture.status === 'failed' ? <span className="failed-status">Context unavailable</span> : null}</div></div>
  </button></article>;
});
