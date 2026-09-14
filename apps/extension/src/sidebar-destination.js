import { $, openDialog, message } from './ui.js';

export function bindSidebarDestination() {
  let windowId, draft = null, collections = [], busy = false, epoch = 0;
  const dialog = $('destinationDialog');
  const request = async (kind, values = {}) => {
    windowId ??= (await chrome.windows.getCurrent()).id;
    const result = await chrome.runtime.sendMessage({ kind, windowId, ...values });
    if (!result?.ok) throw new Error(result?.error || 'Could not prepare the save. Try again.');
    return result;
  };
  const api = async (operation, args = {}) => {
    const result = await request('library-request', { operation, args, accountId: draft?.accountId });
    return result.data;
  };
  function selection() {
    const value = $('saveDestination').value;
    const collection = collections.find(item => 'collection:' + item.id === value);
    $('destinationConfirm').disabled = busy || !value;
    $('destinationShare').hidden = !collection;
    $('destinationTitle').required = !!collection;
    $('destinationImageLabel').hidden = !collection || !['region','fullpage','save-image'].includes(draft?.action);
    $('destinationConfirm').textContent = collection ? (collection.requireApproval && !collection.canModerate ? 'Submit for approval' : 'Save to collection') : value === 'local' ? 'Save in this browser' : 'Save';
    $('destinationRules').textContent = collection
      ? `${collection.visibility === 'public' ? 'Public collection: anyone can read approved entries.' : 'Private collection: accepted members can read.'} ${collection.requireApproval && !collection.canModerate ? 'Your submission needs approval.' : 'Your entry appears immediately.'}${collection.rules ? ' Rules: ' + collection.rules : ''}`
      : value === 'local' ? 'Kept only in this browser. You can import it to your account later.' : value ? 'Private to your account. A copy stays in this browser, including while offline.' : '';
  }
  async function loadDestinations() {
    const revision = ++epoch, owner = draft?.accountId;
    collections = [];
    $('saveDestination').replaceChildren(new Option('Choose a destination', ''));
    if (owner) $('saveDestination').add(new Option('My library · Private', 'library'));
    $('saveDestination').add(new Option('This browser only', 'local'));
    $('destinationReload').hidden = true; selection();
    if (!owner) return;
    message($('destinationFeedback'), 'Loading folders and collections…');
    const results = await Promise.allSettled([api('organization'), api('collections')]);
    if (revision !== epoch || draft?.accountId !== owner) return;
    const selected = $('saveDestination').value;
    if (results[0].status === 'fulfilled') {
      const group = document.createElement('optgroup'); group.label = 'Private folders';
      for (const folder of results[0].value.folders || []) group.append(new Option(folder.displayName || folder.name, 'folder:' + folder.id));
      if (group.children.length) $('saveDestination').append(group);
    }
    if (results[1].status === 'fulfilled') {
      collections = (results[1].value.collections || []).filter(item => item.canSubmit);
      const group = document.createElement('optgroup'); group.label = 'Collections';
      for (const collection of collections) group.append(new Option(`${collection.title} · ${collection.visibility === 'public' ? 'Public' : 'Private'}`, 'collection:' + collection.id));
      if (group.children.length) $('saveDestination').append(group);
    }
    $('saveDestination').value = selected; selection();
    const failed = results.some(result => result.status === 'rejected');
    message($('destinationFeedback'), failed ? 'Some destinations could not load. Retry, or save to your private library or this browser.' : '', failed ? 'error' : '');
    $('destinationReload').hidden = !failed;
  }
  async function refresh() {
    if (busy) return;
    try {
      const result = await request('save-review-get');
      if (result.draft?.id === draft?.id) { if (draft && !dialog.open) openDialog(dialog); return; }
      draft = result.draft; epoch++;
      if (!draft) { dialog.close(); return; }
      $('destinationSource').textContent = draft.tweet?.title || (draft.action === 'note' ? 'Your note' : draft.tab.title) || 'Your next good find';
      $('destinationExcerpt').textContent = (draft.tweet?.text || draft.text || draft.info?.selectionText || draft.info?.linkUrl || draft.tab.url || '').slice(0, 600);
      $('destinationTitle').value = (draft.tweet?.title || draft.tab.title || 'A note worth keeping').slice(0, 200);
      $('destinationUrl').value = draft.tweet?.url || draft.info?.linkUrl || (/^https?:\/\//.test(draft.tab.url || '') && (draft.action !== 'note' || draft.attachPage) ? draft.tab.url : '');
      $('destinationBody').value = (draft.tweet?.text || draft.text || draft.info?.selectionText || '').slice(0, 5000);
      $('destinationImage').checked = false;
      openDialog(dialog); void loadDestinations();
    } catch (error) { message($('captureFeedback'), error.message, 'error'); }
  }
  $('saveDestination').onchange = selection;
  $('destinationReload').onclick = () => void loadDestinations();
  $('destinationCancel').onclick = async () => {
    if (busy || !draft) return;
    try { await request('save-review-cancel', { id: draft.id }); draft = null; epoch++; dialog.close(); message($('captureFeedback'), 'Save cancelled.'); }
    catch (error) { message($('destinationFeedback'), error.message, 'error'); }
  };
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!busy) $('destinationCancel').click(); });
  // Clicking the backdrop dismisses the view; the review remains recoverable
  // when the sidebar is reopened. Only Cancel discards the pending request.
  $('destinationForm').onsubmit = async event => {
    event.preventDefault(); if (busy || !draft || !$('saveDestination').value) return;
    const pending = draft, value = $('saveDestination').value;
    const [kind, id] = value.split(':');
    const collection = collections.find(item => item.id === id);
    const choice = { kind, id, ...(kind === 'collection' ? { visibility: collection?.visibility, entry: {
      title: $('destinationTitle').value, url: $('destinationUrl').value, body: $('destinationBody').value, shareImage: $('destinationImage').checked,
    } } : {}) };
    busy = true; dialog.dataset.busy = 'true'; $('destinationCancel').disabled = true; $('saveDestination').disabled = true; selection();
    message($('destinationFeedback'), draft.action === 'region' ? 'Drag over the page to select a region. Press Esc on the page to cancel.' : 'Saving…');
    try {
      // Request on this submit gesture, after the user chooses where to save.
      // Doing this after worker/storage awaits loses Chrome's gesture grant.
      if (pending.action === 'save-image') {
        const origin = new URL(pending.info.srcUrl).origin + '/*';
        if (!await chrome.permissions.request({ origins: [origin] })) throw new Error('Allow access to the image’s site to save its original file, then try again.');
      }
      const result = await request('save-review-confirm', { id: pending.id, choice });
      draft = null; epoch++; dialog.close();
      document.dispatchEvent(new CustomEvent('foundkeep-save-completed', { detail: { draft: pending, result } }));
    } catch (error) { message($('destinationFeedback'), error.message, 'error'); }
    finally { busy = false; dialog.dataset.busy = 'false'; $('destinationCancel').disabled = false; $('saveDestination').disabled = false; selection(); }
  };
  chrome.runtime.onMessage.addListener(event => { if (event.kind === 'foundkeep-save-review-changed') void refresh(); });
  window.addEventListener('focus', () => void refresh());
  void refresh();
}
