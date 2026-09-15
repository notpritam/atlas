import type { Hono } from 'hono';
import type { Database } from 'bun:sqlite';
import type { Auth, CustomerEnv } from './customer';
import { moduleFail as fail, type CustomerServices, type CustomerContext as C } from './customer-modules';
import { accountPlan } from './customer-plans';

const DAY = 86_400_000;
const KINDS = ['support', 'feedback', 'bug', 'idea'] as const;
type Kind = (typeof KINDS)[number];
const STATUSES = ['open', 'in_progress', 'closed'] as const;
type Status = (typeof STATUSES)[number];

/** Admins are an env allowlist (read live so it can change without a rebuild),
 *  layered on top of the normal customer session — admins sign in as themselves. */
function adminEmails(): Set<string> {
  return new Set((process.env.FOUNDKEEP_ADMIN_EMAILS ?? 'notpritamsharma@gmail.com')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean));
}
export const isAdminEmail = (email: string): boolean => adminEmails().has(email.trim().toLowerCase());

const n = (row: unknown): number => (row as { n: number }).n;

type TicketRow = { id: string; account_id: string | null; email: string; kind: Kind; subject: string; body: string; status: Status; created_at: number; updated_at: number };
const ticketDto = (t: TicketRow) => ({ id: t.id, accountId: t.account_id, email: t.email, kind: t.kind, subject: t.subject, body: t.body, status: t.status, createdAt: t.created_at, updatedAt: t.updated_at });

/** Admin analytics + support triage. All routes require an allowlisted admin. */
export function registerAdmin(app: Hono<CustomerEnv>, db: Database, services: CustomerServices) {
  const { auth, jsonBody } = services;
  function admin(c: C): Auth {
    const current = auth(c);
    if (!isAdminEmail(current.account.email)) fail(403, 'admin_required', 'This area is for FoundKeep administrators.');
    return current;
  }

  app.get('/admin/overview', c => {
    admin(c);
    const now = Date.now();
    const totalUsers = n(db.query('SELECT COUNT(*) n FROM customer_accounts').get());
    const newUsers7 = n(db.query('SELECT COUNT(*) n FROM customer_accounts WHERE created_at>?').get(now - 7 * DAY));
    const newUsers30 = n(db.query('SELECT COUNT(*) n FROM customer_accounts WHERE created_at>?').get(now - 30 * DAY));
    const activeUsers30 = n(db.query('SELECT COUNT(DISTINCT account_id) n FROM customer_captures WHERE created_at>?').get(now - 30 * DAY));
    const paidUsers = n(db.query("SELECT COUNT(*) n FROM customer_subscriptions WHERE status='active' AND expires_at>?").get(now));
    const totalSaves = n(db.query('SELECT COUNT(*) n FROM customer_captures').get());
    const storageBytes = n(db.query('SELECT COALESCE(SUM(storage_bytes),0) n FROM customer_captures').get());
    const signups = db.query("SELECT date(created_at/1000,'unixepoch') d, COUNT(*) n FROM customer_accounts WHERE created_at>? GROUP BY d ORDER BY d").all(now - 30 * DAY) as { d: string; n: number }[];
    return c.json({ totalUsers, newUsers7, newUsers30, activeUsers30, paidUsers, freeUsers: totalUsers - paidUsers, mrrUsd: paidUsers * 5, totalSaves, storageBytes, signups });
  });

  app.get('/admin/usage', c => {
    admin(c);
    const savesByType = db.query('SELECT type, COUNT(*) n FROM customer_captures GROUP BY type ORDER BY n DESC').all() as { type: string; n: number }[];
    const savesByChannel = db.query("SELECT COALESCE(saved_via,'unknown') channel, COUNT(*) n FROM customer_captures GROUP BY channel ORDER BY n DESC").all() as { channel: string; n: number }[];
    const savesByStatus = db.query('SELECT status, COUNT(*) n FROM customer_captures GROUP BY status').all() as { status: string; n: number }[];
    const collections = n(db.query('SELECT COUNT(*) n FROM customer_collections').get());
    const follows = n(db.query('SELECT COUNT(*) n FROM customer_collection_follows').get());
    const cycle = new Date().toISOString().slice(0, 7);
    const processingUsedThisCycle = n(db.query('SELECT COALESCE(SUM(used),0) n FROM customer_processing_usage WHERE cycle=?').get(cycle));
    const mediaBytes = n(db.query('SELECT COALESCE(SUM(bytes),0) n FROM customer_media_assets').get());
    return c.json({ savesByType, savesByChannel, savesByStatus, collections, follows, processingUsedThisCycle, mediaBytes });
  });

  app.get('/admin/users', c => {
    admin(c);
    const q = (c.req.query('q') || '').slice(0, 120);
    const raw = c.req.query('cursor') || '0';
    const offset = /^\d{1,6}$/.test(raw) ? Number(raw) : 0;
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = (q
      ? db.query("SELECT id,email,name,created_at FROM customer_accounts WHERE email LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 51 OFFSET ?").all(like, like, offset)
      : db.query('SELECT id,email,name,created_at FROM customer_accounts ORDER BY created_at DESC LIMIT 51 OFFSET ?').all(offset)) as { id: string; email: string; name: string; created_at: number }[];
    const hasMore = rows.length > 50;
    const users = rows.slice(0, 50).map(u => {
      const saves = n(db.query('SELECT COUNT(*) n FROM customer_captures WHERE account_id=?').get(u.id));
      const bytes = n(db.query('SELECT COALESCE(SUM(storage_bytes),0) n FROM customer_captures WHERE account_id=?').get(u.id));
      const lastActiveAt = (db.query('SELECT MAX(created_at) m FROM customer_captures WHERE account_id=?').get(u.id) as { m: number | null }).m;
      const plan = accountPlan(db, u.id);
      return { id: u.id, email: u.email, name: u.name, createdAt: u.created_at, saves, bytes, plan: plan.plan, pro: plan.pro, lastActiveAt };
    });
    return c.json({ users, nextCursor: hasMore ? String(offset + 50) : null });
  });

  app.get('/admin/users/:id', c => {
    admin(c);
    const id = c.req.param('id');
    const acc = db.query('SELECT id,email,name,created_at FROM customer_accounts WHERE id=?').get(id) as { id: string; email: string; name: string; created_at: number } | null;
    if (!acc) fail(404, 'user_not_found', 'No such user.');
    const plan = accountPlan(db, id);
    const savesByType = db.query('SELECT type,COUNT(*) n FROM customer_captures WHERE account_id=? GROUP BY type ORDER BY n DESC').all(id) as { type: string; n: number }[];
    const saves = n(db.query('SELECT COUNT(*) n FROM customer_captures WHERE account_id=?').get(id));
    const captureBytes = n(db.query('SELECT COALESCE(SUM(storage_bytes),0) n FROM customer_captures WHERE account_id=?').get(id));
    const mediaBytes = n(db.query('SELECT COALESCE(SUM(bytes),0) n FROM customer_media_assets WHERE account_id=?').get(id));
    const collections = n(db.query('SELECT COUNT(*) n FROM customer_collections WHERE owner_id=?').get(id));
    const connections = db.query('SELECT name,client_kind,created_at,last_seen_at FROM customer_connections WHERE account_id=? ORDER BY created_at DESC').all(id) as { name: string; client_kind: string; created_at: number; last_seen_at: number | null }[];
    const identities = db.query('SELECT provider,verified_email,created_at FROM customer_auth_identities WHERE account_id=?').all(id) as { provider: string; verified_email: string | null; created_at: number }[];
    const processing = db.query('SELECT cycle,used,reserved FROM customer_processing_usage WHERE account_id=? ORDER BY cycle DESC LIMIT 12').all(id) as { cycle: string; used: number; reserved: number }[];
    const recentCaptures = db.query('SELECT type,status,created_at FROM customer_captures WHERE account_id=? ORDER BY created_at DESC LIMIT 20').all(id) as { type: string; status: string; created_at: number }[];
    return c.json({
      user: { id: acc!.id, email: acc!.email, name: acc!.name, createdAt: acc!.created_at },
      plan: { plan: plan.plan, pro: plan.pro, complimentaryPro: plan.complimentaryPro },
      saves, savesByType, storage: { captureBytes, mediaBytes, totalBytes: captureBytes + mediaBytes },
      collections, connections, identities, processing, recentCaptures,
    });
  });

  app.get('/admin/support', c => {
    admin(c);
    const status = c.req.query('status');
    const rows = (status && (STATUSES as readonly string[]).includes(status)
      ? db.query('SELECT * FROM support_tickets WHERE status=? ORDER BY created_at DESC LIMIT 200').all(status)
      : db.query('SELECT * FROM support_tickets ORDER BY created_at DESC LIMIT 200').all()) as TicketRow[];
    return c.json({ tickets: rows.map(ticketDto) });
  });

  app.get('/admin/support/:id', c => {
    admin(c);
    const t = db.query('SELECT * FROM support_tickets WHERE id=?').get(c.req.param('id')) as TicketRow | null;
    if (!t) fail(404, 'ticket_not_found', 'No such ticket.');
    const notes = db.query('SELECT id,body,created_at FROM support_ticket_notes WHERE ticket_id=? ORDER BY created_at').all(t!.id) as { id: string; body: string; created_at: number }[];
    return c.json({ ticket: ticketDto(t!), notes });
  });

  app.post('/admin/support/:id', async c => {
    admin(c);
    const t = db.query('SELECT * FROM support_tickets WHERE id=?').get(c.req.param('id')) as TicketRow | null;
    if (!t) fail(404, 'ticket_not_found', 'No such ticket.');
    const body = await jsonBody(c);
    const now = Date.now();
    if (body.status !== undefined) {
      if (!(STATUSES as readonly string[]).includes(body.status as string)) fail(400, 'invalid_status', 'Choose a valid status.');
      db.query('UPDATE support_tickets SET status=?,updated_at=? WHERE id=?').run(body.status as string, now, t!.id);
    }
    if (body.note !== undefined) {
      const note = String(body.note).trim();
      if (!note || note.length > 5000) fail(400, 'invalid_note', 'Add a note of 1 to 5000 characters.');
      db.query('INSERT INTO support_ticket_notes(id,ticket_id,body,created_at) VALUES(?,?,?,?)').run(crypto.randomUUID(), t!.id, note, now);
      db.query('UPDATE support_tickets SET updated_at=? WHERE id=?').run(now, t!.id);
    }
    const updated = db.query('SELECT * FROM support_tickets WHERE id=?').get(t!.id) as TicketRow;
    const notes = db.query('SELECT id,body,created_at FROM support_ticket_notes WHERE ticket_id=? ORDER BY created_at').all(t!.id) as { id: string; body: string; created_at: number }[];
    return c.json({ ticket: ticketDto(updated), notes });
  });
}

/** User-facing support/feedback intake (any signed-in account). */
export function registerSupport(app: Hono<CustomerEnv>, db: Database, services: CustomerServices) {
  const { auth, jsonBody } = services;
  app.post('/support', async c => {
    const current = auth(c);
    const body = await jsonBody(c);
    const kind = body.kind === undefined ? 'support' : body.kind;
    if (!(KINDS as readonly string[]).includes(kind as string)) fail(400, 'invalid_kind', 'Choose a valid request type.');
    const subject = String(body.subject ?? '').trim();
    const message = String(body.body ?? '').trim();
    if (!subject || subject.length > 200) fail(400, 'invalid_subject', 'Add a subject of 1 to 200 characters.');
    if (!message || message.length > 5000) fail(400, 'invalid_body', 'Add a message of 1 to 5000 characters.');
    const now = Date.now();
    const id = crypto.randomUUID();
    db.query("INSERT INTO support_tickets(id,account_id,email,kind,subject,body,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'open',?,?)")
      .run(id, current.account.id, current.account.email, kind as string, subject, message, now, now);
    return c.json({ ticket: { id, kind, subject, status: 'open', createdAt: now } }, 201);
  });
  app.get('/support/mine', c => {
    const current = auth(c);
    const rows = db.query('SELECT id,kind,subject,status,created_at,updated_at FROM support_tickets WHERE account_id=? ORDER BY created_at DESC LIMIT 100').all(current.account.id) as { id: string; kind: string; subject: string; status: string; created_at: number; updated_at: number }[];
    return c.json({ tickets: rows.map(r => ({ id: r.id, kind: r.kind, subject: r.subject, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at })) });
  });
}
