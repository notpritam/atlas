import { redirect } from 'next/navigation';
import { getSession } from '../../lib/server';
import { parseDashboardState } from '../../lib/dashboard';
import Dashboard from './dashboard';
import type { AccountSection } from './sidebar';

export async function AccountPage({ section, collectionId }: { section: AccountSection; collectionId?:string }) {
  const me = await getSession();
  if (!me) redirect('/login');
  return <Dashboard key={`${me.account.id}:${section}:${collectionId||''}`} me={me} section={section} collectionId={collectionId} initialState={parseDashboardState({})} />;
}
