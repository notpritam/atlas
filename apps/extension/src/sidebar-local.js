import * as db from './db.js';
import { $, icon, title, ago, domain, sourceUrl, openDialog, message } from './ui.js';

export function bindSidebarLocal() {
  let revision = 0, selected = null, imageUrl = null, searchTimer;
  const releaseImage = () => { if (imageUrl) URL.revokeObjectURL(imageUrl); imageUrl = null; };
  async function refresh() {
    if (!$('localDialog').open) return;
    const current = ++revision;
    try {
      const rows = await db.listCaptures({ q: $('localQuery').value.trim(), limit: Infinity });
      if (current !== revision) return;
      $('localItems').replaceChildren(); $('localEmpty').hidden = !!rows.length;
      for (const capture of rows) {
        const button = document.createElement('button'); button.className = 'save-card';
        button.innerHTML = `<span class="save-preview">${icon(capture.type)}</span><span class="save-copy"><span class="save-title"></span><span class="save-meta"></span></span>`;
        button.querySelector('.save-title').textContent = title(capture);
        button.querySelector('.save-meta').textContent = `${domain(capture.sourceUrl)} · ${ago(capture.createdAt)}`;
        button.onclick = () => void show(capture.id); $('localItems').append(button);
      }
    } catch (error) { message($('localFeedback'), error.message, 'error'); }
  }
  async function show(id) {
    try {
      const capture = await db.getCapture(id); if (!capture) { await refresh(); return; }
      selected = id; releaseImage(); $('localList').hidden = true; $('localDetail').hidden = false;
      $('localDeletePrompt').hidden = true;
      $('localTitle').textContent = title(capture);
      $('localState').textContent = capture.cloudAccountId ? (capture.cloudStatus === 'synced' ? 'Account copy synced. This is the copy kept in your browser.' : 'Waiting to sync to the account this capture was saved with.') : 'Only in this browser. Connect and import local captures to sync it.';
      $('localText').textContent = [capture.noteText, capture.selectionText, capture.articleText, capture.ocrText].filter(Boolean).join('\n\n');
      const url = sourceUrl(capture.sourceUrl); $('localSource').hidden = !url; if (url) $('localSource').href = url;
      const image = capture.blob && /^image\/(png|jpeg|webp|gif)$/.test(capture.blob.type);
      $('localImage').hidden = $('localDownload').hidden = !image;
      if (image) {
        imageUrl = URL.createObjectURL(capture.blob); $('localImage').src = imageUrl; $('localDownload').href = imageUrl;
        $('localDownload').download = `foundkeep-${capture.id}.${capture.blob.type.split('/')[1]}`;
      }
      $('localBack').focus();
    } catch (error) { message($('localFeedback'), error.message, 'error'); }
  }
  function back() {
    selected = null; releaseImage(); $('localDetail').hidden = true; $('localList').hidden = false; $('localQuery').focus(); void refresh();
  }
  $('openLocal').onclick = () => { openDialog($('localDialog')); back(); };
  $('localBack').onclick = back;
  $('localQuery').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => void refresh(), 180); };
  $('localDelete').onclick = () => { $('localDeletePrompt').hidden = false; $('localCancelDelete').focus(); };
  $('localCancelDelete').onclick = () => { $('localDeletePrompt').hidden = true; $('localDelete').focus(); };
  $('localConfirmDelete').onclick = async () => {
    if (!selected) return; $('localConfirmDelete').disabled = true;
    try { await db.deleteCapture(selected); back(); }
    catch (error) { message($('localFeedback'), error.message, 'error'); }
    finally { $('localConfirmDelete').disabled = false; }
  };
  $('localDialog').addEventListener('close', () => { revision++; releaseImage(); });
  chrome.runtime.onMessage.addListener(event => { if (event.kind === 'atlas-changed') void refresh(); });
  return { refresh };
}
