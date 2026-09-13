'use client';
import { previewRatio } from '../../../../packages/shared/src/collection-presentation';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Shimmer } from './loading';

/** Each authenticated dashboard owns its queue; image URLs are never globally cached. */
export class PreviewQueue {
  private active = 0;
  private waiting: { start: () => void; canceled: boolean }[] = [];
  constructor(private readonly limit = 2) {}
  enqueue(begin: () => void) {
    let started = false;
    let finished = false;
    const task = { canceled: false, start: () => { started = true; this.active++; begin(); } };
    this.waiting.push(task);
    this.pump();
    return () => {
      if (finished) return;
      finished = true; task.canceled = true;
      if (started) this.active--;
      else this.waiting = this.waiting.filter(candidate => candidate !== task);
      this.pump();
    };
  }
  private pump() { while (this.active < this.limit && this.waiting.length) { const task = this.waiting.shift()!; if (!task.canceled) task.start(); } }
  clear() { for (const task of this.waiting) task.canceled = true; this.waiting = []; }
}
export const PreviewQueueContext = createContext<PreviewQueue | null>(null);
export function DashboardImage({ src, alt, mode, width, height, kind = 'Capture' }: { src: string; alt: string; mode: 'card' | 'detail'; width?: number; height?: number; kind?: string }) {
  const queue = useContext(PreviewQueueContext);
  const holder = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const release = useRef<(() => void) | null>(null);
  const [visible, setVisible] = useState(mode === 'detail');
  const [attempt, setAttempt] = useState(0);
  const identity = `${src}:${attempt}`;
  const [granted, setGranted] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const remote = /^\/api\/captures\/[^/]+\/preview$/.test(src);
  const started = !remote || granted === identity;
  const isLoaded = loaded === identity;
  const isFailed = failed === identity;
  const finish = () => { release.current?.(); release.current = null; };
  useEffect(() => {
    if (visible || !remote) return;
    if (!('IntersectionObserver' in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); } }, { rootMargin: '240px' });
    if (holder.current) observer.observe(holder.current);
    return () => observer.disconnect();
  }, [visible, remote]);
  useEffect(() => {
    if (!remote || !visible || !queue) return;
    const done = queue.enqueue(() => setGranted(identity));
    release.current = done;
    return () => { done(); if (release.current === done) release.current = null; };
  }, [remote, visible, queue, identity]);
  useEffect(() => { if (started && image.current?.complete && image.current.naturalWidth) { setLoaded(identity); finish(); } }, [started, identity]);
  const ratio = width && height && width > 0 && height > 0 ? `${width}/${height}` : '8/5';
  return <div ref={holder} data-local-image={!remote} className={`capture-image-frame ${mode === 'card' ? 'capture-preview-shell' : 'detail-image-frame'}${!isLoaded && !isFailed ? ' is-loading' : ''}`} style={mode === 'card' ? { aspectRatio: previewRatio(width, height) } : !isLoaded ? { aspectRatio: ratio } : undefined} aria-busy={!isLoaded && !isFailed}>
    {isFailed ? <div className="image-unavailable capture-preview-placeholder"><span>{kind}</span><p>Preview unavailable</p>{mode === 'detail' ? <button type="button" className="subtle-button" onClick={() => setAttempt(value => value + 1)}>Retry image</button> : <small>Open to retry</small>}</div> : <>
      {!isLoaded ? <div className="capture-image-skeleton" aria-hidden="true"><Shimmer /></div> : null}
      {started ? <img ref={image} key={identity} src={src} alt={alt} className={mode === 'card' ? 'capture-preview' : 'detail-image'} width={width || undefined} height={height || undefined} loading={mode === 'card' && !remote ? 'lazy' : 'eager'} decoding="async" style={{ opacity: isLoaded ? 1 : 0 }} onLoad={() => { setLoaded(identity); finish(); }} onError={() => { setFailed(identity); finish(); }} /> : null}
    </>}
  </div>;
}
