import type { Database } from "bun:sqlite";

export class CustomerOrganizationError extends Error {
  constructor(readonly status: 400 | 404 | 409, readonly code: string, message: string) { super(message); }
}
type Folder = { id: string; name: string; parent_id: string | null };
type TaggedCapture = { id: string; manual_tags: string; tags: string };
export const foldName = (value: string) => value.normalize("NFC").toLowerCase();

export function organizationName(value: unknown, max: number, kind: string) {
  if (typeof value !== "string") throw new CustomerOrganizationError(400, "invalid_organization", `${kind} must be text.`);
  const name = value.trim().normalize("NFC");
  if (!name || name.length > max || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new CustomerOrganizationError(400, "invalid_organization", `${kind} must contain 1 to ${max} characters without control characters.`);
  }
  return name;
}
export function folderIdentifier(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value)) {
    throw new CustomerOrganizationError(400, "invalid_folder", "Use a valid folder identifier.");
  }
  return value;
}
export function requireFolder(db: Database, accountId: string, id: string): Folder {
  const row = db.query("SELECT id,name,parent_id FROM customer_folders WHERE id=? AND account_id=?").get(id, accountId) as Folder | null;
  if (!row) throw new CustomerOrganizationError(404, "folder_not_found", "Folder not found.");
  return row;
}
export function normalizeCaptureTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20) throw new CustomerOrganizationError(400, "invalid_organization", "Choose up to 20 tags.");
  const names = new Map<string, string>();
  for (const raw of value) {
    const name = organizationName(raw, 40, "A tag");
    if (!names.has(foldName(name))) names.set(foldName(name), name);
  }
  return [...names.values()];
}
export function captureOrganization(db: Database, accountId: string, body: Record<string, unknown>, current?: { folder_id: string | null; manual_tags: string }) {
  const folderId = "folderId" in body ? folderIdentifier(body.folderId) : current?.folder_id ?? null;
  if (folderId) requireFolder(db, accountId, folderId);
  const manualTags = "userTags" in body ? JSON.stringify(normalizeCaptureTags(body.userTags)) : current?.manual_tags ?? "[]";
  return { folderId, manualTags };
}
export function organizationBytes(folderId: string | null, manualTags: string) {
  return Buffer.byteLength(folderId || "", "utf8") + (manualTags === "[]" ? 0 : Buffer.byteLength(manualTags, "utf8"));
}
function taggedCaptures(db: Database, accountId: string) {
  return db.query("SELECT id,manual_tags,tags FROM customer_captures WHERE account_id=? ORDER BY created_at,id").all(accountId) as TaggedCapture[];
}
function tags(row: TaggedCapture): string[] {
  return [...JSON.parse(row.manual_tags), ...JSON.parse(row.tags || "[]")];
}
export function capturesWithTag(db: Database, accountId: string, tag: string) {
  const folded = foldName(tag);
  // Accounts hold at most 1,000 captures. Folding this bounded tag projection
  // also handles Unicode consistently; SQLite NOCASE only handles ASCII.
  return taggedCaptures(db, accountId).filter(row => tags(row).some(name => foldName(name) === folded)).map(row => row.id);
}
function folderPath(db: Database, accountId: string, folder: Folder): string[] {
  const path = [folder.name];
  let parent = folder.parent_id;
  while (parent && path.length <= 20) {
    const ancestor = requireFolder(db, accountId, parent);
    path.unshift(ancestor.name);
    parent = ancestor.parent_id;
  }
  if (parent || path.length > 20) throw new CustomerOrganizationError(400, "folder_depth", "Use at most 20 folder levels.");
  return path;
}
export function folderDto(db: Database, accountId: string, folder: Folder) {
  const { count } = db.query("SELECT COUNT(*) count FROM customer_captures WHERE account_id=? AND folder_id=?").get(accountId, folder.id) as { count: number };
  if (!folder.parent_id) return { id: folder.id, name: folder.name, count };
  const path = folderPath(db, accountId, folder);
  return { id: folder.id, name: folder.name, displayName: path.join(" / "), parentId: folder.parent_id, path, count };
}
export function readOrganization(db: Database, accountId: string) {
  const stored = db.query("SELECT id,name,parent_id FROM customer_folders WHERE account_id=? ORDER BY normalized_name,id").all(accountId) as Folder[];
  const folders = stored.map(folder => folderDto(db, accountId, folder)).sort((a,b) => a.name.localeCompare(b.name));
  const rows = taggedCaptures(db, accountId);
  const preferred = new Map<string, string>();
  for (const row of rows) for (const name of JSON.parse(row.manual_tags) as string[]) {
    if (!preferred.has(foldName(name))) preferred.set(foldName(name), name);
  }
  const counted = new Map<string, { name: string; count: number }>();
  for (const row of rows) {
    const seen = new Set<string>();
    for (const name of tags(row)) {
      const key = foldName(name);
      if (seen.has(key)) continue;
      seen.add(key);
      const item = counted.get(key) || { name: preferred.get(key) || name, count: 0 };
      item.count++;
      counted.set(key, item);
    }
  }
  return {
    folders, tags: [...counted.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    suggestedTags: ["Read later", "Inspiration", "Work", "Personal"], suggestedFolders: ["Reading", "Projects", "Inspiration"],
  };
}
export function createFolder(db: Database, accountId: string, rawName: string, parentId: string | null = null) {
  const name = organizationName(rawName, 80, "A folder name");
  if (parentId && folderPath(db, accountId, requireFolder(db, accountId, parentId)).length >= 20) {
    throw new CustomerOrganizationError(400, "folder_depth", "Use at most 20 folder levels.");
  }
  const normalized = (parentId ? parentId + "\u001f" : "") + foldName(name);
  const existing = db.query("SELECT id,name,parent_id FROM customer_folders WHERE account_id=? AND normalized_name=?").get(accountId, normalized) as Folder | null;
  if (existing) return { folder: folderDto(db, accountId, existing), created: false };
  const { count } = db.query("SELECT COUNT(*) count FROM customer_folders WHERE account_id=?").get(accountId) as { count: number };
  if (count >= 1000) throw new CustomerOrganizationError(409, "folder_limit", "You can create up to 1,000 folders.");
  const folder = { id: crypto.randomUUID(), name, parent_id: parentId };
  const now = Date.now();
  db.query("INSERT INTO customer_folders(id,account_id,name,normalized_name,created_at,updated_at,parent_id) VALUES(?,?,?,?,?,?,?)").run(folder.id, accountId, name, normalized, now, now, parentId);
  return { folder: folderDto(db, accountId, folder), created: true };
}
function descendants(db: Database, accountId: string, id: string): string[] {
  return (db.query(`WITH RECURSIVE tree(id) AS (SELECT id FROM customer_folders WHERE id=? AND account_id=?
    UNION ALL SELECT f.id FROM customer_folders f JOIN tree t ON f.parent_id=t.id WHERE f.account_id=?)
    SELECT id FROM tree`).all(id,accountId,accountId) as {id:string}[]).map(row => row.id);
}
export function renameFolder(db: Database, accountId: string, id: string, name: string) {
  const current = requireFolder(db, accountId, id);
  const normalized = (current.parent_id ? current.parent_id + "\u001f" : "") + foldName(name);
  const duplicate = db.query("SELECT id FROM customer_folders WHERE account_id=? AND normalized_name=? AND id<>?").get(accountId, normalized, id);
  if (duplicate) throw new CustomerOrganizationError(409, "folder_exists", "A folder with this name already exists.");
  const now = Date.now();
  db.query("UPDATE customer_folders SET name=?,normalized_name=?,updated_at=MAX(updated_at+1,?) WHERE id=? AND account_id=?").run(name, normalized, now, id, accountId);
  for (const child of descendants(db,accountId,id)) {
    db.query("UPDATE customer_captures SET updated_at=MAX(updated_at+1,?) WHERE folder_id=? AND account_id=?").run(now, child, accountId);
  }
  return folderDto(db, accountId, { ...current, name });
}
export function deleteFolder(db: Database, accountId: string, id: string) {
  requireFolder(db, accountId, id);
  for (const child of descendants(db,accountId,id).reverse()) {
    db.query("UPDATE customer_captures SET folder_id=NULL,storage_bytes=MAX(0,storage_bytes-?),updated_at=MAX(updated_at+1,?) WHERE folder_id=? AND account_id=?")
      .run(Buffer.byteLength(child, "utf8"), Date.now(), child, accountId);
    db.query("DELETE FROM customer_folders WHERE id=? AND account_id=?").run(child, accountId);
  }
}
