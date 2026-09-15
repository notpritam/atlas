import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession, serverApi } from '../../lib/server';
import { ApiError } from '../../lib/api';
import './console.css';

export const metadata = { title: 'FoundKeep Console', robots: { index: false, follow: false } };

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const me = await getSession();
  if (!me) redirect('/login');
  try {
    await serverApi('/admin/me');
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 401)) redirect('/dashboard');
    throw error;
  }
  return (
    <div className="console-root">
      <nav className="console-nav">
        <span className="brand">FoundKeep Console</span>
        <Link href="/console">Overview</Link>
        <Link href="/console/users">Users</Link>
        <Link href="/console/usage">Usage</Link>
        <Link href="/console/support">Support</Link>
        <a href="/dashboard" style={{ marginLeft: 'auto' }}>← Library</a>
      </nav>
      <main className="console">{children}</main>
    </div>
  );
}
