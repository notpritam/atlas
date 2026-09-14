'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { gsap, motionAllowed } from './motion';
import { lockDocumentScroll } from '../../lib/scroll-lock';
export function CloseIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>; }
export function Dialog({ id, className, labelledBy, children, open = true, onClose, preventClose = false, initialFocus, dismissOnBackdrop = false }: { id: string; className: string; labelledBy: string; children: ReactNode; open?: boolean; onClose?: () => void; preventClose?: boolean; initialFocus?: string; dismissOnBackdrop?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const media = gsap.matchMedia();
    const unlock = open ? lockDocumentScroll() : () => {};
    if (open && !dialog.open) { dialog.showModal(); if (initialFocus) dialog.querySelector<HTMLElement>(initialFocus)?.focus(); }
    if (open) media.add(motionAllowed, () => { gsap.from(dialog, { opacity: 0, y: 14, scale: 0.985, duration: 0.24, ease: 'power2.out', clearProps: 'transform,opacity' }); });
    if (!open && dialog.open) dialog.close();
    return () => { media.revert(); if (dialog.open) dialog.close(); unlock(); if (open && previous?.isConnected) queueMicrotask(() => { if (previous.isConnected) previous.focus({preventScroll:true}); }); };
  }, [open, initialFocus]);
  return <dialog ref={ref} className={`atlas-dialog ${className}`} id={id} aria-labelledby={labelledBy} onClick={event => { if (!dismissOnBackdrop || preventClose || event.target !== event.currentTarget) return; const box=event.currentTarget.getBoundingClientRect(); if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom) onCloseRef.current?.(); }} onCancel={event => { event.preventDefault(); if (!preventClose) onCloseRef.current?.(); }} onClose={event => { if (!event.currentTarget.open && open && !preventClose) onCloseRef.current?.(); }}>{children}</dialog>;
}
export interface Confirmation { title: string; description: string; label: string; resolve: (accepted: boolean) => void }
export function ConfirmDialog({ confirmation, finish }: { confirmation: Confirmation | null; finish: (accepted: boolean) => void }) {
  if (!confirmation) return null;
  return <Dialog id="confirm-dialog" className="confirm-dialog" labelledBy="confirm-title" onClose={() => finish(false)} initialFocus="#confirm-cancel"><div className="dialog-content"><h2 id="confirm-title">{confirmation.title}</h2><p className="muted" id="confirm-description">{confirmation.description}</p><form className="form-actions" onSubmit={event => { event.preventDefault(); finish(true); }}><button className="button secondary" type="button" id="confirm-cancel" onClick={() => finish(false)}>Cancel</button><button className="button primary" type="submit" id="confirm-accept">{confirmation.label}</button></form></div></Dialog>;
}
