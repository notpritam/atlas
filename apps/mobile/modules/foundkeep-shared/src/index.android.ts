import * as SecureStore from 'expo-secure-store';
import { File, Directory, Paths } from 'expo-file-system';
import { fetch } from 'expo/fetch';
import { randomUUID } from 'expo-crypto';
import { getEnvironment } from '../../../src/environment.ts';
import { createAndroidRuntime, type AndroidRecord, type Credential } from '../../../src/share/androidRuntime.ts';

const variant = getEnvironment();
const root = new Directory(Paths.document, `foundkeep-${variant.environment}`);
const queue = new Directory(root, 'queue');
const payloads = new Directory(root, 'payloads');
const exportDirectory = new Directory(Paths.cache, `foundkeep-${variant.environment}-exports`);
const key = `${variant.keychainService}.device-session`;
const options = { keychainService: variant.keychainService, keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
function ensure() { for (const directory of [root, queue, payloads, exportDirectory]) directory.create({ intermediates: true, idempotent: true }); }
function recordFile(id: string) { if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid queue ID'); return new File(queue, `${id}.json`); }
function payload(path: string) { if (!/^[a-f0-9-]{36}$/i.test(path)) throw new Error('Invalid payload'); return new File(payloads, path); }
function removeFile(file: File) { if (file.exists) file.delete(); }
function atomic(file: File, value: string) { const temp = new File(file.uri + '.tmp'); temp.write(value); temp.move(file, { overwrite: true }); }
function base64url(value: string) {
  const bytes = new TextEncoder().encode(value); let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
async function request(path: string, token: string, init: RequestInit = {}, seconds = 30) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), seconds*1000);
  try { return await fetch(`${variant.origin}${path}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${token}` }, redirect: 'error', credentials: 'omit', signal: controller.signal }); }
  finally { clearTimeout(timer); }
}
const runtime = createAndroidRuntime({
  async credential() {
    const raw = await SecureStore.getItemAsync(key, options); if (!raw) return null;
    const value = JSON.parse(raw) as Credential;
    if (typeof value.token !== 'string' || !value.token || typeof value.accountId !== 'string' || !value.accountId) throw new Error('Invalid stored session');
    return value;
  },
  async setCredential(value) {
    if (value) await SecureStore.setItemAsync(key, JSON.stringify(value), options);
    else await SecureStore.deleteItemAsync(key, options);
    ensure(); for (const file of exportDirectory.list()) file.delete();
  },
  async records() {
    ensure(); const records: AndroidRecord[] = [];
    for (const file of queue.list()) if (file instanceof File && file.name.endsWith('.json')) {
      try { const record = JSON.parse(await file.text()); if (record.id && record.clientId === record.id && record.metadata && typeof record.ownerAccountId === 'string' && recordFile(record.id).uri === file.uri) records.push(record); } catch {}
    }
    return records;
  },
  async save(record) { ensure(); atomic(recordFile(record.id), JSON.stringify(record)); },
  async remove(record) { removeFile(recordFile(record.id)); if (record.payloadPath) removeFile(payload(record.payloadPath)); },
  async removePayload(path) { removeFile(payload(path)); },
  async copy(uri, id, limit) {
    ensure(); const source = new File(uri); const target = payload(id);
    try {
      if (source.size > limit) throw new Error('This file exceeds the saving limit.');
      source.copy(target);
      if (!target.exists || target.size <= 0 || target.size > limit) throw new Error('This file is empty or exceeds the saving limit.');
      return { path: id, name: (source.name || 'Shared file').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,180), bytes: target.size };
    } catch (error) { removeFile(target); throw error; }
  },
  async policy() { ensure(); const file = new File(root, 'policy.json'); return file.exists ? file.text() : null; },
  async setPolicy(value) { ensure(); atomic(new File(root,'policy.json'), value); },
  async upload(record, token, timeout) {
    const metadata = JSON.stringify({ ...record.metadata, clientId: record.clientId });
    const response = record.payloadPath
      ? await request('/api/mobile/captures/file', token, { method:'POST', headers:{ 'content-type': String(record.metadata.declaredMime || 'application/octet-stream'), 'X-Foundkeep-Capture': base64url(metadata) }, body: payload(record.payloadPath) }, timeout)
      : await request('/api/captures', token, { method:'POST', headers:{ 'content-type':'application/json' }, body: metadata }, timeout);
    let error: string | undefined; try { error = (await response.json()).error; } catch {}
    return { status: response.status, error };
  },
  async download(id, name, token) {
    ensure(); const response = await request(`/api/mobile/captures/${encodeURIComponent(id)}/file`, token);
    if (!response.ok) throw new Error('The original file could not be downloaded.');
    // Stream to private storage to avoid loading large originals into JS memory.
    const file = new File(exportDirectory, `${randomUUID()}-${name}`); file.create(); const handle = file.open();
    try {
      if (!response.body) throw new Error('Empty file response.');
      const reader = response.body.getReader();
      try { while (true) { const {done,value} = await reader.read(); if (done) break; handle.writeBytes(value); } }
      finally { reader.releaseLock(); }
    } catch (error) { handle.close(); removeFile(file); throw error; }
    handle.close(); return file.uri;
  },
  uuid: randomUUID,
});
export const enqueueAndroidShares = runtime.enqueueShares;
export default runtime;
