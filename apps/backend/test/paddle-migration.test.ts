import { test, expect } from 'bun:test';
import { openDb } from '../src/db.ts';

test('paddle provider row and paddle_id column exist after migration', () => {
  const db = openDb(':memory:');
  db.query("INSERT INTO customer_accounts(id,email,name,password_hash,recovery_hash,created_at) VALUES('a1','a@b.co','Test','x','x',0)").run();
  // paddle provider now allowed by the CHECK:
  db.query("INSERT INTO customer_subscriptions(account_id,provider,status,expires_at,renews,sandbox,updated_at,next_check_at) VALUES('a1','paddle','active',9999999999999,1,1,1,0)").run();
  const row = db.query("SELECT provider FROM customer_subscriptions WHERE account_id='a1'").get() as {provider:string};
  expect(row.provider).toBe('paddle');
  // paddle_id column exists and is unique:
  db.query("INSERT INTO customer_billing_identities(account_id,revenuecat_id,created_at,paddle_id) VALUES('a1','fk_x',0,'ctm_1')").run();
  expect(() => db.query("INSERT INTO customer_accounts(id,email,name,password_hash,recovery_hash,created_at) VALUES('a2','c@d.co','Test','x','x',0)").run()).not.toThrow();
  expect(() => db.query("INSERT INTO customer_billing_identities(account_id,revenuecat_id,created_at,paddle_id) VALUES('a2','fk_y',0,'ctm_1')").run()).toThrow();
});
