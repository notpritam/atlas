import { mountOAuthButtons } from './oauth.js?v=20260910-scenic-auth';
import { $, api, textElement, setMessage, downloadBlob, recoveryDownload, safeSource, safeBlob, dateLabel, extensionMessage, customerConfig, setAccountContext, renderIphoneLinks, isMobileBrowser, isIphoneBrowser } from './customer.js?v=20260910-platforms';

const state = { account: null, connections: [], usage: null, captures: [], cursor: null, total: 0, type: '', query: '', listRequest: 0, controller: null, detailRequest: 0, detail: null, extension: null, extensionId: null, expired: false, noteClientId: null, recoveryCode: '', connecting: false, preferences: null, preferenceRevision: 0, promotionDismissed: false };
const kinds = { screenshot: 'Screenshot', selection: 'Highlight', bookmark: 'Bookmark', image: 'Image', video: 'Video', audio: 'Audio', document: 'Document', file: 'File', note: 'Note', tweet: 'Tweet' };
let toastTimer, searchTimer, listRetry = () => loadCaptures();

function toast(message) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5000);
}
function openDialog(id) { if (!$(id).open) $(id).showModal(); }
function closeDialog(id) { $(id).close(); }
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => closeDialog(`#${button.dataset.close}`)));
function confirmAction(title, description, label = 'Continue') {
  const dialog = $('#confirm-dialog');
  $('#confirm-title').textContent = title; $('#confirm-description').textContent = description; $('#confirm-accept').textContent = label;
  dialog.returnValue = 'cancel'; openDialog('#confirm-dialog'); $('#confirm-cancel').focus();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
}
function expireSession(event) {
  if (state.expired) return;
  state.expired = true; state.controller?.abort(); state.listRequest++; state.detailRequest++;
  state.account = null; state.captures = []; state.detail = null; state.connections = []; state.usage = null;
  state.recoveryCode = ''; state.extension = null; state.extensionId = null; state.cursor = null; state.query = ''; state.preferences = null; state.preferenceRevision = 0;
  $('#capture-grid').replaceChildren(); $('#detail-body').replaceChildren(textElement('h2', 'Log in to view this capture.'));
  $('#account-name').textContent = 'Your account'; $('#settings-email').textContent = ''; $('#device-list').replaceChildren();
  $('#account-avatar').textContent = 'A'; $('#nav-count').textContent = '—'; $('#usage-summary').textContent = ''; $('#settings-usage').textContent = '';
  $('#results-count').textContent = ''; $('#search').value = ''; $('#library-description').textContent = 'Log in to open your private library.';
  $('#password-recovery-code').textContent = ''; $('#password-recovery-saved').checked = false; $('#extension-status').textContent = '';
  $('#toast').hidden = true; $('#toast').textContent = ''; setMessage($('#page-message'), '');
  $('#note-text').value = ''; $('#password-form').reset(); $('#delete-account-form').reset(); $('#preference-form').reset(); $('#preference-form').dataset.ready = 'false';
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  $('#library-state').hidden = true; $('#onboarding').hidden = true; $('#device-promotion').hidden = true; $('#iphone-status').textContent = ''; $('#iphone-signin-note').textContent = ''; $('#new-note').disabled = true;
  if (event?.detail?.code === 'account_changed') $('#session-description').textContent = 'Your signed-in account changed in another tab. This action was stopped to protect your collection. Log in again to open the correct library.';
  openDialog('#session-dialog');
}
window.addEventListener('atlas-session-expired', expireSession);
$('#session-dialog').addEventListener('cancel', event => event.preventDefault());
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
function bytes(value) { return `${((value || 0) / 1048576).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`; }
function fileBytes(value) {
  const amount = Math.max(0, Number(value) || 0);
  if (amount < 1024) return `${amount} B`;
  if (amount < 1048576) return `${(amount / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB`;
  return `${(amount / 1048576).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
}
function safeFileUrl(value, id) {
  const expected = `/api/captures/${encodeURIComponent(String(id))}/file`;
  return value === expected ? expected : null;
}
function updateAccount() {
  const { account, usage, connections } = state;
  if (!account) return;
  $('#account-name').textContent = account.name || account.email;
  $('#account-avatar').textContent = (account.name || account.email).slice(0, 1).toUpperCase();
  $('#settings-email').textContent = account.email;
  $('#password-settings').hidden = account.hasPassword === false;
  if (usage) {
    $('#nav-count').textContent = usage.captures.toLocaleString();
    $('#usage-summary').textContent = `${usage.captures.toLocaleString()} captures · ${bytes(usage.bytes)}`;
    $('#settings-usage').textContent = `${usage.captures.toLocaleString()} of ${usage.maxCaptures.toLocaleString()} captures · ${bytes(usage.bytes)} of ${bytes(usage.maxBytes)}`;
    $('#library-description').textContent = usage.captures ? `${usage.captures.toLocaleString()} ${usage.captures === 1 ? 'good thing' : 'good things'} worth coming back to.` : 'A place for the things worth keeping.';
  }
  $('#device-list').replaceChildren();
  if (!connections.length) $('#device-list').append(textElement('li', 'No apps or browsers connected yet.', 'muted device-empty'));
  for (const connection of connections) {
    const row = textElement('li');
    const info = textElement('div');
    info.append(textElement('strong', connection.name || 'FoundKeep device'), textElement('span', `Connected ${dateLabel(connection.createdAt)} · ${connection.lastSeenAt ? `Last active ${dateLabel(connection.lastSeenAt, true)}` : 'Not used yet'}`));
    const button = textElement('button', 'Revoke', 'subtle-button danger-text'); button.type = 'button'; button.setAttribute('aria-label', `Revoke ${connection.name || 'FoundKeep device'}`);
    button.addEventListener('click', async () => {
      if (!await confirmAction('Disconnect this device?', `${connection.name || 'This device'} will lose access to your cloud library. Its local captures remain on that device.`, 'Revoke access')) return;
      button.disabled = true;
      try {
        await api(`/connections/${encodeURIComponent(connection.id)}`, { method: 'DELETE' });
        await refreshAccount(); await detectExtension(); toast('Device access revoked.');
      } catch (error) { if (!state.expired) setMessage($('#account-message'), error.message); }
      finally { button.disabled = false; }
    });
    row.append(info, button); $('#device-list').append(row);
  }
  updateOnboarding();
}
async function refreshAccount() {
  const result = await api('/me');
  if (state.expired) return;
  if (state.account && result.account.id !== state.account.id) {
    expireSession();
    $('#session-description').textContent = 'Your signed-in account changed in another tab. Log in again to open the correct library.';
    return;
  }
  if (!state.account) setAccountContext(result.account.id);
  state.account = result.account; state.connections = result.connections; state.usage = result.usage;
  updateAccount();
}
function updateOnboarding() {
  const connected = !!state.account && state.extension?.account?.id === state.account.id;
  const mobile = state.connections.filter(connection => connection.clientKind === 'mobile');
  const unknown = state.connections.some(connection => !connection.clientKind || connection.clientKind === 'unknown');
  $('#iphone-status').textContent = mobile.length ? `iPhone app connected to this account${mobile.length > 1 ? ` on ${mobile.length} devices` : ''}.` : unknown ? 'No iPhone connection confirmed yet. Open the app to refresh an existing connection.' : 'No iPhone app connected to this account yet.';
  $('#iphone-status').classList.toggle('connection-success', !!mobile.length);
  $('#iphone-signin-note').textContent = mobile.length ? 'Your app and this dashboard share one collection. New saves sync when you’re online.' : 'Sign in to the app with the same FoundKeep account. Your saves will appear here.';
  $('#open-iphone').textContent = mobile.length ? 'Open the app on iPhone' : 'Already installed? Open app';
  $('#open-iphone').className = mobile.length ? 'button primary compact' : 'text-link';
  $('#install-iphone').className = mobile.length ? 'text-link' : 'button primary compact';
  if (mobile.length) $('#install-iphone').textContent = 'Install on another iPhone';
  else void customerConfig().then(config => { if (!state.expired && !state.connections.some(connection => connection.clientKind === 'mobile')) renderIphoneLinks(config); });
  $('#browser-connection-badge').textContent = connected ? 'Connected here' : state.extension ? 'Installed here' : isMobileBrowser() ? 'For your computer' : 'Not connected here';
  $('#device-promotion-copy').textContent = mobile.length ? 'Collect from your computer, too. Add FoundKeep to your browser.' : 'Your finds, on the go. Bring FoundKeep to your iPhone.';
  $('#device-promotion').hidden = state.promotionDismissed || !state.usage?.captures || !$('#onboarding').hidden || (mobile.length > 0 && (connected || isMobileBrowser()));
  $('#install-marker').classList.toggle('step-done', !!state.extension);
  $('#connect-marker').classList.toggle('step-done', connected);
  $('#capture-marker').classList.toggle('step-done', !!state.usage?.captures);
  $('#connect-extension').textContent = connected ? 'Reconnect FoundKeep' : state.extension?.account ? 'Switch FoundKeep account' : 'Connect FoundKeep';
  if (state.usage?.captures) {
    $('#first-capture-title').textContent = 'Your collection has started';
    $('#first-capture-description').textContent = 'Keep saving from your iPhone, browser or the web. New saves sync here when you’re online.';
  } else {
    $('#first-capture-title').textContent = 'Save your first find';
    $('#first-capture-description').textContent = 'Share something to FoundKeep on iPhone, save it with the extension, or write a note here.';
  }
}
async function detectExtension() {
  const config = await customerConfig();
  renderIphoneLinks(config);
  if (config.storeUrl) {
    $('#install-extension').href = config.storeUrl; $('#install-extension').removeAttribute('download');
    $('#install-extension').target = '_blank'; $('#install-extension').rel = 'noopener noreferrer';
    $('#install-extension').textContent = 'Add to Chrome';
    $('#install-description').textContent = 'Use Chrome on your computer to add FoundKeep from the Chrome Web Store, then pin it in your extensions menu.';
  }
  const attempts = await Promise.allSettled(config.extensionIds.map(async id => ({ id, result: await extensionMessage({ kind: 'atlas-ping' }, id) })));
  const available = attempts.filter(attempt => attempt.status === 'fulfilled');
  const success = available.find(attempt => attempt.value.result.account?.id === state.account?.id) || available[0];
  if (state.expired) return null;
  if (success) {
    state.extension = success.value.result; state.extensionId = success.value.id;
    const account = state.extension.account;
    $('#extension-status').textContent = account?.id === state.account?.id ? `Connected as ${account.email}. New captures sync to this library.` : account ? `This browser is connected to ${account.email}. Confirm before switching accounts.` : 'FoundKeep is installed. Connect it to start syncing new captures.';
    $('#extension-status').classList.toggle('connection-success', account?.id === state.account?.id);
  } else {
    state.extension = null; state.extensionId = null;
    $('#extension-status').textContent = isMobileBrowser() ? 'The browser extension is for your computer. On iPhone, use the app and Share menu.' : 'FoundKeep isn’t detected. Install it in a supported Chromium browser, then reload this page. If it’s already installed, reload it from the browser’s extensions page.';
    $('#extension-status').classList.remove('connection-success');
  }
  updateOnboarding(); return state.extension;
}
$('#connect-extension').addEventListener('click', async () => {
  if (state.connecting || state.expired) return;
  state.connecting = true; $('#connect-extension').disabled = true;
  try {
    const extension = await detectExtension();
    if (!extension) { $('#manual-install').open = true; throw new Error('Install or reload FoundKeep in Chrome first. Then reload this page and connect again.'); }
    if (extension.account && extension.account.id !== state.account.id) {
      const accepted = await confirmAction('Switch this browser’s account?', `FoundKeep is connected to ${extension.account.email}. New captures will sync to ${state.account.email} after switching. Captures waiting to upload for the previous account stay with that account.`, 'Switch account');
      if (!accepted) return;
    }
    $('#extension-status').textContent = 'Connecting your browser…';
    const pairing = await api('/pairing', { method: 'POST', body: {} });
    const result = await extensionMessage({ kind: 'atlas-connect', code: pairing.code }, state.extensionId);
    if (result.account?.id !== state.account.id) throw new Error('The extension connected to a different account. Reload this page and reconnect.');
    state.extension = { ...state.extension, account: result.account };
    await refreshAccount();
    $('#extension-status').textContent = `Connected as ${result.account.email}. Your next capture will sync here.`;
    $('#extension-status').classList.add('connection-success'); toast('Browser connected. Save your first find with FoundKeep.');
  } catch (error) {
    if (!state.expired) { $('#extension-status').textContent = error.message; $('#extension-status').classList.remove('connection-success'); }
  } finally { state.connecting = false; $('#connect-extension').disabled = false; updateOnboarding(); }
});
$('#copy-extensions').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText('chrome://extensions'); $('#copy-result').textContent = 'Copied. Paste it into Chrome’s address bar.'; }
  catch { $('#copy-result').textContent = 'Copy chrome://extensions and paste it into Chrome’s address bar.'; }
});
function showDeviceSetup() {
  if (state.expired) return;
  $('#onboarding').hidden = false; updateOnboarding();
  $('#onboarding').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  void detectExtension();
}
window.addEventListener('hashchange', () => { if (location.hash === '#devices') showDeviceSetup(); });
$('#open-setup').addEventListener('click', showDeviceSetup);
$('#show-devices').addEventListener('click', showDeviceSetup);
$('#dismiss-device-promotion').addEventListener('click', () => { state.promotionDismissed = true; updateOnboarding(); });
$('#hide-setup').addEventListener('click', () => { $('#onboarding').hidden = true; updateOnboarding(); $('#open-setup').focus(); });
if (isIphoneBrowser()) $('.device-options').prepend($('.iphone-option'));
if (isMobileBrowser()) $('#connect-extension').hidden = true;
window.addEventListener('focus', () => {
  if (state.account && !state.expired) void Promise.allSettled([refreshAccount(), detectExtension()]);
});

function showLibraryState(title, description, { loading = false, retry, action, label } = {}) {
  const holder = $('#library-state'); holder.replaceChildren(); holder.hidden = false; holder.classList.toggle('is-loading', loading);
  holder.append(textElement('h2', title), textElement('p', description));
  if (loading) {
    const skeleton = document.createElement('div'); skeleton.className = 'library-skeleton'; skeleton.setAttribute('aria-hidden', 'true');
    skeleton.append(...Array.from({ length: 3 }, () => document.createElement('span'))); holder.append(skeleton);
  }
  if (retry || action) {
    const button = textElement('button', label || 'Try again', 'button secondary'); button.type = 'button';
    button.addEventListener('click', retry || action); holder.append(button);
  }
}
function captureTitle(capture) {
  return capture.sourceTitle || capture.fileName || (capture.noteText || capture.selectionText || '').slice(0, 120) || `Untitled ${kinds[capture.type]?.toLowerCase() || 'capture'}`;
}

const captureMethods = {
  'popup-save-page': 'Saved from popup', 'popup-highlight': 'Highlight from popup', 'popup-region': 'Region from popup', 'popup-full-page': 'Full page from popup',
  'keyboard-highlight': 'Highlight keyboard shortcut', 'keyboard-region': 'Region keyboard shortcut', 'keyboard-full-page': 'Full page keyboard shortcut',
  'context-save-page': 'Saved from right-click menu', 'context-selection': 'Selection from right-click menu', 'context-link': 'Link from right-click menu', 'context-image': 'Image from right-click menu',
  'extension-note': 'Note from extension', 'library-note': 'Note from library', 'twitter-action': 'Saved from X',
  'ios-share-url': 'Shared from iPhone', 'ios-share-text': 'Text shared from iPhone', 'ios-share-image': 'Image shared from iPhone',
  'ios-share-video': 'Video shared from iPhone', 'ios-share-audio': 'Audio shared from iPhone', 'ios-share-document': 'Document shared from iPhone',
  'ios-share-file': 'File shared from iPhone', 'ios-app-note': 'Note from iPhone app',
};
function originValue(list, label, value) {
  if (value === null || value === undefined || value === '') return;
  const term = textElement('dt', label); const detail = textElement('dd'); detail.append(value instanceof Node ? value : document.createTextNode(String(value))); list.append(term, detail);
}
function originLink(url, label) {
  const safe = safeSource(url); if (!safe) return null;
  const link = textElement('a', safe.href); link.href = safe.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', `${label}: ${safe.href}`); return link;
}
function appendCaptureOrigin(body, capture) {
  const provenance = capture.provenance;
  if (!provenance || typeof provenance !== 'object') return;
  const section = textElement('details', null, 'detail-origin'); section.id = 'capture-origin';
  section.append(textElement('summary', 'Source details'), textElement('p', 'FoundKeep keeps this record with the capture so you can trace it back to where it came from.', 'detail-origin-intro'));
  const list = textElement('dl');
  originValue(list, 'Original page', originLink(provenance.pageUrl, 'Original page'));
  if (provenance.canonicalUrl !== provenance.pageUrl) originValue(list, 'Canonical page', originLink(provenance.canonicalUrl, 'Canonical page'));
  originValue(list, 'Saved target', originLink(provenance.targetUrl, 'Saved target'));
  originValue(list, 'Page title', provenance.pageTitle);
  originValue(list, 'Publisher', provenance.siteName);
  originValue(list, 'Description', provenance.description);
  originValue(list, 'Author', Array.isArray(provenance.authors) ? provenance.authors.join(', ') : null);
  originValue(list, 'Published', provenance.publishedAt ? dateLabel(provenance.publishedAt, true) : null);
  originValue(list, 'Last changed', provenance.modifiedAt ? dateLabel(provenance.modifiedAt, true) : null);
  originValue(list, 'Page language', provenance.language);
  originValue(list, 'Lead image', originLink(provenance.leadImageUrl, 'Lead image'));
  originValue(list, 'Site icon', originLink(provenance.faviconUrl, 'Site icon'));
  originValue(list, 'Capture method', captureMethods[provenance.captureMethod] || provenance.captureMethod);
  originValue(list, 'Captured', provenance.capturedAt ? dateLabel(provenance.capturedAt, true) : null);
  originValue(list, 'Extracted', provenance.extractedAt ? dateLabel(provenance.extractedAt, true) : null);
  originValue(list, 'Extractor', provenance.extractorVersion);
  originValue(list, 'Origin record', provenance.schemaVersion ? `Version ${provenance.schemaVersion}` : null);
  if (provenance.contentHash) originValue(list, 'Content fingerprint', textElement('code', provenance.contentHash));
  originValue(list, 'Extraction', provenance.extractionStatus);
  if (provenance.extractionError) originValue(list, 'Extraction note', provenance.extractionError);
  originValue(list, 'Source app', provenance.sourceApplication);
  originValue(list, 'Original file', provenance.originalFileName);
  originValue(list, 'Declared type', provenance.declaredMime);
  originValue(list, 'Original size', Number.isSafeInteger(provenance.byteSize) ? fileBytes(provenance.byteSize) : null);
  section.append(list);
  if (Array.isArray(provenance.headings) && provenance.headings.length) {
    const outline = textElement('details', null, 'origin-outline'); outline.append(textElement('summary', `Page outline · ${provenance.headings.length} headings`));
    const headings = textElement('ol'); headings.append(...provenance.headings.map(heading => textElement('li', String(heading)))); outline.append(headings); section.append(outline);
  }
  body.append(section);
}
function captureCard(capture) {
  const card = textElement('article', null, `capture-card capture-${Object.hasOwn(kinds, capture.type) ? capture.type : 'note'}`);
  const button = textElement('button', null, 'capture-open'); button.type = 'button';
  button.setAttribute('aria-label', `Open ${kinds[capture.type] || 'capture'}: ${captureTitle(capture)}`);
  const blob = safeBlob(capture.blobUrl, capture.id);
  if (blob) {
    const image = textElement('img'); image.src = blob; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
    image.addEventListener('error', () => { image.replaceWith(textElement('div', 'Image preview unavailable. Open to retry.', 'image-unavailable')); }, { once: true });
    button.append(image);
  }
  const fileUrl = safeFileUrl(capture.fileUrl, capture.id);
  if (!blob && fileUrl) {
    const preview = textElement('div', null, 'file-card-preview');
    preview.append(
      textElement('span', kinds[capture.type] || 'File', 'file-card-kind'),
      textElement('strong', capture.fileName || 'Shared file'),
      textElement('span', fileBytes(capture.fileBytes), 'file-card-size'),
    );
    button.append(preview);
  }
  const body = textElement('div', null, 'capture-card-body');
  const meta = textElement('div', null, 'capture-meta'); meta.append(textElement('span', kinds[capture.type] || 'Capture'), textElement('time', dateLabel(capture.capturedAt)));
  body.append(meta, textElement('h2', captureTitle(capture)));
  const excerpt = capture.selectionText || capture.noteText || capture.summary || capture.articleText;
  if (excerpt && excerpt !== captureTitle(capture)) body.append(textElement('p', excerpt.slice(0, 700), 'capture-excerpt'));
  const source = safeSource(capture.sourceUrl);
  const foot = textElement('div', null, 'capture-card-footer');
  foot.append(textElement('span', source ? source.hostname.replace(/^www\./, '') : 'Saved in FoundKeep'));
  if (capture.status === 'pending' || capture.status === 'processing') foot.append(textElement('span', 'Adding context', 'processing-status'));
  else if (capture.status === 'failed') foot.append(textElement('span', 'Context unavailable', 'failed-status'));
  body.append(foot); button.append(body); card.append(button);
  button.addEventListener('click', () => openCapture(capture.id));
  return card;
}
async function loadCaptures({ append = false, silent = false } = {}) {
  if (state.expired) return;
  state.controller?.abort(); state.controller = new AbortController();
  const request = ++state.listRequest;
  const params = new URLSearchParams({ limit: '60' });
  if (state.query) params.set('q', state.query);
  if (state.type) params.set('type', state.type);
  if (append && state.cursor) params.set('cursor', state.cursor);
  if (!silent) {
    $('#capture-grid').setAttribute('aria-busy', 'true');
    if (!append) { $('#capture-grid').replaceChildren(); showLibraryState('Opening your library…', 'Finding your saved things.', { loading: true }); }
    $('#load-more').disabled = true;
    setMessage($('#page-message'), '');
  }
  try {
    const result = await api(`/captures?${params}`, { signal: state.controller.signal });
    if (request !== state.listRequest || state.expired) return;
    const existing = append ? new Set(state.captures.map(capture => capture.id)) : new Set();
    const incoming = result.captures.filter(capture => !existing.has(capture.id));
    state.captures = append ? [...state.captures, ...incoming] : incoming;
    state.cursor = result.nextCursor; state.total = result.total;
    $('#library-state').hidden = true;
    if (!append) $('#capture-grid').replaceChildren();
    $('#capture-grid').append(...incoming.map(captureCard));
    $('#results-count').textContent = `${state.total.toLocaleString()} ${state.total === 1 ? 'capture' : 'captures'}${state.query ? ` for “${state.query}”` : ''}`;
    if (!state.captures.length) {
      if (state.query || state.type) showLibraryState('No finds this time.', 'Try a different keyword or clear your filters to see your collection.', { action: resetFilters, label: 'Clear filters' });
      else showLibraryState('Your first good find goes here.', 'Share something from iPhone, save it with the browser extension, or write a note to get your collection started.', { action: openNote, label: 'Write a first note' });
    }
    $('#load-more').hidden = !state.cursor; $('#load-more').textContent = 'Load more captures';
  } catch (error) {
    if (request !== state.listRequest || error.name === 'AbortError' || state.expired) return;
    listRetry = () => loadCaptures({ append });
    if (append || silent) {
      setMessage($('#page-message'), error.message);
      const retryButton = textElement('button', 'Try again', 'subtle-button'); retryButton.type = 'button'; retryButton.addEventListener('click', listRetry); $('#page-message').append(retryButton);
      if (append) $('#load-more').textContent = 'Retry loading more';
    } else { $('#results-count').textContent = ''; $('#load-more').hidden = true; showLibraryState('Your library couldn’t load.', error.message, { retry: listRetry }); }
  } finally {
    if (request === state.listRequest) { $('#capture-grid').setAttribute('aria-busy', 'false'); $('#load-more').disabled = false; }
  }
}
function resetFilters() {
  state.query = ''; state.type = ''; $('#search').value = '';
  document.querySelectorAll('[data-type]').forEach(button => button.setAttribute('aria-pressed', String(!button.dataset.type)));
  loadCaptures();
}
$('#all-captures').addEventListener('click', resetFilters);
$('#search').addEventListener('input', event => {
  clearTimeout(searchTimer); const value = event.target.value.trim();
  searchTimer = setTimeout(() => { state.query = value; loadCaptures(); }, 250);
});
document.querySelectorAll('[data-type]').forEach(button => button.addEventListener('click', () => {
  clearTimeout(searchTimer); state.query = $('#search').value.trim(); state.type = button.dataset.type;
  document.querySelectorAll('[data-type]').forEach(filter => filter.setAttribute('aria-pressed', String(filter === button)));
  loadCaptures();
}));
$('#load-more').addEventListener('click', () => loadCaptures({ append: true }));
async function refreshLibrary() {
  $('#refresh-library').disabled = true; $('#check-captures').disabled = true;
  try { await refreshAccount(); await loadCaptures(); }
  catch (error) { if (!state.expired) setMessage($('#page-message'), error.message); }
  finally { $('#refresh-library').disabled = false; $('#check-captures').disabled = false; }
}
$('#refresh-library').addEventListener('click', refreshLibrary); $('#check-captures').addEventListener('click', refreshLibrary);

async function openCapture(id) {
  const request = ++state.detailRequest;
  state.detail = null; $('#detail-actions').hidden = true;
  $('#detail-body').replaceChildren(Object.assign(textElement('h2', 'Opening capture…'), { id: 'detail-title' }));
  $('#detail-kind').textContent = 'Capture'; openDialog('#detail-dialog');
  try {
    const { capture } = await api(`/captures/${encodeURIComponent(id)}`);
    if (request !== state.detailRequest || state.expired) return;
    state.detail = capture; const body = $('#detail-body'); body.replaceChildren();
    $('#detail-kind').textContent = kinds[capture.type] || 'Capture';
    body.append(Object.assign(textElement('h2', captureTitle(capture)), { id: 'detail-title' }));
    const source = safeSource(capture.provenance?.pageUrl || capture.sourceUrl);
    if (source) {
      const link = textElement('a', `Open source · ${source.hostname}`, 'detail-source'); link.href = source.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; body.append(link);
    }
    const blob = safeBlob(capture.blobUrl, capture.id);
    if (blob) {
      const image = textElement('img', null, 'detail-image'); image.src = blob; image.alt = capture.sourceTitle || 'Saved capture';
      image.addEventListener('error', () => {
        const errorBox = textElement('div', 'The image could not load. ', 'form-message is-error');
        const retry = textElement('button', 'Retry image', 'subtle-button'); retry.type = 'button'; retry.addEventListener('click', () => openCapture(id)); errorBox.append(retry); image.replaceWith(errorBox);
      }, { once: true }); body.append(image);
    }
    const fileUrl = safeFileUrl(capture.fileUrl, capture.id);
    if (fileUrl) {
      if (capture.fileMime?.startsWith('image/')) {
        const image = textElement('img', null, 'detail-image'); image.src = fileUrl; image.alt = capture.fileName || capture.sourceTitle || 'Saved image'; body.append(image);
      } else if (capture.fileMime?.startsWith('video/')) {
        const video = textElement('video', null, 'detail-media'); video.src = fileUrl; video.controls = true; video.preload = 'metadata'; body.append(video);
      } else if (capture.fileMime?.startsWith('audio/')) {
        const audio = textElement('audio', null, 'detail-audio'); audio.src = fileUrl; audio.controls = true; audio.preload = 'metadata'; body.append(audio);
      }
      const filePanel = textElement('section', null, 'detail-file');
      filePanel.append(textElement('h3', capture.fileName || 'Shared file'), textElement('p', `${capture.fileMime || 'File'} · ${fileBytes(capture.fileBytes)}`));
      const link = textElement('a', capture.fileMime === 'application/octet-stream' ? 'Download saved file' : 'Open saved file', 'button secondary compact');
      link.href = fileUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; filePanel.append(link); body.append(filePanel);
    }
    for (const [title, content] of [['Highlight', capture.selectionText], ['Note', capture.noteText], ['Summary', capture.summary], ['Article text', capture.articleText], ['Text in image', capture.ocrText]]) {
      if (!content) continue;
      const section = textElement('section', null, 'detail-section'); section.append(textElement('h3', title), textElement('p', content)); body.append(section);
    }
    appendCaptureOrigin(body, capture);
    if (capture.category) body.append(textElement('p', `Category: ${capture.category}`, 'muted'));
    if (Array.isArray(capture.tags) && capture.tags.length) {
      const tags = textElement('ul', null, 'detail-tags'); tags.setAttribute('aria-label', 'Capture tags');
      tags.append(...capture.tags.map(tag => textElement('li', String(tag)))); body.append(tags);
    }
    if (capture.status === 'pending' || capture.status === 'processing') body.append(textElement('p', 'Your capture is saved. FoundKeep is still adding context; reopen it in a moment to see updates.', 'detail-processing'));
    if (capture.status === 'failed') body.append(textElement('p', 'Your capture is safe. Automatic context could not be added.', 'detail-processing'));
    if (capture.enrichError) body.append(textElement('p', capture.enrichError, 'detail-processing'));
    $('#detail-date').textContent = `Saved ${dateLabel(capture.capturedAt, true)}`; $('#detail-actions').hidden = false;
  } catch (error) {
    if (request !== state.detailRequest || state.expired) return;
    $('#detail-body').replaceChildren(Object.assign(textElement('h2', 'Capture unavailable'), { id: 'detail-title' }), textElement('p', error.status === 404 ? 'This capture may have been deleted. Refresh your library to see your current collection.' : error.message));
    const retry = textElement('button', error.status === 404 ? 'Refresh library' : 'Try again', 'button secondary'); retry.type = 'button';
    retry.addEventListener('click', () => { if (error.status === 404) { closeDialog('#detail-dialog'); refreshLibrary(); } else openCapture(id); }); $('#detail-body').append(retry);
  }
}
$('#detail-dialog').addEventListener('close', () => { state.detailRequest++; state.detail = null; });
$('#delete-capture').addEventListener('click', async () => {
  const capture = state.detail;
  if (!capture || !await confirmAction('Delete this capture?', 'This removes it from your cloud library permanently. Any local copy in your extension stays on that device.', 'Delete capture')) return;
  $('#delete-capture').disabled = true;
  try { await api(`/captures/${encodeURIComponent(capture.id)}`, { method: 'DELETE' }); closeDialog('#detail-dialog'); toast('Capture deleted.'); await refreshLibrary(); }
  catch (error) { if (!state.expired) { const message = textElement('p', error.message, 'form-message is-error'); message.setAttribute('role', 'alert'); $('#detail-body').append(message); } }
  finally { $('#delete-capture').disabled = false; }
});

function updateNoteAvailability() {
  const enabled = !state.expired && !!state.account && state.preferences?.capture.note === true;
  $('#new-note').disabled = !enabled;
  $('#new-note').title = enabled ? '' : state.preferences?.capture.note === false ? 'Notes are disabled in extension settings.' : 'Loading extension settings…';
}
function openNote() {
  if (state.expired || !state.account) return;
  if (state.preferences?.capture.note !== true) { toast('Notes are disabled in extension settings.'); return; }
  openDialog('#note-dialog'); $('#note-text').focus();
}
$('#new-note').addEventListener('click', openNote);
$('#note-text').addEventListener('input', () => { state.noteClientId = null; });
$('#note-form').addEventListener('submit', async event => {
  event.preventDefault(); const note = $('#note-text').value.trim();
  if (!note) { setMessage($('#note-error'), 'Write something before saving your note.'); $('#note-text').focus(); return; }
  if ($('#save-note').disabled) return;
  $('#save-note').disabled = true; $('#note-text').disabled = true; $('#save-note').textContent = 'Saving…'; setMessage($('#note-error'), '');
  try {
    state.noteClientId ||= crypto.randomUUID();
    if (state.preferences?.capture.note !== true) throw new Error('Notes are disabled in extension settings.');
    const capturedAt = Date.now();
    const provenance = {
      schemaVersion: 1, captureMethod: 'library-note', pageUrl: null, canonicalUrl: null, pageTitle: null,
      siteName: null, description: null, authors: [], publishedAt: null, modifiedAt: null, language: null,
      leadImageUrl: null, faviconUrl: null, targetUrl: null, headings: [], capturedAt, extractedAt: capturedAt,
      extractorVersion: 1, contentHash: null, extractionStatus: 'complete', extractionError: null,
    };
    await api('/captures', { method: 'POST', body: { clientId: state.noteClientId, type: 'note', noteText: note, capturedAt, provenance, processingOptions: structuredClone(state.preferences.organization) } });
    $('#note-text').value = ''; state.noteClientId = null; closeDialog('#note-dialog'); toast('Note saved to your library.'); await refreshLibrary();
  } catch (error) { if (!state.expired) setMessage($('#note-error'), error.message); }
  finally { $('#save-note').disabled = false; $('#note-text').disabled = false; $('#save-note').textContent = 'Save note'; }
});

function preferenceAt(source, path) {
  return path.split('.').reduce((value, key) => value?.[key], source);
}
function setPreference(source, path, value) {
  const keys = path.split('.'); const last = keys.pop();
  const parent = keys.reduce((object, key) => object[key], source); parent[last] = value;
}
function updateOrderButtons() {
  const rows = [...$('#preference-order').children];
  rows.forEach((row, index) => {
    row.querySelector('[data-order-direction="up"]').disabled = index === 0;
    row.querySelector('[data-order-direction="down"]').disabled = index === rows.length - 1;
  });
}
function renderPreferences() {
  if (!state.preferences) return;
  document.querySelectorAll('[data-preference]').forEach(control => {
    const value = preferenceAt(state.preferences, control.dataset.preference);
    if (control.type === 'checkbox') control.checked = !!value;
    else control.value = String(value);
  });
  const byAction = new Map([...$('#preference-order').children].map(row => [row.dataset.orderAction, row]));
  state.preferences.popup.actionOrder.filter(action => action !== 'bookmark').forEach(action => $('#preference-order').append(byAction.get(action)));
  updateOrderButtons(); updateNoteAvailability(); $('#preference-form').dataset.ready = 'true'; $('#preference-form').inert = false;
}
async function loadPreferences() {
  $('#preference-form').dataset.ready = 'false'; $('#preference-form').inert = true;
  try {
    const result = await api('/preferences');
    if (state.expired) return;
    state.preferences = result.preferences; state.preferenceRevision = result.revision; renderPreferences();
  } catch (error) {
    $('#preference-form').inert = false;
    if (!state.expired) setMessage($('#preference-message'), error.message);
  }
}
$('#preference-order').addEventListener('click', event => {
  const button = event.target.closest('[data-order-direction]'); if (!button) return;
  const row = button.closest('[data-order-action]');
  if (button.dataset.orderDirection === 'up' && row.previousElementSibling) row.previousElementSibling.before(row);
  if (button.dataset.orderDirection === 'down' && row.nextElementSibling) row.nextElementSibling.after(row);
  updateOrderButtons();
});
$('#preference-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!state.preferences || $('#save-preferences').disabled) return;
  const next = structuredClone(state.preferences);
  document.querySelectorAll('[data-preference]').forEach(control => setPreference(next, control.dataset.preference, control.type === 'checkbox' ? control.checked : Number(control.value)));
  next.popup.actionOrder = ['bookmark', ...[...$('#preference-order').children].map(row => row.dataset.orderAction)];
  $('#save-preferences').disabled = true; $('#preference-form').setAttribute('aria-busy', 'true'); setMessage($('#preference-message'), '');
  try {
    const result = await api('/preferences', { method: 'PUT', body: next });
    state.preferences = result.preferences; state.preferenceRevision = result.revision; renderPreferences();
    let refreshed = false;
    if (state.extensionId) refreshed = await extensionMessage({ kind: 'atlas-refresh-preferences', revision: result.revision }, state.extensionId).then(response => response.revision >= result.revision).catch(() => false);
    setMessage($('#preference-message'), refreshed ? 'Saved. Your connected browser has the new settings.' : 'Saved. FoundKeep will use these settings the next time the extension refreshes.', false);
  } catch (error) { if (!state.expired) setMessage($('#preference-message'), error.message); }
  finally { $('#save-preferences').disabled = false; $('#preference-form').removeAttribute('aria-busy'); }
});

$('#open-account').addEventListener('click', async () => {
  if (state.expired || !state.account) return;
  setMessage($('#account-message'), ''); openDialog('#account-dialog');
  try { await Promise.all([refreshAccount(), loadPreferences()]); } catch (error) { if (!state.expired) setMessage($('#account-message'), error.message); }
});
$('#export-account').addEventListener('click', async () => {
  if (!await confirmAction('Export your cloud library?', 'Download a JSON file containing your saved captures, text and images. The file may contain private information. Large libraries can take a moment.', 'Download export')) return;
  $('#export-account').disabled = true; $('#export-account').textContent = 'Preparing export…'; setMessage($('#account-message'), '');
  try { const blob = await api('/account/export', { download: true }); downloadBlob(blob, `foundkeep-export-${new Date().toISOString().slice(0, 10)}.json`); toast('Your export is ready to download.'); }
  catch (error) { if (!state.expired) setMessage($('#account-message'), error.message); }
  finally { $('#export-account').disabled = false; $('#export-account').textContent = 'Export my captures'; }
});
$('#logout').addEventListener('click', async () => {
  if (!await confirmAction('Log out of FoundKeep?', 'This signs out this website. Connected extensions stay connected until you revoke them in account settings.', 'Log out')) return;
  $('#logout').disabled = true;
  try { await api('/auth/logout', { method: 'POST', body: {} }); location.replace('/auth.html?mode=login'); }
  catch (error) { if (!state.expired) setMessage($('#account-message'), error.message); }
  finally { $('#logout').disabled = false; }
});
$('#password-form').addEventListener('submit', async event => {
  event.preventDefault(); if ($('#change-password').disabled || !event.currentTarget.reportValidity()) return;
  if (!await confirmAction('Change your password?', 'Other sessions will be signed out and all connected browsers will need to reconnect. You’ll receive a new recovery code to save.', 'Change password')) return;
  $('#change-password').disabled = true; setMessage($('#password-error'), '');
  try {
    const result = await api('/auth/password', { method: 'POST', body: { currentPassword: $('#current-password').value, password: $('#new-password').value } });
    $('#password-form').reset(); state.recoveryCode = result.recoveryCode;
    $('#password-recovery-code').textContent = state.recoveryCode; $('#password-recovery-saved').checked = false; $('#finish-password-recovery').disabled = true;
    openDialog('#password-recovery-dialog');
    refreshAccount().catch(() => {}); detectExtension();
  } catch (error) { if (!state.expired) setMessage($('#password-error'), error.message); }
  finally { $('#change-password').disabled = false; }
});
$('#password-recovery-dialog').addEventListener('cancel', event => { if (state.recoveryCode) event.preventDefault(); });
$('#download-password-recovery').addEventListener('click', () => recoveryDownload(state.recoveryCode, state.account.email));
$('#password-recovery-saved').addEventListener('change', event => { $('#finish-password-recovery').disabled = !event.target.checked; });
$('#finish-password-recovery').addEventListener('click', () => {
  if (!$('#password-recovery-saved').checked) return;
  state.recoveryCode = ''; $('#password-recovery-code').textContent = ''; closeDialog('#password-recovery-dialog'); toast('Password changed. Reconnect your browsers when you’re ready.');
});
$('#open-delete-account').addEventListener('click', () => {
  $('#delete-account-form').reset(); setMessage($('#delete-account-error'), '');
  const social = state.account?.hasPassword === false;
  $('#delete-password-field').hidden = social; $('#delete-password').required = !social; $('#delete-password').disabled = social;
  $('#delete-account-submit').hidden = social;
  $('#oauth-delete-buttons').hidden = !social;
  if (social) void mountOAuthButtons($('#oauth-delete-buttons'), $('#delete-account-error'), 'delete');
  openDialog('#delete-account-dialog');
});
$('#delete-account-form').addEventListener('submit', async event => {
  event.preventDefault(); if ($('#delete-account-submit').disabled || !event.currentTarget.reportValidity()) return;
  $('#delete-account-submit').disabled = true; setMessage($('#delete-account-error'), '');
  try { await api('/account', { method: 'DELETE', body: { password: $('#delete-password').value } }); location.replace('/auth.html?mode=signup&deleted=1'); }
  catch (error) { if (!state.expired) setMessage($('#delete-account-error'), error.message); }
  finally { $('#delete-account-submit').disabled = false; }
});
window.addEventListener('beforeunload', event => { if (state.recoveryCode || $('#note-text').value.trim()) event.preventDefault(); });
document.addEventListener('keydown', event => {
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !document.querySelector('dialog[open]') && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); $('#search').focus(); }
});
window.addEventListener('online', () => { if (!state.expired) { toast('You’re back online. Refreshing your library.'); refreshLibrary(); } });
window.addEventListener('offline', () => setMessage($('#page-message'), 'You’re offline. Reconnect to load or save cloud captures. Your iPhone app and extension keep pending saves on their devices.'));

async function start() {
  try {
    await refreshAccount(); if (state.expired) return;
    updateNoteAvailability(); $('#onboarding').hidden = !!state.usage.captures && location.hash !== '#devices'; updateOnboarding();
    await Promise.allSettled([loadCaptures(), detectExtension(), loadPreferences()]);
    updateNoteAvailability();
    if (location.hash === '#extension-settings' && !state.expired) {
      openDialog('#account-dialog'); $('#extension-settings').scrollIntoView({ block: 'start' }); $('#extension-settings summary').focus();
    }
  } catch (error) {
    if (!state.expired) showLibraryState('FoundKeep couldn’t open your account.', error.message, { retry: start });
  }
}
start();
// Keep new saves and enrichment visible without interrupting open captures or pagination.
setInterval(async () => {
  if (document.visibilityState !== 'visible' || state.expired || !state.account || document.querySelector('dialog[open]')) return;
  try {
    const count = state.usage.captures, size = state.usage.bytes;
    await refreshAccount();
    if (state.expired) return;
    const changed = state.usage.captures !== count || state.usage.bytes !== size;
    const processing = state.captures.some(capture => ['pending', 'processing'].includes(capture.status));
    if (changed || processing) {
      if (state.captures.length <= 60) await loadCaptures({ silent: true });
      else if (changed) toast('Your library has new changes. Refresh to see the latest captures.');
    }
  } catch { /* Explicit refresh provides retry and connection feedback. */ }
}, 15000);
