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
];

function migrate(db: Database): void {
  const row = db.query("PRAGMA user_version").get() as { user_version: number };
  const current = row.user_version;
  for (let i = current; i < MIGRATIONS.length; i++) {
    const sql = MIGRATIONS[i]!;
    db.transaction(() => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    })();
  }
}

export function openDb(path = join(config.dataDir, "atlas.db")): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  migrate(db);
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
