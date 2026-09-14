// A browser-local preference: dev and production keep independent storage.
const KEY = 'foundkeepAppearance';
const normalize = value => ['light', 'dark'].includes(value) ? value : 'system';
function apply(value) {
  const theme = normalize(value);
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(KEY, theme); } catch { /* storage may be unavailable */ }
  document.querySelectorAll('[data-theme-choice]').forEach(select => { select.value = theme; });
}
try { apply(localStorage.getItem(KEY)); } catch { apply('system'); }
if (globalThis.chrome?.storage?.local) {
  chrome.storage.local.get(KEY).then(values => apply(values[KEY])).catch(() => {});
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === 'local' && KEY in changes) apply(changes[KEY].newValue);
  });
}
document.querySelectorAll('[data-theme-choice]').forEach(select => {
  select.addEventListener('change', async () => {
    const value = normalize(select.value);
    if (globalThis.chrome?.storage?.local) {
      try { await chrome.storage.local.set({ [KEY]: value }); }
      catch { return; }
    }
    apply(value);
  });
});
