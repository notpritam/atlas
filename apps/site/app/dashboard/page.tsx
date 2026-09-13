import { redirect } from 'next/navigation';
import { ApiError } from '../../lib/api';
import { getSession, serverApi } from '../../lib/server';
import { capturesPath, parseDashboardState, type CapturePage } from '../../lib/dashboard';
import Dashboard from '../../components/dashboard/dashboard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your library', robots: { index: false, follow: false } };
export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await getSession();
  if (!me) redirect('/login');
  const params = await searchParams;
  const state = parseDashboardState(params);
  if (state.panel === 'devices') redirect('/dashboard/apps');
  if (state.panel === 'settings') redirect('/dashboard/settings');
  if (params.billing === 'success' || params.billing === 'cancelled') redirect('/dashboard/plans?billing=' + params.billing);
  let captures: CapturePage | undefined;
  let initialError = '';
  try { captures = await serverApi<CapturePage>(capturesPath(state), me.account.id); }
  catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.code === 'account_changed')) redirect('/login');
    initialError = error instanceof Error ? error.message : 'Your library could not load. Please try again.';
  }
  return <Dashboard key={me.account.id} me={me} initialCaptures={captures} initialState={state} initialError={initialError} />;
}
