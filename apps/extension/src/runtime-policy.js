import { CUSTOMER_ORIGIN } from "./product.js";

const CACHE_KEY = "foundkeepRuntimePolicyCache";
let pendingRefresh = null;

export const DEFAULT_RUNTIME_POLICY = Object.freeze({
  schemaVersion: 1,
  revision: 1,
  cacheSeconds: 60,
  capture: Object.freeze({
    region: true,
    fullPage: true,
    highlight: true,
    bookmark: true,
    image: true,
    tweet: true,
    note: true,
  }),
  sync: true,
  contextMenus: true,
  limits: Object.freeze({
    articleCharacters: 500_000,
    selectionCharacters: 50_000,
    imageBytes: 8 * 1024 * 1024,
    fullPagePixels: 32_000_000,
    fullPageCssHeight: 15_000,
  }),
});

const clone = (value) => JSON.parse(JSON.stringify(value));
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) &&
  Object.keys(value).length === keys.length &&
  Object.keys(value).every((key) => keys.includes(key));

export function normalizeRuntimePolicy(value) {
  const rootKeys = ["schemaVersion", "revision", "cacheSeconds", "capture", "sync", "contextMenus", "limits"];
  const captureKeys = ["region", "fullPage", "highlight", "bookmark", "image", "tweet", "note"];
  const limitKeys = ["articleCharacters", "selectionCharacters", "imageBytes", "fullPagePixels", "fullPageCssHeight"];
  if (!exactKeys(value, rootKeys) || value.schemaVersion !== 1 ||
      !Number.isSafeInteger(value.revision) || value.revision < 1 ||
      !Number.isSafeInteger(value.cacheSeconds) || value.cacheSeconds < 60 || value.cacheSeconds > 3600 ||
      typeof value.sync !== "boolean" || typeof value.contextMenus !== "boolean" ||
      !exactKeys(value.capture, captureKeys) || captureKeys.some((key) => typeof value.capture[key] !== "boolean") ||
      !exactKeys(value.limits, limitKeys)) return null;
  const limits = value.limits;
  if (!Number.isSafeInteger(limits.articleCharacters) || limits.articleCharacters < 10_000 || limits.articleCharacters > 500_000 ||
      !Number.isSafeInteger(limits.selectionCharacters) || limits.selectionCharacters < 1_000 || limits.selectionCharacters > 50_000 ||
      !Number.isSafeInteger(limits.imageBytes) || limits.imageBytes < 1_048_576 || limits.imageBytes > 8_388_608 ||
      !Number.isSafeInteger(limits.fullPagePixels) || limits.fullPagePixels < 1_000_000 || limits.fullPagePixels > 64_000_000 ||
      !Number.isSafeInteger(limits.fullPageCssHeight) || limits.fullPageCssHeight < 1_000 || limits.fullPageCssHeight > 15_000) return null;
  return clone(value);
}

export function applyRuntimePolicy(preferences, policy) {
  const effective = clone(preferences);
  for (const key of Object.keys(effective.capture))
    effective.capture[key] = effective.capture[key] && policy.capture[key];
  effective.sync.automatic = effective.sync.automatic && policy.sync;
  effective.contextMenus = effective.contextMenus && policy.contextMenus;
  return effective;
}

async function fetchRuntimePolicy(cachedPolicy, now) {
  try {
    const response = await fetch(CUSTOMER_ORIGIN + "/extension-policy.json", {
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Policy unavailable");
    const policy = normalizeRuntimePolicy(await response.json());
    if (!policy) throw new Error("Invalid policy");
    if (!cachedPolicy || policy.revision >= cachedPolicy.revision) {
      await chrome.storage.local.set({ [CACHE_KEY]: { policy, fetchedAt: now } });
      return { policy, source: "remote" };
    }
    await chrome.storage.local.set({ [CACHE_KEY]: { policy: cachedPolicy, fetchedAt: now } });
    return { policy: cachedPolicy, source: "newer-cache" };
  } catch {
    const fallback = cachedPolicy || clone(DEFAULT_RUNTIME_POLICY);
    await chrome.storage.local.set({ [CACHE_KEY]: { policy: fallback, fetchedAt: now } });
    return { policy: fallback, source: cachedPolicy ? "stale-cache" : "default" };
  }
}

function refreshInBackground(cachedPolicy, now) {
  if (!pendingRefresh) {
    pendingRefresh = fetchRuntimePolicy(cachedPolicy, now).finally(() => {
      pendingRefresh = null;
    });
  }
  return pendingRefresh;
}

export async function getRuntimePolicy({ refresh = false, now = Date.now() } = {}) {
  const stored = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
  const cachedPolicy = normalizeRuntimePolicy(stored?.policy);
  const cacheAge = cachedPolicy ? cachedPolicy.cacheSeconds * 1000 : 0;
  if (!refresh && cachedPolicy && Number.isSafeInteger(stored.fetchedAt) && now - stored.fetchedAt < cacheAge)
    return { policy: cachedPolicy, source: "cache" };
  if (refresh) return refreshInBackground(cachedPolicy, now);

  // Captures stay local-first even when FoundKeep or the network is unavailable.
  // Refresh the data-only policy in parallel and apply it on the next operation.
  void refreshInBackground(cachedPolicy, now);
  return cachedPolicy
    ? { policy: cachedPolicy, source: "stale-cache" }
    : { policy: clone(DEFAULT_RUNTIME_POLICY), source: "default" };
}
