import '../customer.css';
import { Suspense } from 'react';
import type { Metadata } from 'next';
import { CheckoutClient } from './checkout-client';

export const metadata: Metadata = { title: 'Checkout · Foundkeep', robots: { index: false, follow: false } };

// Render per-request (SSR) so the CSP middleware's nonce is applied to the
// script tags. A static prerender gets no per-request nonce, and with
// `strict-dynamic` that blocks every chunk — the page never hydrates and
// Paddle.js never initializes.
export const dynamic = 'force-dynamic';

export default function CheckoutPage() {
  return (
    <Suspense fallback={<main className="route-error"><h1>Opening secure checkout…</h1></main>}>
      <CheckoutClient />
    </Suspense>
  );
}
