import { serverApi } from '../../../lib/server';

type Usage = {
  savesByType: { type: string; n: number }[];
  savesByChannel: { channel: string; n: number }[];
  savesByStatus: { status: string; n: number }[];
  collections: number; follows: number; processingUsedThisCycle: number; mediaBytes: number;
};
const mb = (b: number) => (b / 1048576).toFixed(1) + ' MB';

function Bars({ rows }: { rows: { label: string; n: number }[] }) {
  const max = Math.max(1, ...rows.map(r => r.n));
  if (rows.length === 0) return <p className="muted">No data yet.</p>;
  return <>{rows.map(r => (
    <div className="barrow" key={r.label}>
      <span className="muted">{r.label}</span>
      <span className="track"><span className="bar" style={{ width: (r.n / max * 100) + '%' }} /></span>
      <span>{r.n}</span>
    </div>
  ))}</>;
}

export default async function UsagePage() {
  const u = await serverApi<Usage>('/admin/usage');
  return (
    <>
      <h1>Product usage</h1>
      <div className="tiles">
        <div className="tile"><div className="label">Collections</div><div className="value">{u.collections}</div></div>
        <div className="tile"><div className="label">Follows</div><div className="value">{u.follows}</div></div>
        <div className="tile"><div className="label">AI credits · cycle</div><div className="value">{u.processingUsedThisCycle}</div></div>
        <div className="tile"><div className="label">Preserved media</div><div className="value">{mb(u.mediaBytes)}</div></div>
      </div>
      <h2>Saves by type</h2>
      <Bars rows={u.savesByType.map(x => ({ label: x.type, n: x.n }))} />
      <h2>Saves by channel</h2>
      <Bars rows={u.savesByChannel.map(x => ({ label: x.channel, n: x.n }))} />
      <h2>Enrichment status</h2>
      <Bars rows={u.savesByStatus.map(x => ({ label: x.status, n: x.n }))} />
    </>
  );
}
