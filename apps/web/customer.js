export const EXTENSION_ID = 'mjfcgmboaijfcaanepdipbgmipnccnpn';
const STORE_EXTENSION_ID = 'cficnecbdbiddngllpfbacabgbcjinmk';
const STORE_URL = `https://chromewebstore.google.com/detail/${STORE_EXTENSION_ID}`;
let accountContext = null;
// Bound once by the dashboard's first authenticated account response. Auth pages
// never set this context, and later cookie changes cannot overwrite its intent.
export function setAccountContext(id) {
  if (accountContext === null && typeof id === 'string' && id) accountContext = id;
}
// Server configuration can add supported builds; the public Store remains the fallback.
let configPromise;
export function customerConfig() {
  return configPromise ||= fetch('/customer-config.json', { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(5000) })
    .then(async response => {
      if (!response.ok) throw new Error('Configuration unavailable');
      const data = await response.json();
      const extensionIds = Array.isArray(data.extensionIds) ? data.extensionIds.filter(id => typeof id === 'string' && /^[a-p]{32}$/.test(id)).slice(0, 5) : [];
      let storeUrl = null;
      try {
        const url = new URL(data.storeUrl);
        if (url.protocol === 'https:' && url.hostname === 'chromewebstore.google.com' && url.pathname.startsWith('/detail/')) storeUrl = url.href;
      } catch { /* No published listing configured. */ }
      return { extensionIds, storeUrl, iphone: iphoneConfig(data.iphone) };
    })
    .catch(() => ({ extensionIds: [STORE_EXTENSION_ID, EXTENSION_ID], storeUrl: STORE_URL, iphone: iphoneConfig() }));
}

// Distribution is data only. A private beta never points at an unpublished listing.
function iphoneConfig(value) {
  const fallback = { distribution: 'private-beta', url: '/support.html#iphone-beta', label: 'Get iPhone beta', badge: 'TestFlight beta', description: 'The iPhone app is in a private TestFlight beta. Request access to try it.' };
  try {
    const url = new URL(value?.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return fallback;
    if (value.distribution === 'app-store' && url.hostname === 'apps.apple.com' && /\/id\d+$/.test(url.pathname))
      return { distribution: 'app-store', url: url.href, label: 'Get the iPhone app', badge: 'App Store', description: 'Get FoundKeep for iPhone from the App Store.' };
    if (value.distribution === 'testflight' && url.hostname === 'testflight.apple.com' && /^\/join\/[A-Za-z0-9]+$/.test(url.pathname))
      return { distribution: 'testflight', url: url.href, label: 'Get iPhone beta', badge: 'TestFlight beta', description: 'Join the FoundKeep iPhone beta through TestFlight.' };
  } catch { /* Safe, usable beta instructions remain available. */ }
  return fallback;
}
export function renderIphoneLinks(config, root = document) {
  for (const link of root.querySelectorAll('[data-iphone-install]')) {
    link.href = config.iphone.url;
    const label = link.querySelector('[data-iphone-label]') || link;
    label.textContent = config.iphone.label;
  }
  root.querySelectorAll('[data-iphone-badge]').forEach(node => { node.textContent = config.iphone.badge; });
  root.querySelectorAll('[data-iphone-availability]').forEach(node => { node.textContent = config.iphone.description; });
}
export function isIphoneBrowser() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
export function isMobileBrowser() {
  return /Android/i.test(navigator.userAgent) || isIphoneBrowser();
}

export class ApiError extends Error {
  constructor(message, status = 0, code = '') { super(message); this.status = status; this.code = code; }
}

export async function api(path, { method = 'GET', body, signal, download = false } = {}) {
  const timeout = AbortSignal.timeout(download ? 120000 : 30000);
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(accountContext ? { 'X-Atlas-Account': accountContext } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(navigator.onLine ? 'FoundKeep could not be reached. Check your connection and try again.' : 'You’re offline. Reconnect to access your cloud library.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    // Incorrect password/recovery input does not mean the existing session expired.
    if ((response.status === 401 && !['invalid_credentials', 'invalid_pairing'].includes(data.error)) || data.error === 'account_changed') window.dispatchEvent(new CustomEvent('atlas-session-expired', { detail: { code: data.error } }));
    throw new ApiError(data.message || (response.status === 429 ? 'Too many attempts. Please wait a moment and try again.' : 'That request could not be completed. Please try again.'), response.status, data.error);
  }
  if (download) return response.blob();
  try { return await response.json(); }
  catch { throw new ApiError('FoundKeep returned an incomplete response. Please try again.'); }
}

export const $ = (selector, scope = document) => scope.querySelector(selector);
export function textElement(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined && text !== null) element.textContent = text;
  if (className) element.className = className;
  return element;
}
export function setMessage(element, message, isError = true) {
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle('is-error', isError);
  element.setAttribute('role', isError ? 'alert' : 'status');
}
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function recoveryDownload(code, email) {
  downloadBlob(new Blob([`FoundKeep recovery code\n\nAccount: ${email}\nRecovery code: ${code}\n\nKeep this file somewhere private. Anyone with this code and your email can reset your password. Using it replaces this code and disconnects your browsers. FoundKeep does not send password-reset emails.\n`], { type: 'text/plain' }), 'foundkeep-recovery-code.txt');
}
export function safeSource(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url : null; } catch { return null; }
}
export function safeBlob(value, id) {
  if (!value || !id) return null;
  try {
    const url = new URL(value, location.origin);
    return url.origin === location.origin && url.pathname === `/api/captures/${encodeURIComponent(id)}/blob` && !url.search && !url.hash ? url.href : null;
  } catch { return null; }
}
export function dateLabel(value, full = false) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Date unavailable' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(full ? { year: 'numeric', hour: '2-digit', minute: '2-digit' } : {}) });
}
export function extensionMessage(message, extensionId = EXTENSION_ID) {
  return new Promise((resolve, reject) => {
    if (!globalThis.chrome?.runtime?.sendMessage) return reject(new Error('Open this page in Chrome with FoundKeep installed. After installing, reload this page and try again.'));
    let settled = false;
    const finish = (error, response) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      error ? reject(error) : resolve(response);
    };
    const timer = setTimeout(() => finish(new Error('FoundKeep did not respond. Reload the extension at chrome://extensions, then try again.')), 15000);
    try {
      chrome.runtime.sendMessage(extensionId, message, (response) => {
        const error = chrome.runtime.lastError;
        if (error || !response) return finish(new Error('FoundKeep could not be detected. Install or reload the extension, refresh this page, then try again.'));
        if (!response.ok) return finish(new Error(response.error || 'The extension could not connect. Please try again.'));
        finish(null, response);
      });
    } catch { finish(new Error('FoundKeep could not be detected. Use Chrome, install the extension, then reload this page.')); }
  });
}
