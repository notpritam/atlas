// Shared rules for the save-review UI and its trusted background commit.
export const STARTER_TAGS = ['Read later', 'Inspiration', 'Work', 'Personal'];
export function normalizeSaveTags(values, maxTags = 20) {
  if (!Array.isArray(values) || values.length > maxTags) throw new Error(`Choose up to ${maxTags} tags.`);
  const tags = new Map();
  for (const value of values) {
    if (typeof value !== 'string') throw new Error('Tags must be text.');
    const name = value.trim().replace(/^#/, '').trim().normalize('NFC');
    if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Use 1–40 characters per tag, without line breaks.');
    if (!tags.has(name.toLowerCase())) tags.set(name.toLowerCase(), name);
  }
  return [...tags.values()];
}
export function normalizeSaveDetails(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['sourceTitle', 'noteText', 'userTags', 'folderId'].includes(key))) throw new Error('Invalid save details.');
  const details = {};
  for (const [key, max, label] of [['sourceTitle', 1000, 'Title'], ['noteText', 50000, 'Note']]) {
    if (!(key in value)) continue;
    if (typeof value[key] !== 'string' || value[key].length > max) throw new Error(`${label} must be ${max.toLocaleString()} characters or fewer.`);
    details[key] = value[key].trim() || null;
  }
  if ('userTags' in value) details.userTags = normalizeSaveTags(value.userTags);
  if ('folderId' in value) {
    if (value.folderId !== null && (typeof value.folderId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value.folderId))) throw new Error('Choose a valid folder.');
    details.folderId = value.folderId;
  }
  return details;
}

export function bindSaveTags(root, changed, { maxTags = 20 } = {}) {
  let selected = [], available = STARTER_TAGS;
  root.innerHTML = '<div class="save-tag-selected"></div><div class="save-tag-entry"><input type="text" maxlength="820" autocomplete="off" placeholder="Add a tag…"><button class="btn secondary" type="button">Add</button></div><div class="save-tag-suggestions"></div><p class="fine save-tag-error" role="status"></p>';
  const input = root.querySelector('input'), button = root.querySelector('button'), error = root.querySelector('.save-tag-error');
  input.setAttribute('aria-label', root.dataset.label || 'Add a tag');
  function render() {
    const holder = root.querySelector('.save-tag-selected'); holder.replaceChildren();
    for (const name of selected) {
      const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'save-tag-chip selected';
      chip.textContent = name + ' ×'; chip.setAttribute('aria-label', 'Remove tag ' + name);
      chip.onclick = () => { selected = selected.filter(value => value !== name); render(); changed(); }; holder.append(chip);
    }
    holder.hidden = !selected.length;
    const suggestions = root.querySelector('.save-tag-suggestions'); suggestions.replaceChildren();
    const seen = new Set(selected.map(name => name.toLowerCase()));
    const search = input.value.trim().replace(/^#/, '').toLowerCase();
    for (const name of available) {
      const key = name.toLowerCase(); if (seen.has(key) || !key.includes(search)) continue; seen.add(key);
      const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'save-tag-chip'; chip.textContent = '+ ' + name;
      chip.setAttribute('aria-label', 'Add tag ' + name); chip.onclick = () => add(name); suggestions.append(chip);
      if (suggestions.children.length >= 8) break;
    }
  }
  function add(value = input.value) {
    try { selected = normalizeSaveTags([...selected, ...value.split(',').map(tag => tag.trim()).filter(Boolean)], maxTags); input.value = ''; error.textContent = ''; render(); changed(); return true; }
    catch (value) { error.textContent = value.message; input.focus(); return false; }
  }
  button.onclick = () => add();
  input.oninput = () => { error.textContent = ''; render(); changed(); };
  input.onkeydown = event => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); add(); } };
  render();
  return {
    get: () => selected.slice(), pending: () => input.value, flush: () => add(),
    set(tags = [], pending = '') { selected = normalizeSaveTags(tags); input.value = pending; error.textContent = ''; render(); },
    suggest(names) { available = [...names, ...STARTER_TAGS]; render(); },
  };
}
