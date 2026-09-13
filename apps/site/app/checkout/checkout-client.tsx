'use client';

import { CheckoutEventNames, initializePaddle, type Environments, type Paddle } from '@paddle/paddle-js';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export function CheckoutClient() {
  const ptxn = useSearchParams().get('_ptxn');
  const router = useRouter();
  const [error, setError] = useState(false);

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    const environment = process.env.NEXT_PUBLIC_PADDLE_ENV as Environments | undefined;
    if (!token || !environment || !ptxn) { setError(true); return; }
    let paddle: Paddle | undefined;
    let cancelled = false;
    let completed = false;
    initializePaddle({
      token,
      environment,
      eventCallback: (event) => {
        if (cancelled) return;
        if (event.name === CheckoutEventNames.CHECKOUT_COMPLETED) { completed = true; router.replace('/dashboard/plans?billing=success'); }
        if (!completed && event.name === CheckoutEventNames.CHECKOUT_CLOSED) router.replace('/dashboard/plans?billing=cancelled');
      },
    })
      .then((instance) => {
        if (cancelled) return;
        if (!instance) { setError(true); return; }
        paddle = instance;
        paddle.Checkout.open({ transactionId: ptxn });
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => {
      cancelled = true;
      try { paddle?.Checkout.close(); } catch { /* checkout already closed */ }
    };
  }, [ptxn, router]);

  if (error) {
    return (
      <main className="route-error">
        <h1>Couldn’t open checkout.</h1>
        <p>We weren’t able to start your checkout. Please check your plan before trying again.</p>
        <a href="/dashboard/plans">Back to plans</a>
      </main>
    );
  }

  return (
    <main className="route-error">
      <h1>Opening secure checkout…</h1>
      <p>Hang tight while we connect to Paddle.</p>
    </main>
  );
}
