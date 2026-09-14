import { captureBinding, libraryRequest } from './cloud.js';
import { saveCapture } from './capture.js';
import { getCapture } from './db.js';

const key = windowId => 'foundkeep-save-review-' + windowId;
const locks = new Map();
const changed = () => chrome.runtime.sendMessage({ kind: 'foundkeep-save-review-changed' }).catch(() => {});
async function exclusive(windowId, run) {
  const previous = locks.get(windowId) || Promise.resolve();
  const next = previous.catch(() => {}).then(run); locks.set(windowId, next);
  try { return await next; } finally { if (locks.get(windowId) === next) locks.delete(windowId); }
}
export async function readSaveReview(windowId) {
  const draft = (await chrome.storage.session.get(key(windowId)))[key(windowId)];
  return draft && Date.now() - draft.createdAt < 30 * 60_000 ? draft : null;
}
export async function stageSaveReview(request) {
  return exclusive(request.tab.windowId, async () => {
    const current = await readSaveReview(request.tab.windowId);
    if (current) {
      changed();
      if (current.action === 'tweet' && request.action === 'tweet' && current.tweet.url === request.tweet.url) return current;
      throw new Error('Finish or cancel the current save in the sidebar first.');
    }
    const binding = await captureBinding();
    const draft = { ...request, id: 'cap_' + crypto.randomUUID(), accountId: binding.cloudAccountId, createdAt: Date.now() };
    await chrome.storage.session.set({ [key(request.tab.windowId)]: draft }); changed();
    return draft;
  });
}
export async function cancelSaveReview(windowId, id) {
  return exclusive(windowId, async () => {
    const draft = await readSaveReview(windowId);
    if (!draft || draft.id !== id) return;
    await chrome.storage.session.remove(key(windowId)); changed();
    if (draft.action === 'tweet') chrome.tabs.sendMessage(draft.tab.id, { kind: 'foundkeep-tweet-result', url: draft.tweet.url, cancelled: true }).catch(() => {});
  });
}
export async function confirmSaveReview({ windowId, id, choice }, capture) {
  return exclusive(windowId, async () => {
    const draft = await readSaveReview(windowId);
    if (!draft || draft.id !== id) throw new Error('This save has expired. Start it again.');
    const binding = await captureBinding();
    if (binding.cloudAccountId !== draft.accountId) throw new Error('Your connected account changed. Cancel this review and start again.');
    if (!choice || !['local','library','folder','collection'].includes(choice.kind)) throw new Error('Choose where to save this.');
    if (choice.kind !== 'local' && !draft.accountId) throw new Error('Sign in to save to your account, or choose this browser.');
    const destination = { kind: choice.kind, reviewAccountId: draft.accountId };
    if (choice.kind === 'folder') {
      const result = await libraryRequest('organization', {}, draft.accountId);
      if (!result.folders?.some(folder => folder.id === choice.id)) throw new Error('That folder is no longer available. Choose another destination.');
      destination.folderId = choice.id;
    }
    if (choice.kind === 'collection') {
      const result = await libraryRequest('collections', {}, draft.accountId);
      const collection = result.collections?.find(item => item.id === choice.id && item.canSubmit);
      if (!collection || collection.visibility !== choice.visibility) throw new Error('This collection changed. Refresh the destinations and review it again.');
      const entry = choice.entry;
      if (!entry || typeof entry.title !== 'string' || !entry.title.trim() || entry.title.length > 200 || typeof entry.body !== 'string' || entry.body.length > 5000)
        throw new Error('Add a title and use up to 5,000 characters for the collection text.');
      const url = entry.url ? new URL(entry.url) : null;
      if (url && (!['http:','https:'].includes(url.protocol) || url.href.length > 2048)) throw new Error('Use a valid source link.');
      destination.collection = { id: collection.id, visibility: collection.visibility, title: collection.title,
        entry: { title: entry.title.trim(), body: entry.body.trim(), url: url?.href || '', tags: [], shareImage: entry.shareImage === true && ['region','fullpage','save-image'].includes(draft.action) } };
    }
    const existing = await getCapture(draft.id);
    if (existing && (existing.cloudAccountId !== (choice.kind === 'local' ? null : draft.accountId)
      || (existing.folderId || null) !== (destination.folderId || null)
      || (existing.collectionSubmission?.id || null) !== (destination.collection?.id || null)))
      throw new Error('This save was already confirmed with another destination. Cancel this review and check Local saves.');
    // A worker restart after commit can safely acknowledge the original save.
    const record = existing || await capture(draft, input => saveCapture(input, { destination, id: draft.id }));
    await chrome.storage.session.remove(key(windowId)); changed();
    if (draft.action === 'tweet') chrome.tabs.sendMessage(draft.tab.id, { kind: 'foundkeep-tweet-result', url: draft.tweet.url, cancelled: !record }).catch(() => {});
    return record;
  });
}
