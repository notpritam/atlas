import Link from 'next/link';
import { serverApi } from '../../../lib/server';

type Ticket = { id: string; accountId: string | null; email: string; kind: string; subject: string; status: string; createdAt: number };
type Resp = { tickets: Ticket[] };
const STATUSES = ['', 'open', 'in_progress', 'closed'] as const;
const dt = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = sp.status && ['open', 'in_progress', 'closed'].includes(sp.status) ? sp.status : '';
  const r = await serverApi<Resp>('/admin/support' + (status ? `?status=${status}` : ''));
  return (
    <>
      <h1>Support &amp; feedback</h1>
      <div className="row" style={{ margin: '12px 0' }}>
        {STATUSES.map(s => (
          <Link key={s || 'all'} href={s ? `/console/support?status=${s}` : '/console/support'}
            className="pill" style={status === s ? { borderColor: '#4cc38a', color: '#4cc38a' } : undefined}>
            {s ? s.replace('_', ' ') : 'all'}
          </Link>
        ))}
      </div>
      <table className="ctable">
        <thead><tr><th>Subject</th><th>Kind</th><th>From</th><th>Status</th><th>Created</th></tr></thead>
        <tbody>
          {r.tickets.map(t => (
            <tr key={t.id}>
              <td><Link href={`/console/support/${t.id}`}>{t.subject}</Link></td>
              <td>{t.kind}</td>
              <td className="muted">{t.email}</td>
              <td><span className={`pill ${t.status}`}>{t.status.replace('_', ' ')}</span></td>
              <td className="muted">{dt(t.createdAt)}</td>
            </tr>
          ))}
          {r.tickets.length === 0 ? <tr><td colSpan={5} className="muted">No tickets.</td></tr> : null}
        </tbody>
      </table>
    </>
  );
}
