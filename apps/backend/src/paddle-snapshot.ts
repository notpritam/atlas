import type { SubscriptionSnapshot } from './customer-plans.ts';

const ts = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? Date.parse(v) : 0;

/** Map a Paddle subscription entity to our provider-agnostic snapshot.
 *  Fields to confirm against a live sandbox sub: current_billing_period.ends_at,
 *  next_billed_at, scheduled_change.action. */
export function paddleSnapshot(sub: any, opts: { sandbox: boolean }): SubscriptionSnapshot {
  const status = typeof sub?.status === 'string' ? sub.status : 'inactive';
  const active = ['active', 'trialing', 'past_due'].includes(status);
  const expiresAt = Math.max(ts(sub?.current_billing_period?.ends_at), ts(sub?.next_billed_at));
  const cancelScheduled = sub?.scheduled_change?.action === 'cancel';
  return { status, expiresAt, renews: active && !cancelScheduled, sandbox: opts.sandbox };
}

/** Write-time sandbox gate: a sandbox subscription grants nothing unless the
 *  account is explicitly allow-listed. Mirrors the RevenueCat gate. */
export function gateSandbox(snapshot: SubscriptionSnapshot, allowed: boolean): SubscriptionSnapshot {
  if (snapshot.sandbox && !allowed) return { status: 'inactive', expiresAt: 0, renews: false, sandbox: true };
  return snapshot;
}
