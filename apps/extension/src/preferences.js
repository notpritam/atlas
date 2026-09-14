import { CUSTOMER_ORIGIN } from "./product.js";
import { applyRuntimePolicy, getRuntimePolicy } from "./runtime-policy.js";
const CONNECTION_KEY = "atlasCustomer";
const CACHE_KEY = "atlasPreferenceCache";
const MAX_AGE_MS = 5 * 60 * 1000;
const pendingRemoteRefreshes = new Map();
const accountRefreshTails = new Map();

export const DEFAULT_PREFERENCES = Object.freeze({
  version: 1,
  capture: Object.freeze({ region: true, fullPage: true, highlight: true, bookmark: true, image: true, tweet: true, note: true }),
  bookmark: Object.freeze({ readableText: true, extendedMetadata: true, headings: true }),
  notes: Object.freeze({ attachSource: true }),
  popup: Object.freeze({ actionOrder: Object.freeze(["bookmark", "highlight", "region", "fullPage"]), showRecent: true, recentCount: 3 }),
  sync: Object.freeze({ automatic: true }),
  organization: Object.freeze({ ocr: true, summaries: true, tags: true }),
  feedback: Object.freeze({ success: true }),
  contextMenus: true,
});

const cloneDefaults = () => JSON.parse(JSON.stringify(DEFAULT_PREFERENCES));
const object = (value) => value && typeof value === "object" && !Array.isArray(value);

export function normalizePreferences(value) {
  if (!object(value) || value.version !== 1) return null;
  const shapes = {
    capture: ["region", "fullPage", "highlight", "bookmark", "image", "tweet", "note"],
    bookmark: ["readableText", "extendedMetadata", "headings"],
    notes: ["attachSource"],
    sync: ["automatic"],
    organization: ["ocr", "summaries", "tags"],
    feedback: ["success"],
  };
  const allowedRoot = new Set(["version", ...Object.keys(shapes), "popup", "contextMenus"]);
  if (Object.keys(value).some((key) => !allowedRoot.has(key)) || typeof value.contextMenus !== "boolean") return null;
  for (const [group, keys] of Object.entries(shapes)) {
    if (!object(value[group]) || Object.keys(value[group]).length !== keys.length ||
        keys.some((key) => typeof value[group][key] !== "boolean") ||
        Object.keys(value[group]).some((key) => !keys.includes(key))) return null;
  }
  const popup = value.popup;
  const actions = ["bookmark", "highlight", "region", "fullPage"];
  if (!object(popup) || Object.keys(popup).some((key) => !["actionOrder", "showRecent", "recentCount"].includes(key)) ||
      Object.keys(popup).length !== 3 || typeof popup.showRecent !== "boolean" ||
      !Number.isInteger(popup.recentCount) || popup.recentCount < 0 || popup.recentCount > 5 ||
      !Array.isArray(popup.actionOrder) || popup.actionOrder.length !== 4 ||
      new Set(popup.actionOrder).size !== 4 || popup.actionOrder.some((action) => !actions.includes(action))) return null;
  return structuredClone(value);
}

async function stateAndCache() {
  const values = await chrome.storage.local.get([CONNECTION_KEY, CACHE_KEY]);
  return { state: values[CONNECTION_KEY] || null, cache: values[CACHE_KEY] || null };
}

function connectionKey(state) {
  const accountId = state?.account?.id;
  if (!accountId || !state?.token || state.status === "reconnect") return null;
  return [accountId, state.connection?.id || "", state.token].join("\u0000");
}

function validCache(cache, accountId) {
  return cache && cache.accountId === accountId && normalizePreferences(cache.preferences) &&
    Number.isSafeInteger(cache.revision) && cache.revision >= 0 && Number.isSafeInteger(cache.fetchedAt)
    ? cache
    : null;
}

function cacheResult(cache, source) {
  return {
    preferences: structuredClone(cache.preferences),
    revision: cache.revision,
    updatedAt: cache.updatedAt,
    source,
  };
}

async function fetchRemotePreferences(state, now) {
  const key = connectionKey(state);
  if (!key) throw new Error("Connect FoundKeep before refreshing preferences.");
  if (pendingRemoteRefreshes.has(key)) return pendingRemoteRefreshes.get(key);

  const request = (async () => {
    const preceding = accountRefreshTails.get(state.account.id);
    if (preceding) await preceding;
    const response = await fetch(CUSTOMER_ORIGIN + "/api/preferences", {
      method: "GET",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      headers: { Authorization: "Bearer " + state.token },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Preference refresh failed");
    const result = await response.json();
    const preferences = normalizePreferences(result.preferences);
    if (!preferences || !Number.isSafeInteger(result.revision) || result.revision < 0 ||
        !(result.updatedAt === null || Number.isSafeInteger(result.updatedAt))) throw new Error("Invalid preferences");

    const latest = await stateAndCache();
    if (connectionKey(latest.state) !== key) throw new Error("FoundKeep connection changed during preference refresh.");
    const latestCache = validCache(latest.cache, state.account.id);
    if (latestCache && latestCache.revision >= result.revision) {
      return cacheResult(latestCache, latestCache.revision > result.revision ? "newer-cache" : "remote");
    }
    const next = { accountId: state.account.id, preferences, revision: result.revision, updatedAt: result.updatedAt, fetchedAt: now };
    await chrome.storage.local.set({ [CACHE_KEY]: next });
    return cacheResult(next, "remote");
  })();
  const tail = request.then(() => undefined, () => undefined);
  pendingRemoteRefreshes.set(key, request);
  accountRefreshTails.set(state.account.id, tail);
  try {
    return await request;
  } finally {
    if (pendingRemoteRefreshes.get(key) === request) pendingRemoteRefreshes.delete(key);
    if (accountRefreshTails.get(state.account.id) === tail) accountRefreshTails.delete(state.account.id);
  }
}

export async function clearPreferenceCache() {
  if (chrome.storage.local.remove) await chrome.storage.local.remove(CACHE_KEY);
  else await chrome.storage.local.set({ [CACHE_KEY]: null });
}

async function getAccountPreferences({ refresh = false, now = Date.now() } = {}) {
  const { state, cache } = await stateAndCache();
  const accountId = state?.account?.id;
  const usableCache = validCache(cache, accountId);
  if (!connectionKey(state)) {
    if (refresh) throw new Error("Connect FoundKeep before refreshing preferences.");
    if (accountId && usableCache) return cacheResult(usableCache, "stale-cache");
    return { preferences: cloneDefaults(), revision: 0, updatedAt: null, source: "default" };
  }
  if (!refresh && usableCache && now - usableCache.fetchedAt < MAX_AGE_MS) {
    return { preferences: structuredClone(usableCache.preferences), revision: usableCache.revision, updatedAt: usableCache.updatedAt, source: "cache" };
  }
  try {
    return await fetchRemotePreferences(state, now);
  } catch (error) {
    if (refresh) throw error;
    if (usableCache) {
      return cacheResult(usableCache, "stale-cache");
    }
    return { preferences: cloneDefaults(), revision: 0, updatedAt: null, source: "default" };
  }
}

export async function getEffectivePreferences({ refresh = false, now = Date.now() } = {}) {
  const [account, runtime] = await Promise.all([
    getAccountPreferences({ refresh, now }),
    getRuntimePolicy({ refresh, now }),
  ]);
  return {
    ...account,
    preferences: applyRuntimePolicy(account.preferences, runtime.policy),
    policy: runtime.policy,
    policySource: runtime.source,
  };
}

export function refreshPreferences(options = {}) {
  return getEffectivePreferences({ ...options, refresh: true });
}

export function capturePreferenceKey(action) {
  return {
    savepage: "bookmark",
    "save-selection": "highlight",
    "save-link": "bookmark",
    "save-image": "image",
    fullpage: "fullPage",
    region: "region",
    highlight: "highlight",
  }[action] || action;
}
