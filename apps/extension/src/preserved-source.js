// Private files use the fixed, account-bound background API. Object URLs exist
// only for the open item and are revoked on navigation or account changes.
export function bindPreservedSource(root, api) {
  let generation = 0, timer, captureId, busy = false;
  const objectUrls = new Set(), cards = new Map();
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function reset() {
    generation++; clearTimeout(timer); captureId = null; busy = false;
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear(); cards.clear(); root.replaceChildren(); root.hidden = true;
  }
  async function show(save) {
    reset();
    if (!save?.sourceUrl || !/^https?:\/\/(?:www\.|mobile\.|m\.)?(?:x|twitter)\.com\/(?:\w+|i\/web)\/status\/\d+/.test(save.sourceUrl)) return;
    root.hidden = false; captureId = save.id;
    const version = generation;
    const heading = element('h3', 'Loading source files…');
    const status = element('p', '', 'muted'); status.setAttribute('role', 'status');
    const retry = element('button', 'Save source files', 'btn'); retry.type = 'button'; retry.hidden = true;
    const assets = element('div'); root.append(heading, status, retry, assets);
    retry.onclick = async () => {
      retry.disabled = true;
      try { await api('retry-preservation', { id: captureId }); if (version === generation) await poll(); }
      catch (error) { if (version === generation) status.textContent = error.message; }
      finally { if (version === generation) retry.disabled = false; }
    };
    async function load(asset, card, button) {
      if (busy) { status.textContent = 'Wait for the current file to finish loading.'; return; }
      busy = true; button.disabled = true;
      try {
        let offset = 0, total = asset.bytes, mime = asset.mime; const parts = [];
        if (!Number.isSafeInteger(total) || total <= 0 || total > 50 * 1024 * 1024) throw Error('This file cannot be opened in the sidebar.');
        while (offset < total) {
          button.textContent = `Loading ${Math.floor(offset / total * 100)}%…`;
          const chunk = await api('asset-chunk', { id: save.id, asset: asset.id, offset });
          if (version !== generation) return;
          if (!chunk.bytes || chunk.total !== total || chunk.mime !== mime || offset + chunk.bytes > total) throw Error('The saved file changed. Open it again.');
          const bytes = Uint8Array.from(atob(chunk.base64), c => c.charCodeAt(0));
          if (bytes.length !== chunk.bytes) throw Error('The file could not be read.');
          parts.push(bytes); offset += bytes.length;
        }
        if (version !== generation) return;
        const url = URL.createObjectURL(new Blob(parts, { type: mime })); objectUrls.add(url);
        const media = element(asset.kind === 'video' ? 'video' : 'img');
        media.src = url;
        if (asset.kind === 'video') { media.controls = true; media.preload = 'metadata'; }
        else media.alt = asset.title;
        card.prepend(media);
        const download = element('a', 'Download file', 'btn');
        download.href = url; download.download = asset.title;
        button.replaceWith(download);
      } catch (error) {
        if (version === generation) { status.textContent = error.message; button.disabled = false; button.textContent = 'Try loading again'; }
      } finally { if (version === generation) busy = false; }
    }
    async function poll() {
      clearTimeout(timer);
      try {
        const { preservation } = await api('preservation', { id: save.id });
        if (version !== generation) return;
        const working = ['pending', 'running'].includes(preservation?.status);
        heading.textContent = working ? 'Saving source files…' : preservation?.status === 'ready' ? 'Source saved' : preservation ? 'Some source files are unavailable' : 'Keep a server copy';
        status.textContent = preservation?.error || (working ? 'Your post is safe. Available attachments are being copied to your private library.' : 'Saved copies stay private and count toward your storage.');
        retry.hidden = working || preservation?.status === 'ready'; retry.textContent = preservation ? 'Retry remaining files' : 'Save source files';
        for (const asset of preservation?.assets || []) {
          if (cards.has(asset.id)) continue;
          const card = element('section', '', 'preserved-file'); cards.set(asset.id, card);
          card.append(element('strong', asset.title));
          card.append(element('small', `${(asset.bytes / (asset.bytes >= 1048576 ? 1048576 : 1024)).toFixed(1)} ${asset.bytes >= 1048576 ? 'MiB' : 'KiB'}`));
          if (asset.text) {
            const details = element('details'); details.append(element('summary', asset.kind === 'article' ? 'Read saved article' : 'Read archived post'), element('p', asset.text, 'saved-content'));
            card.append(details);
            const url = URL.createObjectURL(new Blob([asset.text], { type: 'text/plain' })); objectUrls.add(url);
            const download = element('a', 'Download text', 'btn'); download.href = url; download.download = asset.title + '.txt'; card.append(download);
          } else {
            const open = element('button', asset.kind === 'video' ? 'Load saved video' : 'Load saved photo', 'btn'); open.type = 'button';
            open.onclick = () => void load(asset, card, open); card.append(open);
          }
          assets.append(card);
        }
        if (working) timer = setTimeout(poll, 3000);
      } catch (error) { if (version === generation) { status.textContent = error.message; retry.hidden = false; } }
    }
    await poll();
  }
  return { show, reset };
}
