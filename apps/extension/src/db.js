// Local-first store. Every capture (and its blob) lives in IndexedDB on the
// user's machine — nothing is sent to a server. Shared by the background worker
// and the dashboard (both run in the extension context, same origin => same DB).

const DB_NAME = "atlas";
const DB_VERSION = 1;
const STORE = "captures";

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: "id" });
        s.createIndex("by_status", "status");
        s.createIndex("by_type", "type");
        s.createIndex("by_created", "createdAt");
      }
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

function newId() {
  return `cap_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Insert a capture. `input` carries the client fields; server-ish fields are set here. */
export async function addCapture(input) {
  const now = Date.now();
  const rec = {
    id: newId(),
    type: input.type,
    status: "pending",
    sourceUrl: input.sourceUrl ?? null,
    sourceTitle: input.sourceTitle ?? null,
    faviconUrl: input.faviconUrl ?? null,
    selectionText: input.selectionText ?? null,
    selectionContext: input.selectionContext ?? null,
    noteText: input.noteText ?? null,
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
    articleText: null,
    model: null,
    enrichError: null,
    enrichAttempts: 0,
    capturedAt: input.capturedAt ?? now,
    createdAt: now,
    updatedAt: now,
    enrichedAt: null,
  };
  const store = await tx("readwrite");
  await reqToPromise(store.add(rec));
  return rec;
}

export async function getCapture(id) {
  const store = await tx("readonly");
  return reqToPromise(store.get(id));
}

export async function updateCapture(id, patch) {
  const store = await tx("readwrite");
  const rec = await reqToPromise(store.get(id));
  if (!rec) return null;
  Object.assign(rec, patch, { updatedAt: Date.now() });
  await reqToPromise(store.put(rec));
  return rec;
}

export async function deleteCapture(id) {
  const store = await tx("readwrite");
  await reqToPromise(store.delete(id));
  return true;
}

export async function clearAll() {
  const store = await tx("readwrite");
  await reqToPromise(store.clear());
  return true;
}

async function getAll() {
  const store = await tx("readonly");
  return reqToPromise(store.getAll());
}

/** List with in-memory filtering (fine at personal scale; no server FTS needed). */
export async function listCaptures({ type, status, tag, category, q, limit = 500 } = {}) {
  let rows = await getAll();
  rows.sort((a, b) => b.createdAt - a.createdAt);
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

/** Captures awaiting enrichment (pending, or failed with attempts left). */
export async function pendingCaptures(limit = 5) {
  const rows = await getAll();
  return rows
    .filter((r) => r.status === "pending" || (r.status === "failed" && r.enrichAttempts < 4))
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, limit);
}

export async function counts() {
  const rows = await getAll();
  const by = { total: rows.length, pending: 0, processing: 0, done: 0, failed: 0 };
  for (const r of rows) by[r.status] = (by[r.status] || 0) + 1;
  return by;
}

export async function facets() {
  const rows = await getAll();
  const tags = new Map();
  const cats = new Map();
  for (const r of rows) {
    for (const t of r.tags || []) tags.set(t, (tags.get(t) || 0) + 1);
    if (r.category) cats.set(r.category, (cats.get(r.category) || 0) + 1);
  }
  const sort = (m) => [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  return { tags: sort(tags), categories: sort(cats) };
}
