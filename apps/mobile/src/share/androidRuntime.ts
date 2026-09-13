import { nextAttemptAt } from './queue.ts';
import { DEFAULT_MOBILE_POLICY, normalizeMobilePolicy, requiresBinaryUpdate, type MobilePolicy } from '../policy/mobilePolicy.ts';
export type Credential = { token: string; accountId: string };
export type AndroidShare = { value: string; shareType: 'text' | 'url' | 'image' | 'video' | 'audio' | 'file'; mimeType?: string };
export type AndroidRecord = { id: string; clientId: string; ownerAccountId: string; metadata: Record<string, unknown>; payloadPath: string | null; createdAt: number; nextAttemptAt: number; attempts: number; requiresOrganizationReview?: boolean; organizationReviewReason?: string };
export type AndroidStorage = {
  credential(): Promise<Credential | null>; setCredential(value: Credential | null): Promise<void>;
  records(): Promise<AndroidRecord[]>; save(record: AndroidRecord): Promise<void>; remove(record: AndroidRecord): Promise<void>;
  copy(uri: string, id: string, limit: number): Promise<{ path: string; name: string; bytes: number }>; removePayload(path: string): Promise<void>;
  policy(): Promise<string | null>; setPolicy(value: string): Promise<void>;
  upload(record: AndroidRecord, token: string, timeoutSeconds: number): Promise<{ status: number; error?: string }>;
  download(id: string, name: string, token: string): Promise<string>;
  uuid(): string;
};
export function shareMetadata(share: AndroidShare, policy: MobilePolicy): Record<string, unknown> {
  if (!share.value || typeof share.value !== 'string') throw new Error('The shared item is empty.');
  let type: string = share.shareType;
  let sourceUrl: string | undefined;
  if (type === 'url' || type === 'text') {
    try {
      const url = new URL(share.value.trim());
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.href.length <= 8192) sourceUrl = url.href;
    } catch {}
    if (type === 'url' && !sourceUrl) throw new Error('Only public HTTP or HTTPS links can be saved.');
    type = sourceUrl ? 'bookmark' : 'selection';
    if (!sourceUrl && share.value.length > policy.limits.textCharacters) throw new Error('The shared text exceeds the saving limit.');
  } else {
    if (!['image', 'video', 'audio', 'file'].includes(type) || !/^(content|file):\/\//.test(share.value)) throw new Error('This shared file cannot be read safely.');
    if (share.mimeType === 'application/pdf') type = 'document';
  }
  if (!policy.capture[type as keyof MobilePolicy['capture']]) throw new Error('Saving this content type is currently unavailable.');
  return { type, ...(sourceUrl ? { sourceUrl } : type === 'selection' ? { selectionText: share.value } : {}), folderId: null, userTags: [] };
}
/** All credential/queue mutations are serialized, including uploads. A delayed
 * refresh cannot resurrect logout, and a queued record never borrows a new token. */
export function createAndroidRuntime(storage: AndroidStorage) {
  let tail: Promise<unknown> = Promise.resolve();
  function serial<T>(work: () => Promise<T>): Promise<T> { const result = tail.then(work); tail = result.catch(() => {}); return result; }
  const accountId = (json: string) => { const id = JSON.parse(json)?.id; if (typeof id !== 'string' || !id.trim()) throw new Error('Invalid account.'); return id; };
  const policy = async () => { try { return normalizeMobilePolicy(JSON.parse(await storage.policy() || 'null')) || DEFAULT_MOBILE_POLICY; } catch { return DEFAULT_MOBILE_POLICY; } };
  const owned = async () => { const credential = await storage.credential(); return credential ? (await storage.records()).filter(record => record.ownerAccountId === credential.accountId) : []; };
  return {
    setSession: (token: string, json: string) => serial(async () => { if (!token.trim()) throw new Error('Invalid session.'); await storage.setCredential({ token, accountId: accountId(json) }); }),
    refreshSession: (token: string, json: string) => serial(async () => { const current = await storage.credential(); if (current?.token !== token) return; if (current.accountId !== accountId(json)) throw new Error('Account binding mismatch.'); }),
    getToken: () => serial(async () => (await storage.credential())?.token || null),
    clearSession: () => serial(() => storage.setCredential(null)),
    getPolicy: () => serial(() => storage.policy()),
    setPolicy: (json: string) => serial(async () => { if (!normalizeMobilePolicy(JSON.parse(json))) throw new Error('Invalid mobile policy.'); await storage.setPolicy(json); }),
    pendingCount: () => serial(async () => (await owned()).length),
    blockedPendingCount: () => serial(async () => (await owned()).filter(record => record.requiresOrganizationReview).length),
    resolveBlockedPendingToUnfiled: () => serial(async () => {
      let count = 0;
      for (const record of await owned()) if (record.requiresOrganizationReview && record.organizationReviewReason === 'folder_not_found') {
        await storage.save({ ...record, metadata: { ...record.metadata, folderId: null }, requiresOrganizationReview: false, organizationReviewReason: undefined, nextAttemptAt: 0 }); count++;
      }
      return count;
    }),
    enqueueShares: (shares: AndroidShare[], expectedAccountId: string) => serial(async () => {
      const current = await storage.credential(); if (!current) throw new Error('Sign in to save these shared items.');
      if (current.accountId !== expectedAccountId) throw new Error('Your account changed. Share the items again.');
      const limits = await policy();
      if (requiresBinaryUpdate('1.0.0', limits.minimumVersion)) throw new Error('Update Foundkeep before saving.');
      if (!shares.length || shares.length > limits.limits.batchItems) throw new Error(`Share up to ${limits.limits.batchItems} items at a time.`);
      const prepared: AndroidRecord[] = [];
      const copied: string[] = [];
      const batchId = storage.uuid();
      try {
        for (const share of shares) {
          const metadata = shareMetadata(share, limits); const id = storage.uuid(); const now = Date.now();
          let payloadPath: string | null = null;
          if (!['bookmark', 'selection'].includes(String(metadata.type))) {
            const file = await storage.copy(share.value, id, limits.limits.fileBytes); payloadPath = file.path; copied.push(file.path);
            Object.assign(metadata, { fileName: file.name, declaredMime: share.mimeType || 'application/octet-stream' });
          }
          Object.assign(metadata, { clientId: id, batchId, capturedAt: now });
          prepared.push({ id, clientId: id, ownerAccountId: current.accountId, metadata, payloadPath, createdAt: now, nextAttemptAt: 0, attempts: 0 });
        }
        for (const record of prepared) await storage.save(record);
        return prepared.length;
      } catch (error) {
        for (const record of prepared) await storage.remove(record).catch(() => {});
        for (const path of copied) await storage.removePayload(path).catch(() => {});
        throw error;
      }
    }),
    retryPending: () => serial(async () => {
      const current = await storage.credential(); if (!current) return 0;
      const limits = await policy(); if (requiresBinaryUpdate('1.0.0', limits.minimumVersion)) return 0;
      let completed = 0;
      for (const record of (await storage.records()).sort((a,b) => a.createdAt-b.createdAt)) {
        if (!record.ownerAccountId || record.ownerAccountId !== current.accountId || record.requiresOrganizationReview || record.nextAttemptAt > Date.now()) continue;
        try {
          const response = await storage.upload(record, current.token, limits.limits.uploadTimeoutSeconds);
          if (response.status === 404 && response.error === 'folder_not_found') { await storage.save({ ...record, requiresOrganizationReview: true, organizationReviewReason: 'folder_not_found' }); continue; }
          if (response.status < 200 || response.status >= 300) throw new Error('Upload failed.');
          await storage.remove(record); completed++;
        } catch {
          await storage.save({ ...record, attempts: record.attempts+1, nextAttemptAt: nextAttemptAt(record.attempts+1) });
        }
      }
      return completed;
    }),
    downloadCaptureFile: (id: string, name: string) => serial(async () => {
      if (!/^[A-Za-z0-9-]{1,80}$/.test(id)) throw new Error('Invalid capture ID.');
      const current = await storage.credential(); if (!current) throw new Error('Sign in to download this file.');
      const safeName = (name.split(/[\\/]/).pop() || 'Shared file').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0,180) || 'Shared file';
      return storage.download(id, safeName, current.token);
    }),
  };
}
