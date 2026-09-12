import { test, expect } from 'bun:test';
import { paddleSnapshot, gateSandbox } from '../src/paddle-snapshot.ts';

const future = new Date(Date.now() + 30 * 86400_000).toISOString();

test('active subscription → active snapshot that renews', () => {
  const snap = paddleSnapshot({ status: 'active', current_billing_period: { ends_at: future }, scheduled_change: null }, { sandbox: false });
  expect(snap.status).toBe('active');
  expect(snap.expiresAt).toBeGreaterThan(Date.now());
  expect(snap.renews).toBe(true);
  expect(snap.sandbox).toBe(false);
});
test('scheduled cancel → active but not renewing', () => {
  const snap = paddleSnapshot({ status: 'active', current_billing_period: { ends_at: future }, scheduled_change: { action: 'cancel', effective_at: future } }, { sandbox: true });
  expect(snap.status).toBe('active');
  expect(snap.renews).toBe(false);
  expect(snap.sandbox).toBe(true);
});
test('canceled subscription → inactive', () => {
  const snap = paddleSnapshot({ status: 'canceled', current_billing_period: { ends_at: future } }, { sandbox: false });
  expect(snap.status).toBe('canceled');
});
test('sandbox gate downgrades to inactive when not allowed', () => {
  const active = { status: 'active', expiresAt: Date.now() + 1000, renews: true, sandbox: true };
  expect(gateSandbox(active, false).status).toBe('inactive');
  expect(gateSandbox(active, false).expiresAt).toBe(0);
  expect(gateSandbox(active, true).status).toBe('active');
});
