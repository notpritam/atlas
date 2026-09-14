// Shared presentation helpers. Captured text is always inserted with textContent.
import { PRODUCT_NAME, CUSTOMER_ORIGIN, EXTENSION_ENVIRONMENT } from "./product.js";
export const $ = (id) => document.getElementById(id);
export const title = (c) =>
  c.summary ||
  c.sourceTitle ||
  c.noteText ||
  c.selectionText ||
  "Untitled capture";
export function sourceUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
export function domain(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "Your notebook";
  }
}
export function ago(ts) {
  const d = Math.max(0, Date.now() - ts);
  if (d < 60000) return "Just now";
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
// The extension's existing stroke icon vocabulary, centralized for consistency.
const paths = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>',
  folder: '<path d="M3 7V5h7l2 3h9v12H3z"/>',
  trash: '<path d="M4 7h16M9 7V3h6v4M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',

  screenshot:
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="M14 3h7v7M10 21H3v-7"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
  highlight: '<path d="M4 20h16M6 16l8-8 4 4-8 8H6z"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  note: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4-4"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9.4A1.7 1.7 0 0 0 10.5 3a2 2 0 1 1 4 0a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9z"/>',
};
export const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.note}</svg>`;
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-build-info]')) {
    el.dataset.environment = EXTENSION_ENVIRONMENT;
    const label = document.createElement('strong');
    label.textContent = EXTENSION_ENVIRONMENT === 'dev' ? 'DEV' : 'Production';
    const version = document.createElement('span');
    version.textContent = `v${chrome.runtime.getManifest().version}`;
    const destination = document.createElement('span');
    destination.className = 'build-destination';
    destination.textContent = new URL(CUSTOMER_ORIGIN).host;
    el.setAttribute('aria-label', `Extension environment: ${label.textContent}. Version ${chrome.runtime.getManifest().version}. Cloud destination: ${CUSTOMER_ORIGIN}`);
    el.replaceChildren(label, version, destination);
  }
  for (const el of root.querySelectorAll('[data-product-name]')) el.textContent = PRODUCT_NAME;
  for (const el of root.querySelectorAll('[data-product-path]')) el.href = CUSTOMER_ORIGIN + el.dataset.productPath;
  if (root === document) document.title = document.title.replace(/^FoundKeep(?: Dev)?/, PRODUCT_NAME);
  for (const el of root.querySelectorAll("[data-icon]"))
    el.innerHTML = icon(el.dataset.icon);
}
export function message(el, text, tone = "") {
  el.textContent = text;
  el.dataset.tone = tone;
}
export function openDialog(dialog, opener) {
  dialog.__opener = opener || document.activeElement;
  if (!dialog.open) dialog.showModal();
}
export function wireDialog(dialog) {
  dialog.addEventListener("click", (e) => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      dialog.close();
  });
  dialog.addEventListener("close", () => {
    const opener = dialog.__opener;
    const replacement = opener?.isConnected
      ? opener
      : [...document.querySelectorAll("[data-focus-key]")].find(
          (el) => el.dataset.focusKey === opener?.dataset?.focusKey,
        );
    (replacement || document.getElementById("q"))?.focus({
      preventScroll: true,
    });
  });
}
