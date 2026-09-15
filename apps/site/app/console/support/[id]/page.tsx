import Link from 'next/link';
import { serverApi } from '../../../../lib/server';
import { ApiError } from '../../../../lib/api';
import { notFound } from 'next/navigation';
import TriageForm from '../triage-form';

type Ticket = { id: string; accountId: string | null; email: string; kind: string; subject: string; body: string; status: string; createdAt: number; updatedAt: number };
type Note = { id: string; body: string; created_at: number };
type Resp = { ticket: Ticket; notes: Note[] };
const dt = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let r: Resp;
  try {
    r = await serverApi<Resp>(`/admin/support/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const t = r.ticket;
  return (
    <>
      <p><Link href="/console/support">← Support</Link></p>
      <h1>{t.subject}</h1>
      <p className="muted">
        <span className="pill">{t.kind}</span> <span className={`pill ${t.status}`}>{t.status.replace('_', ' ')}</span> · from {t.email}
        {t.accountId ? <> · <Link href={`/console/users/${t.accountId}`}>view user</Link></> : null} · {dt(t.createdAt)}
      </p>
      <div className="card" style={{ whiteSpace: 'pre-wrap' }}>{t.body}</div>

      <h2>Update</h2>
      <TriageForm id={t.id} status={t.status} />

      <h2>Internal notes</h2>
      {r.notes.length === 0 ? <p className="muted">No notes yet.</p> : r.notes.map(nte => (
        <div className="card" key={nte.id}>
          <div className="muted" style={{ fontSize: 12 }}>{dt(nte.created_at)}</div>
          <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{nte.body}</div>
        </div>
      ))}
    </>
  );
}
