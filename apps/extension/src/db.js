// Local-first store. Every capture (and its blob) lives in IndexedDB on the
// user's machine. Connected captures also carry a durable cloud outbox binding.
// Shared by the background worker
// and the dashboard (both run in the extension context, same origin => same DB).

import { LOCAL_DATABASE_NAME as DB_NAME } from "./product.js";
const DB_VERSION = 2;
const STORE = "captures";

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      let store;
      if (!db.objectStoreNames.contains(STORE)) {
        store = db.createObjectStore(STORE, { keyPath: "id" });
      } else {
        store = req.transaction.objectStore(STORE);
      }
      if (!store.indexNames.contains("by_status")) store.createIndex("by_status", "status");
      if (!store.indexNames.contains("by_type")) store.createIndex("by_type", "type");
      if (!store.indexNames.contains("by_created")) store.createIndex("by_created", "createdAt");
      if (!store.indexNames.contains("by_cloud_status")) store.createIndex("by_cloud_status", "cloudStatus");
      if (!store.indexNames.contains("by_cloud_account")) store.createIndex("by_cloud_account", "cloudAccountId");
      if (!store.indexNames.contains("by_cloud_account_status"))
        store.createIndex("by_cloud_account_status", ["cloudAccountId", "cloudStatus"]);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode) {
  return open().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Request success is not transaction success: quota, shutdown, or a later
// abort can still roll back the write. Never acknowledge a save before commit.
async function write(operation) {
  const store = await tx("readwrite");
  const transaction = store.transaction;
  const completed = new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () =>
      reject(
        transaction.error ||
          new DOMException("The capture could not be committed.", "AbortError"),
      );
    transaction.onerror = () =>
      reject(
        transaction.error || new Error("The capture could not be stored."),
      );
  });
  completed.catch(() => {});
  try {
    const result = await operation(store);
    await completed;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      /* already finished */
    }
    await completed.catch(() => {});
    throw error;
  }
}

function newId() {
  return `cap_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Insert a capture. `input` carries the client fields; server-ish fields are set here. */
export async function addCapture(input, { id: stableId } = {}) {
  const now = Date.now();
  const id = stableId || newId();
  const rec = {
    id,
    type: input.type,
    status: "done",
    cloudAccountId: input.cloudAccountId || null,
    cloudClientId: id,
    cloudType: input.cloudType || null,
    cloudStatus: input.cloudAccountId ? "queued" : "local",
    cloudError: null,
    cloudAttempts: 0,
    cloudNextRetryAt: 0,
    folderId: input.folderId || null,
    collectionSubmission: input.collectionSubmission || null,
    sourceUrl: input.sourceUrl ?? null,
    sourceTitle: input.sourceTitle ?? null,
    faviconUrl: input.faviconUrl ?? null,
    selectionText: input.selectionText ?? null,
    selectionContext: input.selectionContext ?? null,
    noteText: input.noteText ?? null,
    provenance: input.provenance ?? null,
    processingOptions: input.processingOptions ?? null,
    blob: input.blob ?? null, // a Blob, stored directly by IndexedDB
    blobMime: input.blob?.type ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    ocrText: null,
    description: null,
    summary: null,
    category: null,
    tags: [],
    associations: [],
    articleText: input.articleText ?? null,
    model: null,
    enrichError: null,
    enrichAttempts: 0,
    capturedAt: input.capturedAt ?? now,
    createdAt: now,
    updatedAt: now,
    enrichedAt: null,
  };
  return write(async (store) => {
    if (stableId) {
      const existing = await reqToPromise(store.get(id));
      if (existing) {
        if (existing.cloudAccountId !== rec.cloudAccountId) throw new Error('This save belongs to a different account.');
        return existing;
      }
    }
    await reqToPromise(store.add(rec));
    return rec;
  });
}

export async function getCapture(id) {
  const store = await tx("readonly");
  return reqToPromise(store.get(id));
}

export async function updateCapture(id, patch) {
  return updateWhere(id, patch, () => true);
}
async function updateWhere(id, patch, allowed) {
  return write(async (store) => {
    const rec = await reqToPromise(store.get(id));
    if (!rec || !allowed(rec)) return null;
    Object.assign(rec, patch, { updatedAt: Date.now() });
    await reqToPromise(store.put(rec));
    return rec;
  });
}
export async function deleteCapture(id) {
  return write(async (store) => {
    await reqToPromise(store.delete(id));
    return true;
  });
}

export async function clearAll() {
  return write(async (store) => {
    await reqToPromise(store.clear());
    return true;
  });
}

async function getAll() {
  const store = await tx("readonly");
  return reqToPromise(store.getAll());
}

export async function recentCaptures(limit = 3) {
  if (!Number.isSafeInteger(limit) || limit <= 0) return [];
  const store = await tx("readonly");
  const request = store.index("by_created").openCursor(null, "prev");
  return new Promise((resolve, reject) => {
    const rows = [];
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || rows.length >= limit) return resolve(rows);
      rows.push(cursor.value);
      cursor.continue();
    };
  });
}

export async function listCloudQueue(accountId, statuses = ["queued"]) {
  if (!accountId) return [];
  const store = await tx("readonly");
  const index = store.index("by_cloud_account_status");
  const groups = await Promise.all(
    statuses.map((status) => reqToPromise(index.getAll([accountId, status]))),
  );
  return groups.flat()
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function cloudMetrics(accountId) {
  const store = await tx("readonly");
  const accounts = store.index("by_cloud_account");
  const accountStatuses = store.index("by_cloud_account_status");
  const ownCount = accountId ? accounts.count(accountId) : null;
  const ownQueued = accountId ? accountStatuses.count([accountId, "queued"]) : null;
  const ownFailed = accountId ? accountStatuses.count([accountId, "failed"]) : null;
  const ownSynced = accountId ? accountStatuses.count([accountId, "synced"]) : null;
  const firstFailure = accountId ? accountStatuses.get([accountId, "failed"]) : null;
  const [total, bound, own, pending, failed, synced, failedRecord] = await Promise.all([
    reqToPromise(store.count()),
    reqToPromise(accounts.count()),
    ownCount ? reqToPromise(ownCount) : 0,
    ownQueued ? reqToPromise(ownQueued) : 0,
    ownFailed ? reqToPromise(ownFailed) : 0,
    ownSynced ? reqToPromise(ownSynced) : 0,
    firstFailure ? reqToPromise(firstFailure) : null,
  ]);
  return {
    pending,
    failed,
    synced,
    localOnly: total - bound,
    otherAccount: bound - own,
    error: failedRecord?.cloudError || null,
  };
}

export function filterCaptureRows(input, {
  type,
  status,
  tag,
  category,
  q,
  limit = 500,
} = {}) {
  let rows = [...input].sort((a, b) => b.createdAt - a.createdAt);
  if (type) rows = rows.filter((r) => r.type === type);
  if (status) rows = rows.filter((r) => r.status === status);
  if (tag) rows = rows.filter((r) => (r.tags || []).includes(tag));
  if (category) rows = rows.filter((r) => r.category === category);
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((r) =>
      [
        r.sourceTitle,
        r.noteText,
        r.selectionText,
        r.ocrText,
        r.summary,
        r.description,
        r.articleText,
        (r.tags || []).join(" "),
        r.category,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }
  return rows.slice(0, limit);
}

/** List with in-memory filtering (fine at personal scale; no server FTS needed). */
export async function listCaptures({
  type,
  status,
  tag,
  category,
  q,
  limit = 500,
} = {}) {
  return filterCaptureRows(await getAll(), { type, status, tag, category, q, limit });
}

export async function counts() {
  const store = await tx("readonly");
  const status = store.index("by_status");
  const [total, pending, processing, done, failed] = await Promise.all([
    reqToPromise(store.count()),
    reqToPromise(status.count("pending")),
    reqToPromise(status.count("processing")),
    reqToPromise(status.count("done")),
    reqToPromise(status.count("failed")),
  ]);
  return { total, pending, processing, done, failed };
}

export function facetsFrom(rows) {
  const tags = new Map();
  const cats = new Map();
  for (const r of rows) {
    for (const t of r.tags || []) tags.set(t, (tags.get(t) || 0) + 1);
    if (r.category) cats.set(r.category, (cats.get(r.category) || 0) + 1);
  }
  const sort = (m) =>
    [...m.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  return { tags: sort(tags), categories: sort(cats) };
}

export async function facets() {
  return facetsFrom(await getAll());
}
