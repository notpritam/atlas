'use client';

import {useTransition} from 'react';
import {useRouter} from 'next/navigation';

export function AuthSessionRetry() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <div>
    <h2 id="auth-title">Let’s try that again.</h2>
    <p className="muted">We couldn’t check your account right now. Please retry when FoundKeep is reachable.</p>
    <button id="auth-session-retry" className="button primary wide" type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? 'Checking your account…' : 'Try again'}</button>
  </div>;
}
