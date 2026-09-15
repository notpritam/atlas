import Link from 'next/link';
import { serverApi } from '../../../../lib/server';
import { ApiError } from '../../../../lib/api';
import { notFound } from 'next/navigation';

type Detail = {
  user: { id: string; email: string; name: string; createdAt: number };
  plan: { plan: string; pro: boolean; complimentaryPro: boolean };
  saves: number;
  savesByType: { type: string; n: number }[];
  storage: { captureBytes: number; mediaBytes: number; totalBytes: number };
  collections: number;
  connections: { name: string; client_kind: string; created_at: number; last_seen_at: number | null }[];
  identities: { provider: string; verified_email: string | null; created_at: number }[];
  processing: { cycle: string; used: number; reserved: number }[];
  recentCaptures: { type: string; status: string; created_at: number }[];
};
const mb = (b: number) => (b / 1048576).toFixed(2) + ' MB';
const dt = (ms: number | null) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : '—');

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let d: Detail;
  try {
    d = await serverApi<Detail>(`/admin/users/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  return (
    <>
      <p><Link href="/console/users">← Users</Link></p>
      <h1>{d.user.name || d.user.email}</h1>
      <p className="muted">{d.user.email} · joined {new Date(d.user.createdAt).toISOString().slice(0, 10)} · {d.plan.pro ? <span className="pill pro">Pro{d.plan.complimentaryPro ? ' (complimentary)' : ''}</span> : <span className="pill">Free</span>}</p>
      <div className="tiles">
        <div className="tile"><div className="label">Saves</div><div className="value">{d.saves}</div></div>
        <div className="tile"><div className="label">Storage</div><div className="value">{mb(d.storage.totalBytes)}</div></div>
        <div className="tile"><div className="label">Collections</div><div className="value">{d.collections}</div></div>
        <div className="tile"><div className="label">Devices</div><div className="value">{d.connections.length}</div></div>
      </div>

      <h2>Saves by type</h2>
      {d.savesByType.length === 0 ? <p className="muted">No saves yet.</p> : (
        <div className="row">{d.savesByType.map(t => <span className="pill" key={t.type}>{t.type}: {t.n}</span>)}</div>
      )}

      <h2>Storage breakdown</h2>
      <p className="muted">Captures {mb(d.storage.captureBytes)} · preserved media {mb(d.storage.mediaBytes)}</p>

      <h2>AI processing (recent cycles)</h2>
      {d.processing.length === 0 ? <p className="muted">No AI usage.</p> : (
        <table className="ctable"><thead><tr><th>Cycle</th><th>Used</th><th>Reserved</th></tr></thead>
          <tbody>{d.processing.map(p => <tr key={p.cycle}><td>{p.cycle}</td><td>{p.used}</td><td>{p.reserved}</td></tr>)}</tbody></table>
      )}

      <h2>Sign-in methods</h2>
      {d.identities.length === 0 ? <p className="muted">Password only.</p> : (
        <div className="row">{d.identities.map((i, k) => <span className="pill" key={k}>{i.provider}{i.verified_email ? ` · ${i.verified_email}` : ''}</span>)}</div>
      )}

      <h2>Connected devices</h2>
      {d.connections.length === 0 ? <p className="muted">No connected devices.</p> : (
        <table className="ctable"><thead><tr><th>Name</th><th>Kind</th><th>Connected</th><th>Last seen</th></tr></thead>
          <tbody>{d.connections.map((c, k) => <tr key={k}><td>{c.name}</td><td>{c.client_kind}</td><td>{dt(c.created_at)}</td><td>{dt(c.last_seen_at)}</td></tr>)}</tbody></table>
      )}

      <h2>Recent activity</h2>
      {d.recentCaptures.length === 0 ? <p className="muted">No recent captures.</p> : (
        <table className="ctable"><thead><tr><th>Type</th><th>Status</th><th>When</th></tr></thead>
          <tbody>{d.recentCaptures.map((c, k) => <tr key={k}><td>{c.type}</td><td>{c.status}</td><td>{dt(c.created_at)}</td></tr>)}</tbody></table>
      )}
    </>
  );
}
