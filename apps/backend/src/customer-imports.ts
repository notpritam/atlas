import { createHash } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import type { Hono } from 'hono';
import type { CustomerEnv } from './customer.ts';
import { type CustomerServices, moduleFail } from './customer-modules.ts';
import { createFolder, organizationName, foldName, organizationBytes } from './customer-organization.ts';

const SOURCES = new Set(['chrome', 'edge', 'brave', 'firefox', 'safari', 'opera', 'vivaldi', 'raindrop', 'html']);
type Entry = { url: string; title: string; folderPath: string[]; addedAt: number | null; description: string | null; tags: string[]; sourceId: string | null };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function bookmarkUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function normalize(body: Record<string, unknown>, max: number) {
  if (typeof body.source !== 'string' || !SOURCES.has(body.source)) moduleFail(400, 'invalid_import', 'Choose a supported bookmark source.');
  if (!Array.isArray(body.entries) || body.entries.length > max) moduleFail(400, 'invalid_import', `Send at most ${max} bookmarks at a time.`);
  const entries: Entry[] = []; let skipped = 0;
  for (const raw of body.entries) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { skipped++; continue; }
    const url = bookmarkUrl(raw.url);
    if (!url) { skipped++; continue; }
    if (!Array.isArray(raw.folderPath) || raw.folderPath.length > 20) moduleFail(400, 'invalid_import', 'Use at most 20 folder levels.');
    if (raw.tags !== undefined && (!Array.isArray(raw.tags) || raw.tags.length > 20)) moduleFail(400, 'invalid_import', 'Use at most 20 tags.');
    const names = new Map<string, string>();
    for (const rawTag of raw.tags || []) { const tag = organizationName(rawTag,40,'A tag'); names.set(foldName(tag),tag); }
    const bounded = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max) || null : null;
    entries.push({ url, title: bounded(raw.title,500) || new URL(url).hostname, folderPath: raw.folderPath.map((name: unknown) => organizationName(name,80,'A folder name')),
      addedAt: Number.isSafeInteger(raw.addedAt) && raw.addedAt >= 0 && raw.addedAt <= Date.now()+86_400_000 ? raw.addedAt : null,
      description: bounded(raw.description,2000), tags: [...names.values()], sourceId: bounded(raw.sourceId,100) });
  }
  return { source: body.source, entries, skipped };
}
function existingUrls(db: Database, accountId: string) {
  const rows = db.query('SELECT id,source_url FROM customer_captures WHERE account_id=? AND source_url IS NOT NULL ORDER BY created_at,id').all(accountId) as {id:string;source_url:string}[];
  const urls = new Map<string,string>();
  for (const row of rows) { const url = bookmarkUrl(row.source_url); if (url && !urls.has(url)) urls.set(url,row.id); }
  return urls;
}
export function importOrigins(db: Database, captureId: string, accountId: string) {
  return (db.query(`SELECT o.origin_json FROM customer_import_origins o JOIN customer_captures c ON c.id=o.capture_id
    WHERE c.id=? AND c.account_id=? ORDER BY o.rowid`).all(captureId,accountId) as {origin_json:string}[]).map(row => JSON.parse(row.origin_json));
}
export function registerCustomerImports(app: Hono<CustomerEnv>, db: Database, services: CustomerServices) {
  app.post('/imports/preview', async c => {
    const current = services.auth(c); services.rate(`import-preview:${current.account.id}`,20,60_000);
    const input = normalize(await services.jsonBody(c,8*1024*1024),10_000);
    services.auth(c,false,false);
    const urls = existingUrls(db,current.account.id); const folders = new Set<string>(); let duplicates = 0;
    for (const entry of input.entries) {
      if (urls.has(entry.url)) duplicates++; else urls.set(entry.url,'new');
      for (let level=1;level<=entry.folderPath.length;level++) folders.add(JSON.stringify(entry.folderPath.slice(0,level).map(foldName)));
    }
    const usage = services.usage(current.account.id);
    return c.json({ source: input.source, total: input.entries.length+input.skipped, newBookmarks: input.entries.length-duplicates, duplicates, skipped: input.skipped,
      folders: folders.size, usage, fitsCaptureLimit: usage.captures+input.entries.length-duplicates <= usage.maxCaptures });
  });
  app.post('/imports', async c => {
    const current = services.auth(c); services.rate(`import:${current.account.id}`,120,60_000);
    const body = await services.jsonBody(c,1024*1024);
    if (typeof body.importId !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.importId) || !Number.isInteger(body.chunk) || Number(body.chunk)<0 || Number(body.chunk)>999) {
      moduleFail(400,'invalid_import','Use a valid import identifier and chunk number.');
    }
    const importId = body.importId; const chunk = Number(body.chunk);
    const input = normalize(body,100); const inputHash = digest(JSON.stringify(body));
    const result = db.transaction(() => {
      services.auth(c,false,false);
      const prior = db.query('SELECT digest,result_json FROM customer_import_chunks WHERE account_id=? AND import_id=? AND chunk=?').get(current.account.id,importId,chunk) as {digest:string;result_json:string}|null;
      if (prior) {
        if (prior.digest !== inputHash) moduleFail(409,'import_changed','This import chunk has already been saved with different content. Start a new import.');
        return JSON.parse(prior.result_json);
      }
      // Keep replay records for 30 days, with a hard bound per account.
      db.query('DELETE FROM customer_import_chunks WHERE account_id=? AND created_at<?').run(current.account.id,Date.now()-30*86_400_000);
      const chunks = db.query('SELECT COUNT(*) n FROM customer_import_chunks WHERE account_id=?').get(current.account.id) as {n:number};
      if (chunks.n>=2000) moduleFail(429,'import_limit','The import history is full. Try again later.');
      const urls = existingUrls(db,current.account.id);
      const used = services.usage(current.account.id);
      const global = db.query('SELECT COUNT(*) captures,COALESCE(SUM(storage_bytes),0) bytes FROM customer_captures').get() as {captures:number;bytes:number};
      const counts = { imported:0, duplicates:0, skipped:input.skipped, folders:0, originsSkipped:0, importId, chunk, complete:true };
      let deltaBytes = 0;
      for (const entry of input.entries) {
        const now = Date.now(); let id = urls.get(entry.url);
        const origin = { source:input.source, sourceId:entry.sourceId, url:entry.url, title:entry.title, folderPath:entry.folderPath, addedAt:entry.addedAt, description:entry.description, tags:entry.tags, importedAt:now };
        const fingerprint = digest(JSON.stringify({ ...origin, importedAt:undefined }));
        const originJson = JSON.stringify(origin);
        if (id) counts.duplicates++;
        else {
          let parentId: string|null = null;
          for (const name of entry.folderPath) { const result = createFolder(db,current.account.id,name,parentId); parentId=result.folder.id; if (result.created) counts.folders++; }
          id = crypto.randomUUID();
          const capturedAt = entry.addedAt ?? now;
          const provenance = JSON.stringify({ schemaVersion:1,captureMethod:'bookmark-import',pageUrl:entry.url,canonicalUrl:null,pageTitle:entry.title,siteName:new URL(entry.url).hostname,
            description:entry.description,authors:[],publishedAt:null,modifiedAt:null,language:null,leadImageUrl:null,faviconUrl:null,targetUrl:entry.url,headings:[],capturedAt,extractedAt:now,
            extractorVersion:1,contentHash:null,extractionStatus:'partial',extractionError:null,sourceApplication:input.source });
          const tags = JSON.stringify(entry.tags);
          const bytes = Buffer.byteLength(entry.url+entry.title+(entry.description||'')+provenance,'utf8') + organizationBytes(parentId,tags);
          db.query(`INSERT INTO customer_captures(id,account_id,client_id,type,source_url,source_title,note_text,storage_bytes,captured_at,created_at,updated_at,provenance_json,manual_tags,folder_id,saved_via)
            VALUES(?,?,?,'bookmark',?,?,?,?,?,?,?,?,?,?,?)`).run(id,current.account.id,`import:${importId}:${chunk}:${counts.imported}`,entry.url,entry.title,entry.description,bytes,capturedAt,now,now,provenance,tags,parentId,services.savingClient(current));
          enqueuePreservation(db,current.account.id,id,entry.url);
          deltaBytes+=bytes; counts.imported++; urls.set(entry.url,id);
        }
        const known = db.query('SELECT 1 FROM customer_import_origins WHERE capture_id=? AND fingerprint=?').get(id,fingerprint);
        if (!known) {
          const origins = db.query('SELECT COUNT(*) n FROM customer_import_origins WHERE capture_id=?').get(id) as {n:number};
          if (origins.n>=20) counts.originsSkipped++;
          else {
            const bytes = Buffer.byteLength(originJson,'utf8'); deltaBytes+=bytes;
            db.query('INSERT INTO customer_import_origins VALUES(?,?,?)').run(id,fingerprint,originJson);
            db.query('UPDATE customer_captures SET storage_bytes=storage_bytes+?,updated_at=MAX(updated_at+1,?) WHERE id=? AND account_id=?').run(bytes,now,id,current.account.id);
          }
        }
      }
      if (used.captures+counts.imported>used.maxCaptures || used.bytes+deltaBytes>used.maxBytes) moduleFail(413,'quota_exceeded','This batch would exceed your library storage. No bookmarks in this batch were changed.');
      if (global.captures+counts.imported>services.globalMaxCaptures || global.bytes+deltaBytes>services.globalMaxBytes) moduleFail(503,'storage_unavailable','Foundkeep storage is temporarily full. This batch was not changed.');
      db.query('INSERT INTO customer_import_chunks VALUES(?,?,?,?,?,?)').run(current.account.id,importId,chunk,inputHash,JSON.stringify(counts),Date.now());
      return counts;
    }).immediate();
    return c.json(result);
  });
}
import {enqueuePreservation} from './customer-preservation.ts';
