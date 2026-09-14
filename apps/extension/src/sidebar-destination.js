import { $, openDialog, message } from './ui.js';
import { bindSaveTags } from './save-details.js';

export function bindSidebarDestination() {
  let windowId, draft = null, collections = [], folders = [], busy = false, creating = false, epoch = 0, saveTimer;
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
  const tags = bindSaveTags($('destinationTags'), changed);
  const sharedTags = bindSaveTags($('destinationSharedTags'), changed, { maxTags:10 });
  function form() {
    return { title:$('destinationPersonalTitle').value, note:$('destinationNote').value, folderId:$('destinationFolder').value,
      destination:$('saveDestination').value, tags:tags.get(), tagInput:tags.pending(),
      sharedTitle:$('destinationTitle').value, sharedUrl:$('destinationUrl').value, sharedBody:$('destinationBody').value,
      sharedTags:sharedTags.get(), sharedTagInput:sharedTags.pending(), shareImage:$('destinationImage').checked, newFolder:$('destinationFolderName').value };
  }
  function changed() {
    clearTimeout(saveTimer);
    if (!draft || busy) return;
    const id = draft.id, values = form();
    saveTimer = setTimeout(() => {
      void request('save-review-update', { id, form:values }).catch(error => {
        if (draft?.id === id) message($('destinationFeedback'), error.message, 'error');
      });
    }, 180);
  }
  function preserveBeforeClose() {
    clearTimeout(saveTimer);
    if (draft && !busy) void request('save-review-update', { id:draft.id, form:form() }).catch(() => {});
  }
  function selection() {
    const value = $('saveDestination').value, local = value === 'local' || !draft?.accountId;
    const collection = collections.find(item => 'collection:' + item.id === value);
    $('destinationFields').disabled = busy || creating;
    $('destinationConfirm').disabled = busy || creating || !value;
    $('destinationCancel').disabled = busy || creating;
    $('destinationFolder').disabled = local || busy || creating;
    $('destinationNewFolderToggle').disabled = local || busy || creating;
    $('destinationFolderHint').hidden = !local;
    $('destinationShare').hidden = !collection;
    $('destinationPreservation').hidden = draft?.action !== 'tweet' || !value || value === 'local';
    $('destinationTitle').required = !!collection;
    $('destinationImageLabel').hidden = !collection || !['region','fullpage','save-image'].includes(draft?.action);
    $('destinationConfirm').textContent = creating ? 'Creating folder…' : collection ? (collection.requireApproval && !collection.canModerate ? 'Submit for approval' : 'Save to collection') : value === 'local' ? 'Save in this browser' : 'Save';
    $('destinationRules').textContent = collection
      ? `${collection.visibility === 'public' ? 'Public collection: anyone can read approved entries.' : 'Private collection: accepted members can read.'} ${collection.requireApproval && !collection.canModerate ? 'Your submission needs approval.' : 'Your entry appears immediately.'}${collection.rules ? ' Rules: ' + collection.rules : ''}`
      : value === 'local' ? 'Kept only in this browser. You can import it to your account later.' : value ? 'Private to your account. A copy stays in this browser, including while offline.' : '';
    if (local) { $('destinationNewFolder').hidden = true; $('destinationNewFolderToggle').setAttribute('aria-expanded', 'false'); }
  }
  function renderFolders(selected = $('destinationFolder').value) {
    $('destinationFolder').replaceChildren(new Option('No folder', ''));
    for (const folder of folders) $('destinationFolder').add(new Option(folder.displayName || folder.name, folder.id));
    if (selected && !folders.some(folder => folder.id === selected)) $('destinationFolder').add(new Option('Unavailable folder — choose another', selected));
    $('destinationFolder').value = selected;
  }
  function renderDestinations(selected = $('saveDestination').value) {
    $('saveDestination').replaceChildren(new Option('Choose a destination', ''));
    if (draft?.accountId) $('saveDestination').add(new Option('My library · Private', 'library'));
    $('saveDestination').add(new Option('This browser only', 'local'));
    if (collections.length) {
      const group = document.createElement('optgroup'); group.label = 'Collections';
      for (const collection of collections) group.append(new Option(`${collection.title} · ${collection.visibility === 'public' ? 'Public' : 'Private'}`, 'collection:' + collection.id));
      $('saveDestination').append(group);
    }
    if (selected && ![...$('saveDestination').options].some(option => option.value === selected)) $('saveDestination').add(new Option('Unavailable collection — choose another', selected));
    $('saveDestination').value = selected;
  }
  async function loadDestinations() {
    const revision = ++epoch, owner = draft?.accountId;
    $('destinationReload').hidden = true;
    if (!owner) { selection(); return; }
    message($('destinationFeedback'), 'Loading folders and tags…');
    const results = await Promise.allSettled([api('organization'), api('collections')]);
    if (revision !== epoch || draft?.accountId !== owner) return;
    if (results[0].status === 'fulfilled') {
      folders = results[0].value.folders || []; renderFolders();
      const names = [...(results[0].value.tags || []).map(tag => tag.name), ...(results[0].value.suggestedTags || [])];
      tags.suggest(names); sharedTags.suggest(names);
    }
    if (results[1].status === 'fulfilled') {
      collections = (results[1].value.collections || []).filter(item => item.canSubmit); renderDestinations();
    }
    selection();
    const failed = results.some(result => result.status === 'rejected');
    message($('destinationFeedback'), failed ? 'Some folders or collections could not load. Your notes and tags are kept. Retry, or save without a folder.' : '', failed ? 'error' : '');
    $('destinationReload').hidden = !failed;
  }
  async function refresh() {
    if (busy || creating) return;
    try {
      const result = await request('save-review-get');
      if (result.draft?.id === draft?.id) { if (draft && !dialog.open) openDialog(dialog); return; }
      clearTimeout(saveTimer); draft = result.draft; epoch++;
      if (!draft) { dialog.close(); return; }
      folders = []; collections = [];
      const stored = draft.form || {};
      $('destinationSource').textContent = draft.tweet?.title || (draft.action === 'note' ? 'Your note' : draft.tab.title) || 'Your next good find';
      $('destinationOriginal').open = false; $('destinationOriginal').hidden = draft.action === 'note';
      $('destinationExcerpt').textContent = draft.tweet?.text || draft.text || draft.info?.selectionText || draft.info?.linkUrl || draft.tab.url || '';
      $('destinationPersonalTitle').value = stored.title ?? (draft.action === 'note' ? '' : draft.tweet?.title || draft.tab.title || '').slice(0, 1000);
      $('destinationNote').value = stored.note ?? (draft.action === 'note' ? draft.text || '' : '');
      $('destinationNoteLabel').textContent = draft.action === 'note' ? 'Note' : 'Personal note';
      $('destinationTitle').value = stored.sharedTitle ?? (draft.tweet?.title || draft.tab.title || 'A note worth keeping').slice(0, 200);
      $('destinationUrl').value = stored.sharedUrl ?? (draft.tweet?.url || draft.info?.linkUrl || (/^https?:\/\//.test(draft.tab.url || '') && (draft.action !== 'note' || draft.attachPage) ? draft.tab.url : ''));
      $('destinationBody').value = stored.sharedBody ?? (draft.tweet?.text || draft.text || draft.info?.selectionText || '').slice(0, 5000);
      $('destinationImage').checked = stored.shareImage === true;
      $('destinationFolderName').value = stored.newFolder || ''; $('destinationNewFolder').hidden = !stored.newFolder;
      $('destinationNewFolderToggle').setAttribute('aria-expanded', String(!!stored.newFolder));
      message($('destinationFolderFeedback'), ''); message($('destinationFeedback'), '');
      tags.set(stored.tags || [], stored.tagInput || ''); sharedTags.set(stored.sharedTags || [], stored.sharedTagInput || '');
      renderFolders(stored.folderId || ''); renderDestinations(stored.destination || (draft.accountId ? 'library' : 'local'));
      selection(); openDialog(dialog); void loadDestinations();
    } catch (error) { message($('captureFeedback'), error.message, 'error'); }
  }
  $('saveDestination').onchange = () => { selection(); changed(); };
  $('destinationForm').addEventListener('input', changed);
  $('destinationForm').addEventListener('change', changed);
  $('destinationReload').onclick = () => void loadDestinations();
  $('destinationNewFolderToggle').onclick = () => {
    const open = $('destinationNewFolder').hidden; $('destinationNewFolder').hidden = !open;
    $('destinationNewFolderToggle').setAttribute('aria-expanded', String(open)); if (open) $('destinationFolderName').focus();
  };
  $('destinationFolderName').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); $('destinationCreateFolder').click(); } };
  $('destinationCreateFolder').onclick = async () => {
    const name = $('destinationFolderName').value.trim();
    if (!name || !draft?.accountId || busy || creating) return;
    const id = draft.id; creating = true; selection(); message($('destinationFolderFeedback'), 'Creating folder…');
    try {
      const { folder } = await api('create-folder', { name });
      if (draft?.id !== id) return;
      epoch++; folders = [...folders.filter(item => item.id !== folder.id), folder]; renderFolders(folder.id);
      $('destinationFolderName').value = ''; $('destinationNewFolder').hidden = true; $('destinationNewFolderToggle').setAttribute('aria-expanded', 'false');
      message($('destinationFolderFeedback'), ''); changed(); void loadDestinations();
    } catch (error) { if (draft?.id === id) message($('destinationFolderFeedback'), error.message, 'error'); }
    finally { creating = false; selection(); }
  };
  $('destinationCancel').onclick = async () => {
    if (busy || creating || !draft) return;
    clearTimeout(saveTimer);
    try { await request('save-review-cancel', { id:draft.id }); draft = null; epoch++; dialog.close(); message($('captureFeedback'), 'Save cancelled.'); }
    catch (error) { message($('destinationFeedback'), error.message, 'error'); }
  };
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!busy && !creating) $('destinationCancel').click(); });
  dialog.addEventListener('close', changed);
  $('destinationForm').onsubmit = async event => {
    event.preventDefault(); if (busy || creating || !draft || !$('saveDestination').value) return;
    if (!tags.flush() || (!$('destinationShare').hidden && !sharedTags.flush())) return;
    clearTimeout(saveTimer);
    const pending = draft, value = $('saveDestination').value, [kind, id] = value.split(':');
    const collection = collections.find(item => item.id === id);
    const choice = { kind, id, details: { sourceTitle:$('destinationPersonalTitle').value, noteText:$('destinationNote').value,
      folderId:kind === 'local' ? null : $('destinationFolder').value || null, userTags:tags.get() },
      ...(kind === 'collection' ? { visibility:collection?.visibility, entry: {
        title:$('destinationTitle').value, url:$('destinationUrl').value, body:$('destinationBody').value, tags:sharedTags.get(), shareImage:$('destinationImage').checked,
      } } : {}) };
    busy = true; dialog.dataset.busy = 'true'; selection();
    message($('destinationFeedback'), draft.action === 'region' ? 'Drag over the page to select a region. Press Esc on the page to cancel.' : 'Saving…');
    try {
      if (pending.action === 'save-image') {
        const origin = new URL(pending.info.srcUrl).origin + '/*';
        if (!await chrome.permissions.request({ origins:[origin] })) throw new Error('Allow access to the image’s site to save its original file, then try again.');
      }
      const result = await request('save-review-confirm', { id:pending.id, choice });
      draft = null; epoch++; dialog.close(); document.dispatchEvent(new CustomEvent('foundkeep-save-completed', { detail:{ draft:pending, result } }));
    } catch (error) { message($('destinationFeedback'), error.message, 'error'); }
    finally { busy = false; dialog.dataset.busy = 'false'; selection(); if (draft) changed(); }
  };
  chrome.runtime.onMessage.addListener(event => { if (event.kind === 'foundkeep-save-review-changed') void refresh(); });
  window.addEventListener('focus', () => void refresh());
  window.addEventListener('pagehide', preserveBeforeClose);
  document.addEventListener('visibilitychange', () => { if (document.hidden) preserveBeforeClose(); });
  void refresh();
}
