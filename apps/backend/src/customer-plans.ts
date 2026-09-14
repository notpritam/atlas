import type { Database } from 'bun:sqlite';
export type SubscriptionProvider = 'stripe' | 'revenuecat' | 'paddle';
export type SubscriptionSnapshot = { status:string; expiresAt:number; renews:boolean; sandbox:boolean };
export function writeSubscription(db: Database, accountId: string, provider: SubscriptionProvider, value: SubscriptionSnapshot, observedAt = Date.now()) {
  if (!db.query('SELECT 1 FROM customer_accounts WHERE id=?').get(accountId)) return;
  db.query(`INSERT INTO customer_subscriptions(account_id,provider,status,expires_at,renews,sandbox,updated_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(account_id,provider) DO UPDATE SET status=excluded.status,expires_at=excluded.expires_at,renews=excluded.renews,sandbox=excluded.sandbox,updated_at=excluded.updated_at
    WHERE excluded.updated_at>=customer_subscriptions.updated_at`).run(accountId,provider,value.status,value.expiresAt,Number(value.renews),Number(value.sandbox),observedAt);
}
export function accountPlan(db: Database, accountId: string, now = Date.now(), env: Record<string,string|undefined> = process.env) {
  const stored = db.query('SELECT provider,status,expires_at,renews,sandbox FROM customer_subscriptions WHERE account_id=?').all(accountId) as {provider:SubscriptionProvider;status:string;expires_at:number;renews:number;sandbox:number}[];
  const subscriptions = stored.map(row => ({ provider:row.provider,status:row.status,expiresAt:row.expires_at,renews:!!row.renews,sandbox:!!row.sandbox,
    active:row.status === 'active' && row.expires_at>now }));
  const paidPro = subscriptions.some(item => item.active);
  // An operator-controlled beta grant never invents or modifies billing rows.
  // Removing the grant preserves any genuine paid entitlement and saved data.
  const complimentaryPro = !paidPro && env.FOUNDKEEP_BETA_PRO === 'true';
  const pro = paidPro || complimentaryPro;
  return { plan: pro ? 'pro' as const : 'free' as const, pro, complimentaryPro, subscriptions,
    // Feature access is open while the initial product is being tested. Keep
    // paid subscription identity and storage accounting separate from access.
    earlyAccess:true,
    features:{ imports:true,mcp:true,managedProcessing:true, groupCollections:true },
    limits:{ monthlyProcessing:500, maxCaptures:10_000, maxBytes:pro ? 2*1024**3 : 200*1024**2 },
    price:{ currency:'USD',monthly:5 } };
}
