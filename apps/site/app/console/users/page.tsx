import Link from 'next/link';
import { serverApi } from '../../../lib/server';

type UsersResp = {
  users: { id: string; email: string; name: string; createdAt: number; saves: number; bytes: number; plan: string; pro: boolean; lastActiveAt: number | null }[];
  nextCursor: string | null;
};
const date = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : '—');

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; cursor?: string }> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  if (sp.q) qs.set('q', sp.q);
  if (sp.cursor) qs.set('cursor', sp.cursor);
  const r = await serverApi<UsersResp>('/admin/users' + (qs.toString() ? `?${qs}` : ''));
  return (
    <>
      <h1>Users</h1>
      <form className="row" style={{ margin: '12px 0' }}>
        <input className="input" name="q" defaultValue={sp.q || ''} placeholder="Search email or name" />
        <button className="btn" type="submit">Search</button>
        {sp.q ? <Link href="/console/users" className="muted">Clear</Link> : null}
      </form>
      <table className="ctable">
        <thead><tr><th>User</th><th>Plan</th><th>Saves</th><th>Storage</th><th>Joined</th><th>Last active</th></tr></thead>
        <tbody>
          {r.users.map(u => (
            <tr key={u.id}>
              <td>
                <Link href={`/console/users/${u.id}`}>{u.name || u.email}</Link>
                <div className="muted" style={{ fontSize: 12 }}>{u.email}</div>
              </td>
              <td>{u.pro ? <span className="pill pro">Pro</span> : <span className="pill">Free</span>}</td>
              <td>{u.saves}</td>
              <td>{(u.bytes / 1048576).toFixed(1)} MB</td>
              <td>{date(u.createdAt)}</td>
              <td>{date(u.lastActiveAt)}</td>
            </tr>
          ))}
          {r.users.length === 0 ? <tr><td colSpan={6} className="muted">No users found.</td></tr> : null}
        </tbody>
      </table>
      {r.nextCursor ? (
        <p style={{ marginTop: 16 }}>
          <Link href={`/console/users?${sp.q ? `q=${encodeURIComponent(sp.q)}&` : ''}cursor=${r.nextCursor}`}>Next →</Link>
        </p>
      ) : null}
    </>
  );
}
