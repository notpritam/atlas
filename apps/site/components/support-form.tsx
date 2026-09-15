'use client';
import { useState } from 'react';

const field: React.CSSProperties = { display: 'block', width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #d3d5cf', background: '#fff', font: 'inherit', marginTop: 6 };

export default function SupportForm() {
  const [kind, setKind] = useState('support');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'signin' | 'error'>('idle');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending'); setError('');
    try {
      const res = await fetch('/api/support', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, subject, body }),
      });
      if (res.status === 401) { setState('signin'); return; }
      if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { message?: string }).message || 'Could not send your message.');
      setState('done'); setSubject(''); setBody('');
    } catch (err) {
      setState('error'); setError(err instanceof Error ? err.message : 'Could not send your message.');
    }
  }

  if (state === 'done') return <p className="support-note">Thanks — we got your message and will follow up by email at your account address.</p>;
  if (state === 'signin') return <p className="support-note">Please <a href="/login">sign in</a> to send this, so we can reply to your account. You can also email <a href="mailto:notpritamsharma@gmail.com">notpritamsharma@gmail.com</a>.</p>;

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 10, maxWidth: 520 }}>
      <label>Type
        <select value={kind} onChange={e => setKind(e.target.value)} style={field}>
          <option value="support">Support — something isn&apos;t working</option>
          <option value="bug">Bug report</option>
          <option value="feedback">Feedback</option>
          <option value="idea">Idea / feature request</option>
        </select>
      </label>
      <label>Subject
        <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={200} required style={field} placeholder="Short summary" />
      </label>
      <label>Message
        <textarea value={body} onChange={e => setBody(e.target.value)} maxLength={5000} required rows={5} style={{ ...field, resize: 'vertical' }} placeholder="What happened, and what you expected. Never include passwords or recovery codes." />
      </label>
      {error ? <p style={{ color: '#b23b23' }}>{error}</p> : null}
      <div><button className="button" type="submit" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Send message'}</button></div>
    </form>
  );
}
