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
    initializePaddle({
      token,
      environment,
      eventCallback: (event) => {
        if (event.name === CheckoutEventNames.CHECKOUT_COMPLETED) router.replace('/dashboard?billing=success');
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
        <p>We weren’t able to start your checkout. Your card has not been charged. Please try again from your dashboard.</p>
        <a href="/dashboard">Back to dashboard</a>
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
