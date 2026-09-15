'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function TriageForm({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [next, setNext] = useState(status);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const payload: Record<string, string> = {};
    if (next !== status) payload.status = next;
    if (note.trim()) payload.note = note.trim();
    if (Object.keys(payload).length === 0) { setBusy(false); return; }
    try {
      const res = await fetch(`/api/admin/support/${id}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Update failed');
      setNote('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card">
      <div className="row">
        <label className="muted" htmlFor="status">Status</label>
        <select id="status" className="select" value={next} onChange={e => setNext(e.target.value)}>
          <option value="open">open</option>
          <option value="in_progress">in progress</option>
          <option value="closed">closed</option>
        </select>
      </div>
      <textarea className="textarea" style={{ marginTop: 10 }} placeholder="Add an internal note (optional)" value={note} onChange={e => setNote(e.target.value)} />
      {error ? <p style={{ color: '#e5734f' }}>{error}</p> : null}
      <div style={{ marginTop: 10 }}><button className="btn" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save'}</button></div>
    </form>
  );
}
