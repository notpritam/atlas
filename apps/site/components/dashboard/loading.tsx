'use client';

import { useRef } from 'react';
import { useLinkStatus } from 'next/link';
import { useLoadingLoop } from './motion';
import './motion.css';

export function Spinner() {
  const ref = useRef<HTMLSpanElement>(null);
  useLoadingLoop(ref, true, 'spin');
  return <span ref={ref} className="work-spinner" aria-hidden="true"><svg viewBox="0 0 24 24"><circle className="spinner-track" cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 9 9" /></svg></span>;
}

export function RefreshIcon({ active }: { active: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLoadingLoop(ref, active, 'spin');
  return <span ref={ref} className="refresh-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></svg></span>;
}

export function Shimmer() {
  const ref = useRef<HTMLSpanElement>(null);
  useLoadingLoop(ref, true, 'shimmer');
  return <span ref={ref} className="loading-shimmer" aria-hidden="true" />;
}

export function NavigationPending() {
  const { pending } = useLinkStatus();
  return pending ? <span className="navigation-pending" role="status"><Spinner /><span className="sr-only">Loading page…</span></span> : null;
}

export function ContentSkeleton({ kind = 'library' }: { kind?: 'library' | 'detail' | 'plan' | 'settings' }) {
  return <div className={`content-skeleton skeleton-${kind}`} aria-hidden="true">{Array.from({ length: kind === 'detail' ? 1 : kind === 'library' ? 6 : 3 }, (_, index) => <div className="skeleton-card" key={index}><div className="skeleton-media" /><div className="skeleton-line" /><div className="skeleton-line short" /><Shimmer /></div>)}</div>;
}

export function SectionLoading({ label = 'Loading your workspace…', kind = 'settings' }: { label?: string; kind?: 'library' | 'detail' | 'plan' | 'settings' }) {
  return <section className="section-loading" role="status" aria-busy="true"><p className="loading-caption"><Spinner />{label}</p><ContentSkeleton kind={kind} /></section>;
}
