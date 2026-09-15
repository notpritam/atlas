import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Association, Capture, SelectionContext } from "@atlas/shared";
import { config } from "./config.ts";

/** The `captures` row as stored (snake_case). */
export interface CaptureRow {
  id: string;
  type: string;
  status: string;
  source_url: string | null;
  source_title: string | null;
  favicon_url: string | null;
  selection_text: string | null;
  selection_context: string | null;
  note_text: string | null;
  blob_path: string | null;
  blob_mime: string | null;
  blob_bytes: number | null;
  blob_sha256: string | null;
  thumb_path: string | null;
  width: number | null;
  height: number | null;
  ocr_text: string | null;
  description: string | null;
  summary: string | null;
  category: string | null;
  tags: string | null;
  associations: string | null;
  article_text: string | null;
  lang: string | null;
  model: string | null;
  enrich_error: string | null;
  enrich_attempts: number;
  lease_owner: string | null;
  lease_at: number | null;
  device_id: string | null;
  captured_at: number | null;
  created_at: number;
  updated_at: number;
  enriched_at: number | null;
}

/**
 * Append-only migrations. Never reorder or edit a shipped entry — only push new
 * ones. Applied count is tracked in `PRAGMA user_version`.
 */
const MIGRATIONS: string[] = [
  // 0 — captures + indexes
  `
  CREATE TABLE captures (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    source_url TEXT,
    source_title TEXT,
    favicon_url TEXT,
    selection_text TEXT,
    selection_context TEXT,
    note_text TEXT,
    blob_path TEXT,
    blob_mime TEXT,
    blob_bytes INTEGER,
    blob_sha256 TEXT,
    thumb_path TEXT,
    width INTEGER,
    height INTEGER,
    ocr_text TEXT,
    description TEXT,
    summary TEXT,
    category TEXT,
    tags TEXT,
    associations TEXT,
    article_text TEXT,
    lang TEXT,
    model TEXT,
    enrich_error TEXT,
    enrich_attempts INTEGER NOT NULL DEFAULT 0,
    lease_owner TEXT,
    lease_at INTEGER,
    device_id TEXT,
    captured_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    enriched_at INTEGER
  );
  CREATE INDEX idx_captures_status ON captures(status, created_at);
  CREATE INDEX idx_captures_type ON captures(type);
  CREATE INDEX idx_captures_created ON captures(created_at DESC, id DESC);
  CREATE INDEX idx_captures_sha ON captures(blob_sha256);
  `,
  // 1 — FTS5 external-content mirror + sync triggers
  `
  CREATE VIRTUAL TABLE captures_fts USING fts5(
    source_title, note_text, selection_text, ocr_text,
    summary, description, article_text, tags,
    content='captures', content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER captures_ai AFTER INSERT ON captures BEGIN
    INSERT INTO captures_fts(rowid, source_title, note_text, selection_text, ocr_text, summary, description, article_text, tags)
    VALUES (new.rowid, new.source_title, new.note_text, new.selection_text, new.ocr_text, new.summary, new.description, new.article_text, new.tags);
  END;
  CREATE TRIGGER captures_ad AFTER DELETE ON captures BEGIN
    INSERT INTO captures_fts(captures_fts, rowid, source_title, note_text, selection_text, ocr_text, summary, description, article_text, tags)
    VALUES ('delete', old.rowid, old.source_title, old.note_text, old.selection_text, old.ocr_text, old.summary, old.description, old.article_text, old.tags);
  END;
  CREATE TRIGGER captures_au AFTER UPDATE ON captures BEGIN
    INSERT INTO captures_fts(captures_fts, rowid, source_title, note_text, selection_text, ocr_text, summary, description, article_text, tags)
    VALUES ('delete', old.rowid, old.source_title, old.note_text, old.selection_text, old.ocr_text, old.summary, old.description, old.article_text, old.tags);
    INSERT INTO captures_fts(rowid, source_title, note_text, selection_text, ocr_text, summary, description, article_text, tags)
    VALUES (new.rowid, new.source_title, new.note_text, new.selection_text, new.ocr_text, new.summary, new.description, new.article_text, new.tags);
  END;
  `,
  // 2 — devices (auth tokens; only the hash is stored)
  `
  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    token_sha256 TEXT NOT NULL UNIQUE,
    scopes TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER,
    revoked_at INTEGER
  );
  `,
  // 3 — invite codes (self-serve onboarding: redeem a code → get a token)
  `
  CREATE TABLE invite_codes (
    id TEXT PRIMARY KEY,
    code_sha256 TEXT NOT NULL UNIQUE,
    scopes TEXT NOT NULL,
    uses_left INTEGER NOT NULL,
    redeemed_count INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
  );
  `,
  // 4 — customer accounts, isolated credentials and private captures.
  `
  CREATE TABLE customer_accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    recovery_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE customer_sessions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX customer_sessions_account ON customer_sessions(account_id);
  CREATE TABLE customer_connections (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX customer_connections_account ON customer_connections(account_id);
  CREATE TABLE customer_pairings (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX customer_pairings_account ON customer_pairings(account_id);
  CREATE TABLE customer_captures (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    source_url TEXT,
    source_title TEXT,
    selection_text TEXT,
    note_text TEXT,
    article_text TEXT,
    blob_data BLOB,
    blob_mime TEXT,
    blob_bytes INTEGER NOT NULL DEFAULT 0,
    storage_bytes INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    captured_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    summary TEXT,
    ocr_text TEXT,
    category TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    enrich_error TEXT,
    enrich_attempts INTEGER NOT NULL DEFAULT 0,
    processing_at INTEGER,
    UNIQUE(account_id, client_id)
  );
  CREATE INDEX customer_captures_owner_date ON customer_captures(account_id, captured_at DESC, id DESC);
  CREATE INDEX customer_captures_status ON customer_captures(status, created_at);
  `,
  // 5 — customer-owned extension preferences.
  `
  CREATE TABLE customer_preferences (
    account_id TEXT PRIMARY KEY REFERENCES customer_accounts(id) ON DELETE CASCADE,
    value_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
  );
  `,
  // 6 — customer capture provenance and immutable processing choices.
  `
  ALTER TABLE customer_captures ADD COLUMN provenance_json TEXT;
  ALTER TABLE customer_captures ADD COLUMN processing_options_json TEXT;
  `,
  // 7 — universal mobile capture metadata and file-backed payloads.
  `
  ALTER TABLE customer_captures ADD COLUMN batch_id TEXT;
  ALTER TABLE customer_captures ADD COLUMN file_name TEXT;
  ALTER TABLE customer_captures ADD COLUMN file_path TEXT;
  ALTER TABLE customer_captures ADD COLUMN file_mime TEXT;
  ALTER TABLE customer_captures ADD COLUMN file_bytes INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX customer_captures_owner_batch ON customer_captures(account_id, batch_id);
  `,
  // 8 — opt-in mobile push routing, scoped to a revocable connection.
  `
  CREATE TABLE customer_push_devices (
    connection_id TEXT PRIMARY KEY REFERENCES customer_connections(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
    expo_push_token TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX customer_push_devices_account ON customer_push_devices(account_id, enabled);
  `,
  // 9 — account-owned folders and personal tags, separate from enrichment.
  `
  CREATE TABLE customer_folders (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(account_id, normalized_name)
  );
  ALTER TABLE customer_captures ADD COLUMN manual_tags TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE customer_captures ADD COLUMN folder_id TEXT REFERENCES customer_folders(id) ON DELETE SET NULL;
  CREATE INDEX customer_captures_owner_folder ON customer_captures(account_id, folder_id);
  `,
  // Backend-owned social identities and short-lived OAuth transactions.
  `
  CREATE TABLE customer_auth_identities (
    issuer TEXT NOT NULL, subject TEXT NOT NULL,
    account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
    provider TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY(issuer,subject), UNIQUE(account_id,issuer)
  );
  CREATE TABLE customer_oauth_flows (
    id TEXT PRIMARY KEY, issuer TEXT NOT NULL, provider TEXT NOT NULL,
    client TEXT NOT NULL, intent TEXT NOT NULL, device_name TEXT NOT NULL,
    account_id TEXT, credential_id TEXT, credential_kind TEXT,
    client_challenge TEXT NOT NULL, server_verifier TEXT NOT NULL,
    browser_hash TEXT, stage TEXT NOT NULL, code_hash TEXT, identity_json TEXT,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX customer_oauth_expiry ON customer_oauth_flows(expires_at);
  CREATE TABLE customer_auth_proofs (
    token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL, credential_kind TEXT NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE TABLE customer_auth_cleanup (
    issuer TEXT NOT NULL, subject TEXT NOT NULL, created_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(issuer,subject)
  );
  CREATE TABLE customer_auth_tombstones (
    issuer TEXT NOT NULL, subject TEXT NOT NULL, expires_at INTEGER NOT NULL,
    PRIMARY KEY(issuer,subject)
  );
  `,
  // Several verified provider subjects may own the same Foundkeep library.
  // The subject remains globally unique within its issuer; never rebind it.
  `
  CREATE TABLE customer_auth_identities_linked (
    issuer TEXT NOT NULL, subject TEXT NOT NULL,
    account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
    provider TEXT NOT NULL, created_at INTEGER NOT NULL,
    verified_email TEXT NOT NULL,
    PRIMARY KEY(issuer,subject)
  );
  INSERT INTO customer_auth_identities_linked
    SELECT i.issuer,i.subject,i.account_id,i.provider,i.created_at,''
    FROM customer_auth_identities i JOIN customer_accounts a ON a.id=i.account_id;
  DROP TABLE customer_auth_identities;
  ALTER TABLE customer_auth_identities_linked RENAME TO customer_auth_identities;
  CREATE INDEX customer_auth_verified_email ON customer_auth_identities(account_id,issuer,verified_email);
  -- Legacy mappings remain valid, but need a new provider verification before
  -- their email can authorize additional subjects. Pending old flows lack it.
  DELETE FROM customer_oauth_flows;
  `,
  // Client kind is recorded by the issuing route, never guessed from device names.
  `ALTER TABLE customer_connections ADD COLUMN client_kind TEXT NOT NULL DEFAULT 'unknown'
    CHECK(client_kind IN ('unknown','browser','mobile'));`,
  // Collection arrival order and immutable saving-client metadata.
  `ALTER TABLE customer_captures ADD COLUMN saved_via TEXT
    CHECK(saved_via IN ('iphone','browser','dashboard'));
   CREATE INDEX customer_captures_owner_saved ON customer_captures(account_id,created_at DESC,id DESC);`,
  // Folder hierarchy and bounded, resumable bookmark imports.
  `ALTER TABLE customer_folders ADD COLUMN parent_id TEXT REFERENCES customer_folders(id);
   CREATE INDEX customer_folders_parent ON customer_folders(account_id,parent_id);
   CREATE INDEX customer_captures_source ON customer_captures(account_id,source_url);
   CREATE TABLE customer_import_chunks (
     account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
     import_id TEXT NOT NULL, chunk INTEGER NOT NULL, digest TEXT NOT NULL,
     result_json TEXT NOT NULL, created_at INTEGER NOT NULL,
     PRIMARY KEY(account_id,import_id,chunk)
   );
   CREATE TABLE customer_import_origins (
     capture_id TEXT NOT NULL REFERENCES customer_captures(id) ON DELETE CASCADE,
     fingerprint TEXT NOT NULL, origin_json TEXT NOT NULL,
     PRIMARY KEY(capture_id,fingerprint)
   );`,
  // Keep each purchase provider authoritative for its own entitlement.
  `CREATE TABLE customer_billing_identities (
    account_id TEXT PRIMARY KEY REFERENCES customer_accounts(id) ON DELETE CASCADE,
    revenuecat_id TEXT NOT NULL UNIQUE, stripe_id TEXT UNIQUE,
    created_at INTEGER NOT NULL
   );
   CREATE TABLE customer_subscriptions (
    account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK(provider IN ('stripe','revenuecat')),
    status TEXT NOT NULL, expires_at INTEGER NOT NULL, renews INTEGER NOT NULL DEFAULT 0,
    sandbox INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
    PRIMARY KEY(account_id,provider)
   );
   CREATE TABLE customer_billing_events (
    provider TEXT NOT NULL, event_id TEXT NOT NULL, processed_at INTEGER NOT NULL,
    PRIMARY KEY(provider,event_id)
   );`,

  // Account removal must not orphan a renewing web subscription or provider identity.
  `CREATE TABLE customer_billing_cleanup (
     provider TEXT NOT NULL, external_id TEXT NOT NULL, created_at INTEGER NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY(provider,external_id)
   );
   CREATE TRIGGER customer_billing_identity_cleanup BEFORE DELETE ON customer_billing_identities BEGIN
     INSERT OR IGNORE INTO customer_billing_cleanup(provider,external_id,created_at)
       SELECT 'stripe',OLD.stripe_id,CAST(strftime('%s','now') AS INTEGER)*1000 WHERE OLD.stripe_id IS NOT NULL;
     INSERT OR IGNORE INTO customer_billing_cleanup(provider,external_id,created_at)
       VALUES('revenuecat',OLD.revenuecat_id,CAST(strftime('%s','now') AS INTEGER)*1000);
   END;`,

  `ALTER TABLE customer_billing_identities ADD COLUMN checkout_id TEXT;
   ALTER TABLE customer_billing_identities ADD COLUMN checkout_attempt TEXT;`,

  // Hosted processing is explicit, account-scoped and separate from original saves.
  `CREATE TABLE customer_automation (
     account_id TEXT PRIMARY KEY REFERENCES customer_accounts(id) ON DELETE CASCADE,
     enabled INTEGER NOT NULL DEFAULT 0, fetch_links INTEGER NOT NULL DEFAULT 0,
     images INTEGER NOT NULL DEFAULT 0, consent_version TEXT, enabled_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE customer_processing_jobs (
     id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
     capture_id TEXT NOT NULL REFERENCES customer_captures(id) ON DELETE CASCADE,
     source_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', reason TEXT NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER,
     cycle TEXT NOT NULL, credit INTEGER NOT NULL DEFAULT 0, error TEXT,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
     UNIQUE(account_id,capture_id,source_hash)
   );
   CREATE INDEX customer_processing_pending ON customer_processing_jobs(status,updated_at);
   CREATE TABLE customer_processing_usage (
     account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
     cycle TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, reserved INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY(account_id,cycle)
   );
   CREATE TABLE customer_processing_budget (day TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE customer_processing_results (
     capture_id TEXT PRIMARY KEY REFERENCES customer_captures(id) ON DELETE CASCADE,
     account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
     source_hash TEXT NOT NULL, model TEXT NOT NULL, result_json TEXT NOT NULL,
     source_json TEXT, storage_bytes INTEGER NOT NULL, created_at INTEGER NOT NULL
   );
   CREATE TABLE customer_capture_links (
     account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
     source_id TEXT NOT NULL REFERENCES customer_captures(id) ON DELETE CASCADE,
     target_id TEXT NOT NULL REFERENCES customer_captures(id) ON DELETE CASCADE,
     origin TEXT NOT NULL, created_at INTEGER NOT NULL,
     PRIMARY KEY(account_id,source_id,target_id,origin), CHECK(source_id<>target_id)
   );
   CREATE TRIGGER customer_processing_release BEFORE DELETE ON customer_processing_jobs WHEN OLD.credit=1 BEGIN
     UPDATE customer_processing_usage SET reserved=MAX(0,reserved-1) WHERE account_id=OLD.account_id AND cycle=OLD.cycle;
   END;`,

  // Customer agent credentials never reuse browser or mobile session tokens.
  `CREATE TABLE customer_agent_tokens (
     id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
     name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, scopes_json TEXT NOT NULL,
     created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen_at INTEGER
   );
   CREATE TABLE customer_agent_nudges (
     id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
     text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, completed_at INTEGER
   );
   CREATE TABLE customer_changes (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
     entity TEXT NOT NULL, entity_id TEXT NOT NULL, operation TEXT NOT NULL, revision INTEGER NOT NULL
   );
   CREATE INDEX customer_changes_owner ON customer_changes(account_id,seq);
   CREATE TABLE customer_change_floor (
     account_id TEXT PRIMARY KEY REFERENCES customer_accounts(id) ON DELETE CASCADE,
     seq INTEGER NOT NULL DEFAULT 0
   );
   INSERT INTO customer_changes(account_id,entity,entity_id,operation,revision)
     SELECT account_id,'capture',id,'upsert',updated_at FROM customer_captures ORDER BY created_at,id;
   CREATE TRIGGER customer_changes_capture_insert AFTER INSERT ON customer_captures BEGIN
     INSERT INTO customer_changes(account_id,entity,entity_id,operation,revision)
       SELECT NEW.account_id,'capture',NEW.id,'upsert',NEW.updated_at WHERE EXISTS(SELECT 1 FROM customer_accounts WHERE id=NEW.account_id);
   END;
   CREATE TRIGGER customer_changes_capture_update AFTER UPDATE ON customer_captures BEGIN
     INSERT INTO customer_changes(account_id,entity,entity_id,operation,revision)
       SELECT NEW.account_id,'capture',NEW.id,'upsert',NEW.updated_at WHERE EXISTS(SELECT 1 FROM customer_accounts WHERE id=NEW.account_id);
   END;
   CREATE TRIGGER customer_changes_capture_delete AFTER DELETE ON customer_captures BEGIN
     INSERT INTO customer_changes(account_id,entity,entity_id,operation,revision)
       SELECT OLD.account_id,'capture',OLD.id,'delete',OLD.updated_at WHERE EXISTS(SELECT 1 FROM customer_accounts WHERE id=OLD.account_id);
   END;
   CREATE TRIGGER customer_changes_folder_insert AFTER INSERT ON customer_folders BEGIN
     INSERT INTO customer_changes(account_id,entity,entity_id,operation,revision)
       SELECT NEW.account_id,'folder',NEW.id,'upsert',NEW.updated_at WHERE EXISTS(SELECT 1 FROM customer_accounts WHERE id=NEW.account_id);
   END;
   CREATE TRIGGER customer_changes_folder_update AFTER UPDATE ON customer_folders BEGIN
     INSERT INTO customer_changes(account_id,entity,entity_id,operation,revision)
       SELECT NEW.account_id,'folder',NEW.id,'upsert',NEW.updated_at WHERE EXISTS(SELECT 1 FROM customer_accounts WHERE id=NEW.account_id);
   END;
   CREATE TRIGGER customer_changes_folder_delete AFTER DELETE ON customer_folders BEGIN
     INSERT INTO customer_changes(account_id,entity,entity_id,operation,revision)
       SELECT OLD.account_id,'folder',OLD.id,'delete',OLD.updated_at WHERE EXISTS(SELECT 1 FROM customer_accounts WHERE id=OLD.account_id);
   END;
   CREATE TRIGGER customer_nudge_changes AFTER INSERT ON customer_agent_nudges BEGIN
     INSERT INTO customer_changes(account_id,entity,entity_id,operation,revision) VALUES(NEW.account_id,'nudge',NEW.id,'upsert',NEW.created_at);
   END;`,

  `CREATE TABLE customer_derivatives (
     account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
     capture_id TEXT NOT NULL REFERENCES customer_captures(id) ON DELETE CASCADE,
     kind TEXT NOT NULL, mime TEXT NOT NULL, data BLOB NOT NULL, bytes INTEGER NOT NULL,
     source_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
     PRIMARY KEY(capture_id,kind)
   );`,

  `ALTER TABLE customer_subscriptions ADD COLUMN next_check_at INTEGER NOT NULL DEFAULT 0;`,
  `CREATE TABLE customer_purchase_attempts (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('purchase','restore')), expires_at INTEGER NOT NULL
  ); CREATE INDEX customer_purchase_attempts_owner ON customer_purchase_attempts(account_id,expires_at);`,

  // Rebuild customer_subscriptions to allow the 'paddle' provider (SQLite can't
  // alter a CHECK in place). Reproduce the CURRENT shape incl. next_check_at.
  `CREATE TABLE customer_subscriptions_new (
    account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK(provider IN ('stripe','revenuecat','paddle')),
    status TEXT NOT NULL, expires_at INTEGER NOT NULL, renews INTEGER NOT NULL DEFAULT 0,
    sandbox INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
    next_check_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(account_id,provider)
   );
   INSERT INTO customer_subscriptions_new (account_id,provider,status,expires_at,renews,sandbox,updated_at,next_check_at)
     SELECT account_id,provider,status,expires_at,renews,sandbox,updated_at,next_check_at FROM customer_subscriptions;
   DROP TABLE customer_subscriptions;
   ALTER TABLE customer_subscriptions_new RENAME TO customer_subscriptions;`,

  // Paddle customer id + partial-unique index; extend the cleanup trigger.
  `ALTER TABLE customer_billing_identities ADD COLUMN paddle_id TEXT;
   CREATE UNIQUE INDEX customer_billing_identities_paddle ON customer_billing_identities(paddle_id) WHERE paddle_id IS NOT NULL;
   DROP TRIGGER customer_billing_identity_cleanup;
   CREATE TRIGGER customer_billing_identity_cleanup BEFORE DELETE ON customer_billing_identities BEGIN
     INSERT OR IGNORE INTO customer_billing_cleanup(provider,external_id,created_at)
       SELECT 'stripe',OLD.stripe_id,CAST(strftime('%s','now') AS INTEGER)*1000 WHERE OLD.stripe_id IS NOT NULL;
     INSERT OR IGNORE INTO customer_billing_cleanup(provider,external_id,created_at)
       VALUES('revenuecat',OLD.revenuecat_id,CAST(strftime('%s','now') AS INTEGER)*1000);
     INSERT OR IGNORE INTO customer_billing_cleanup(provider,external_id,created_at)
       SELECT 'paddle',OLD.paddle_id,CAST(strftime('%s','now') AS INTEGER)*1000 WHERE OLD.paddle_id IS NOT NULL;
   END;`,

  // Deliberate sharing lives separately from private library organization.
  `CREATE TABLE customer_collections (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
    slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]', rules TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL CHECK(kind IN ('personal','group')),
    visibility TEXT NOT NULL CHECK(visibility IN ('private','public')),
    submission_policy TEXT NOT NULL CHECK(submission_policy IN ('owner','members','anyone')),
    require_approval INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );
   CREATE INDEX customer_collections_owner ON customer_collections(owner_id,updated_at DESC);
   CREATE INDEX customer_collections_public ON customer_collections(visibility,updated_at DESC);
   CREATE TABLE customer_collection_members (
    collection_id TEXT NOT NULL REFERENCES customer_collections(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('viewer','contributor','moderator')),
    accepted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
    PRIMARY KEY(collection_id,account_id)
   );
   CREATE INDEX customer_collection_members_account ON customer_collection_members(account_id,accepted);
   CREATE TABLE customer_collection_follows (
    collection_id TEXT NOT NULL REFERENCES customer_collections(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL, PRIMARY KEY(collection_id,account_id)
   );
   CREATE INDEX customer_collection_follows_account ON customer_collection_follows(account_id);
   CREATE TABLE customer_collection_entries (
    id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES customer_collections(id) ON DELETE CASCADE,
    contributor_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
    capture_id TEXT REFERENCES customer_captures(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL, title TEXT NOT NULL, url TEXT, body TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]', share_image INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    UNIQUE(contributor_id,client_id)
   );
   CREATE INDEX customer_collection_entries_collection ON customer_collection_entries(collection_id,status,created_at DESC,id);
   CREATE INDEX customer_collection_entries_capture ON customer_collection_entries(capture_id);`,
  // Timing and user budgets remain independent from processing consent.
  `ALTER TABLE customer_automation ADD COLUMN mode TEXT NOT NULL DEFAULT 'instant';
   ALTER TABLE customer_automation ADD COLUMN interval_hours INTEGER NOT NULL DEFAULT 24;
   ALTER TABLE customer_automation ADD COLUMN monthly_limit INTEGER NOT NULL DEFAULT 500;
   ALTER TABLE customer_automation ADD COLUMN next_run_at INTEGER;`,
  // A due scheduled cohort survives bounded pages, quota holds and worker restarts.
  `ALTER TABLE customer_automation ADD COLUMN scheduled_cutoff INTEGER;`,
  // Durable social preservation is independent of managed AI processing.
  `CREATE TABLE customer_preservation_jobs (
    capture_id TEXT PRIMARY KEY REFERENCES customer_captures(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
    source_url TEXT NOT NULL, context_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT, lease_token TEXT, lease_until INTEGER, next_attempt_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );
   CREATE INDEX customer_preservation_queue ON customer_preservation_jobs(status,next_attempt_at);
   CREATE TABLE customer_media_assets (
    id TEXT PRIMARY KEY, capture_id TEXT NOT NULL REFERENCES customer_captures(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES customer_accounts(id) ON DELETE CASCADE,
    source_key TEXT NOT NULL, source_url TEXT NOT NULL, kind TEXT NOT NULL,
    position INTEGER NOT NULL, title TEXT NOT NULL, mime TEXT NOT NULL,
    file_path TEXT, body_text TEXT, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
    created_at INTEGER NOT NULL, UNIQUE(capture_id,source_key)
   );
   CREATE INDEX customer_media_files ON customer_media_assets(file_path);`,
  // Support tickets + feedback intake and admin triage notes.
  `CREATE TABLE support_tickets (
    id TEXT PRIMARY KEY,
    account_id TEXT REFERENCES customer_accounts(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('support','feedback','bug','idea')) DEFAULT 'support',
    subject TEXT NOT NULL, body TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('open','in_progress','closed')) DEFAULT 'open',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );
   CREATE INDEX support_tickets_status ON support_tickets(status,created_at);
   CREATE INDEX support_tickets_account ON support_tickets(account_id,created_at);
   CREATE TABLE support_ticket_notes (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    body TEXT NOT NULL, created_at INTEGER NOT NULL
   );
   CREATE INDEX support_ticket_notes_ticket ON support_ticket_notes(ticket_id,created_at);`,
];

export const DATABASE_SCHEMA_VERSION = MIGRATIONS.length;
function migrate(db: Database, targetVersion = DATABASE_SCHEMA_VERSION): void {
  const row = db.query("PRAGMA user_version").get() as { user_version: number };
  const current = row.user_version;
  if (!Number.isInteger(targetVersion) || targetVersion < current || targetVersion > DATABASE_SCHEMA_VERSION) throw new Error("Invalid database migration target.");
  for (let i = current; i < targetVersion; i++) {
    const sql = MIGRATIONS[i]!;
    db.transaction(() => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    })();
  }
}

export function openDb(path = join(config.dataDir, "atlas.db"), targetVersion = DATABASE_SCHEMA_VERSION): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db, targetVersion);
  return db;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Map a stored row to the public Capture DTO (never leaks blob paths). */
export function rowToCapture(row: CaptureRow): Capture {
  return {
    id: row.id,
    type: row.type as Capture["type"],
    status: row.status as Capture["status"],
    sourceUrl: row.source_url,
    sourceTitle: row.source_title,
    faviconUrl: row.favicon_url,
    selectionText: row.selection_text,
    selectionContext: parseJson<SelectionContext | null>(
      row.selection_context,
      null,
    ),
    noteText: row.note_text,
    blobMime: row.blob_mime,
    blobBytes: row.blob_bytes,
    width: row.width,
    height: row.height,
    hasBlob: !!row.blob_path,
    hasThumb: !!row.thumb_path,
    ocrText: row.ocr_text,
    description: row.description,
    summary: row.summary,
    category: row.category,
    tags: parseJson<string[]>(row.tags, []),
    associations: parseJson<Association[]>(row.associations, []),
    articleText: row.article_text,
    lang: row.lang,
    model: row.model,
    enrichError: row.enrich_error,
    enrichAttempts: row.enrich_attempts,
    deviceId: row.device_id,
    capturedAt: row.captured_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    enrichedAt: row.enriched_at,
  };
}

export function getCaptureRow(db: Database, id: string): CaptureRow | null {
  return (db.query("SELECT * FROM captures WHERE id = ?").get(id) as
    | CaptureRow
    | undefined) ?? null;
}
