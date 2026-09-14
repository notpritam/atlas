import { redirect } from 'next/navigation';
import { getSession } from '../../lib/server';
import { AccountBoundary } from './account-boundary';
import type { AccountSection } from './sidebar';
import Collections from '../collections/manager';
import Devices from './devices';
import Agents from './agents';
import MindMap from './mind-map';
import Plans from './plans';
import Settings from './settings';

export async function AccountPage({ section, collectionId }: { section: AccountSection; collectionId?: string }) {
  const me = await getSession();
  if (!me) redirect('/login');
  // Select the client component on the server. Next loads only the selected
  // reference, without a second lazy boundary racing the shared query cache.
  const content = section === 'collections' ? <Collections key={collectionId || 'list'} id={collectionId} />
    : section === 'apps' ? <Devices />
    : section === 'agents' ? <Agents />
    : section === 'mind-map' ? <MindMap />
    : section === 'plans' ? <Plans />
    : <Settings section={section} />;
  return <AccountBoundary accountId={me.account.id}><div className="account-page">{content}</div></AccountBoundary>;
}
