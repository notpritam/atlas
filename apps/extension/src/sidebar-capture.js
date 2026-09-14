import { $, domain, message, openDialog } from './ui.js';
import { DEFAULT_PREFERENCES } from './preferences.js';

// A side panel outlives the tab that opened it. Snapshot the displayed tab for
// every capture; the worker checks it again before reading or taking a picture.
export function bindSidebarCapture({ onSaved = () => {} } = {}) {
  let tab = null, windowId, revision = 0, busy = null, noteTarget = null;
  let preferences = structuredClone(DEFAULT_PREFERENCES);
  const buttons = [...document.querySelectorAll('[data-capture]')];
  function updateButtons() {
    for (const button of buttons) {
      button.hidden = !preferences.capture[button.dataset.feature];
      button.disabled = !!busy || !/^https?:\/\//i.test(tab?.url || '');
    }
    $('newNote').hidden = !preferences.capture.note;
  }
  async function refreshTab() {
    const current = ++revision;
    try {
      windowId ??= (await chrome.windows.getCurrent()).id;
      const [next] = await chrome.tabs.query({ active: true, windowId });
      if (current !== revision) return;
      tab = next || null;
      $('currentPage').textContent = tab?.url ? (/^https?:\/\//i.test(tab.url) ? tab.title || domain(tab.url) : 'Open a web page to capture it') : 'Page access needed';
      $('currentPage').title = tab?.url || '';
      $('pageAccess').hidden = !!tab?.url;
      updateButtons();
    } catch {
      if (current !== revision) return;
      tab = null;
      $('currentPage').textContent = 'Could not find the current page';
      updateButtons();
    }
  }
  async function loadPreferences() {
    try {
      const result = await chrome.runtime.sendMessage({ kind: 'preferences-status' });
      if (result?.ok && result.preferences?.capture) preferences = result.preferences;
    } catch { /* Keep the last known controls; the worker enforces preferences. */ }
    const order = new Map((preferences.popup?.actionOrder || []).map((feature, index) => [feature, index]));
    const secondary = document.querySelector('.capture-actions');
    [...secondary.children].sort((a, b) => (order.get(a.dataset.feature) ?? 99) - (order.get(b.dataset.feature) ?? 99)).forEach(button => secondary.append(button));
    updateButtons();
    document.body.dataset.preferencesReady = 'true';
  }
  const target = () => ({ source: 'sidebar', windowId, tabId: tab?.id, tabUrl: tab?.url });
  function finished(result) {
    busy = null; updateButtons();
    if (!result?.ok) {
      message($('captureFeedback'), result?.error || 'Could not capture this page. Try again.', 'error');
      if (/access|permission|activeTab|all_urls|cannot access/i.test(result?.error || '')) $('pageAccess').hidden = false;
    } else if (!result.capture) message($('captureFeedback'), 'Selection cancelled.');
    else {
      message($('captureFeedback'), result.capture.cloudStatus === 'local' ? 'Saved in this browser.' : 'Saved in this browser. Waiting to sync.', 'success');
      onSaved();
    }
  }
  for (const button of buttons) button.onclick = async () => {
    if (busy || button.disabled) return;
    const requestId = crypto.randomUUID(); busy = requestId; updateButtons();
    message($('captureFeedback'), button.dataset.capture === 'region' ? 'Drag over the page to select a region. Esc cancels.' : 'Saving this page…');
    try {
      const result = await chrome.runtime.sendMessage({ kind: 'capture', action: button.dataset.capture, requestId, ...target() });
      if (busy !== requestId) return;
      if (!result?.started) finished(result);
    } catch (error) { if (busy === requestId) finished({ ok: false, error: error.message }); }
  };
  function requestPageAccess(event) {
    // Chrome requires a direct user gesture here. All-URL access is optional;
    // captureVisibleTab cannot use an individual site's host permission alone.
    const permission = chrome.permissions.request({ origins: ['<all_urls>'] });
    const button = event.currentTarget; button.disabled = true;
    const feedback = button.id === 'settingsPageAccess' ? $('permissionFeedback') : $('captureFeedback');
    void permission.then(async granted => {
      message(feedback, granted ? 'Page captures are ready as you browse.' : 'Access was not granted. Notes and your library are still available.', granted ? 'success' : '');
      await refreshTab();
    }).catch(error => message(feedback, error.message, 'error')).finally(() => { button.disabled = false; });
  }
  $('allowPageAccess').onclick = $('settingsPageAccess').onclick = requestPageAccess;
  $('newNote').onclick = () => {
    noteTarget = target();
    const attach = preferences.notes.attachSource && /^https?:\/\//i.test(tab?.url || '');
    $('attachPage').checked = !!attach;
    $('attachPage').disabled = !attach;
    $('noteSource').textContent = attach ? tab.title || domain(tab.url) : 'A standalone note, saved in this browser and synced when connected.';
    message($('noteFeedback'), '');
    openDialog($('noteDialog')); $('note').focus();
  };
  $('quickNoteForm').onsubmit = async event => {
    event.preventDefault();
    if ($('save').disabled) return;
    const text = $('note').value;
    if (!text.trim()) { message($('noteFeedback'), 'Write something to keep.', 'error'); return; }
    $('save').disabled = true; message($('noteFeedback'), 'Saving…');
    try {
      const result = await chrome.runtime.sendMessage({ kind: 'saveNote', text, ...($('attachPage').checked ? noteTarget : { source: 'library' }) });
      if (!result?.ok) throw new Error(result?.error || 'Could not save this note. Try again.');
      if ($('note').value === text) { $('note').value = ''; $('noteDialog').close(); }
      message($('captureFeedback'), result.capture?.cloudStatus === 'local' ? 'Note saved in this browser.' : 'Note saved in this browser. Waiting to sync.', 'success');
      message($('noteFeedback'), 'Saved.', 'success'); onSaved();
    } catch (error) { message($('noteFeedback'), error.message, 'error'); }
    finally { $('save').disabled = false; }
  };
  chrome.tabs.onActivated.addListener(info => { if (info.windowId === windowId) void refreshTab(); });
  chrome.tabs.onUpdated.addListener(id => { if (id === tab?.id) void refreshTab(); });
  chrome.runtime.onMessage.addListener(event => {
    if (event.kind === 'atlas-capture-finished' && event.requestId === busy) finished(event);
    if (event.kind === 'atlas-preferences-changed') void loadPreferences();
  });
  window.addEventListener('focus', () => void refreshTab());
  void refreshTab(); void loadPreferences();
}
