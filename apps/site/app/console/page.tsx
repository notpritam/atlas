import { serverApi } from '../../lib/server';

type Overview = {
  totalUsers: number; newUsers7: number; newUsers30: number; activeUsers30: number;
  paidUsers: number; freeUsers: number; mrrUsd: number; totalSaves: number; storageBytes: number;
  signups: { d: string; n: number }[];
};
const mb = (b: number) => (b / 1048576).toFixed(1) + ' MB';

function Tile({ label, value }: { label: string; value: number | string }) {
  return <div className="tile"><div className="label">{label}</div><div className="value">{value}</div></div>;
}

export default async function OverviewPage() {
  const o = await serverApi<Overview>('/admin/overview');
  const max = Math.max(1, ...o.signups.map(s => s.n));
  return (
    <>
      <h1>Overview</h1>
      <div className="tiles">
        <Tile label="Total users" value={o.totalUsers} />
        <Tile label="New · 7d" value={o.newUsers7} />
        <Tile label="New · 30d" value={o.newUsers30} />
        <Tile label="Active · 30d" value={o.activeUsers30} />
        <Tile label="Pro users" value={o.paidUsers} />
        <Tile label="Free users" value={o.freeUsers} />
        <Tile label="MRR" value={'$' + o.mrrUsd} />
        <Tile label="Total saves" value={o.totalSaves} />
        <Tile label="Storage" value={mb(o.storageBytes)} />
      </div>
      <h2>Signups · last 30 days</h2>
      {o.signups.length === 0
        ? <p className="muted">No signups in this window.</p>
        : o.signups.map(s => (
          <div className="barrow" key={s.d}>
            <span className="muted">{s.d}</span>
            <span className="track"><span className="bar" style={{ width: (s.n / max * 100) + '%' }} /></span>
            <span>{s.n}</span>
          </div>
        ))}
    </>
  );
}
