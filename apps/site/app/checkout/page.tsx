import { Suspense } from 'react';
import type { Metadata } from 'next';
import { CheckoutClient } from './checkout-client';

export const metadata: Metadata = { title: 'Checkout · Foundkeep', robots: { index: false, follow: false } };

export default function CheckoutPage() {
  return (
    <Suspense fallback={<main className="route-error"><h1>Opening secure checkout…</h1></main>}>
      <CheckoutClient />
    </Suspense>
  );
}
