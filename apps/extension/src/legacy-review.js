// Compatibility screens keep their local library, but all new captures use
// the same native sidebar review. Cache the window before the click so opening
// Chrome's panel stays within its required user gesture.
let windowId;
if (globalThis.chrome?.windows?.getCurrent) {
  chrome.windows.getCurrent().then(window => { windowId = window.id; }).catch(() => {});
}
export async function reviewLegacySave(action, values = {}) {
  if (!Number.isInteger(windowId)) throw new Error('The sidebar is getting ready. Try again.');
  const result = await chrome.runtime.sendMessage({ kind: 'prepare-legacy-save', windowId, action, ...values });
  if (!result?.ok) throw new Error(result?.error || 'Could not open the save review. Try again.');
  return result;
}
