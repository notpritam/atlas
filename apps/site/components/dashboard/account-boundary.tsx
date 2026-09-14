'use client';
import { useEffect, type ReactNode } from 'react';
import { useDashboard } from './context';

/** Server page payloads must belong to the retained client session before any query is seeded. */
export function AccountBoundary({ accountId, children }: { accountId: string; children: ReactNode }) {
  const { me, endSession } = useDashboard();
  const matches = accountId === me.account.id;
  useEffect(() => {
    let active = true;
    if (!matches) queueMicrotask(() => { if (active) endSession('account_changed'); });
    return () => { active = false; };
  }, [matches, endSession]);
  return matches ? children : null;
}
