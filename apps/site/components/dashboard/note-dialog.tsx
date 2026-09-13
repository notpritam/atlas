'use client';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { messageFor, noteBody } from '../../lib/dashboard';
import { CloseIcon, Dialog } from './dialog';
import { Spinner } from './loading';
import { useDashboard } from './context';
export default function NoteDialog({ open }: { open: boolean }) {
  const { request, preferences, toast, refresh, closePanel } = useDashboard();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const clientId = useRef<string | null>(null);
  const save = useMutation({ mutationFn: async () => {
    if (!text.trim()) throw new Error('Write something before saving your note.');
    if (preferences?.preferences.capture.note !== true) throw new Error('Notes are disabled in extension settings.');
    clientId.current ||= crypto.randomUUID();
    await request('/captures', { method: 'POST', body: noteBody(text.trim(), clientId.current, preferences.preferences) });
  }, onSuccess: async () => { setText(''); clientId.current = null; closePanel(); toast('Note saved to your library.'); await refresh(); }, onError: error => setError(messageFor(error)) });
  useEffect(() => {
    if (!text.trim()) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [text]);
  return <Dialog id="note-dialog" className="note-dialog" labelledBy="note-title" open={open} onClose={closePanel} initialFocus="#note-text"><div className="dialog-bar"><h2 id="note-title">A thought worth keeping.</h2><button className="icon-button" type="button" data-close="note-dialog" aria-label="Close note" onClick={closePanel}><CloseIcon /></button></div><form id="note-form" className="dialog-content" aria-busy={save.isPending} onSubmit={event => { event.preventDefault(); if (!save.isPending) { setError(''); save.mutate(); } }}><div className="field"><label htmlFor="note-text">Your note</label><textarea id="note-text" name="note" rows={9} maxLength={50000} placeholder="Get it down before it gets away…" required disabled={save.isPending} value={text} onChange={event => { setText(event.target.value); clientId.current = null; }} /><p className="field-help">Saved to your private cloud library.</p></div><p className="form-message is-error" id="note-error" role="alert" hidden={!error}>{error}</p><div className="form-actions"><button className="button secondary" type="button" data-close="note-dialog" onClick={closePanel}>Keep editing later</button><button className="button primary" id="save-note" type="submit" disabled={save.isPending}>{save.isPending ? <><Spinner />Saving…</> : 'Save note'}</button></div></form></Dialog>;
}
