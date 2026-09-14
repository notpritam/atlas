import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSession } from '../../lib/server';
import DashboardShell from '../../components/dashboard/shell';
import '../customer.css';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const me = await getSession();
  if (!me) redirect('/login');
  return <DashboardShell key={me.account.id} me={me}>{children}</DashboardShell>;
}
