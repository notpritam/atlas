import { getEnvironment } from '../../../src/environment.ts';
const scoped = (key: string) => getEnvironment().environment === 'dev' ? `dev-${key}` : key;
type NativeFoundkeepShared = {
  setSession(token: string, accountJson: string): Promise<void>;
  refreshSession(token: string, accountJson: string): Promise<void>;
  getToken(): Promise<string | null>;
  clearSession(): Promise<void>;
  pendingCount(): Promise<number>;
  blockedPendingCount(): Promise<number>;
  resolveBlockedPendingToUnfiled(): Promise<number>;
  retryPending(): Promise<number>;
  downloadCaptureFile(captureId: string, fileName: string): Promise<string>;
  getPolicy(): Promise<string | null>;
  setPolicy(policyJson: string): Promise<void>;
};

const storage = () => typeof localStorage === 'undefined' ? null : localStorage;
const FoundkeepShared: NativeFoundkeepShared = {
  async setSession(token, accountJson) { storage()?.setItem(scoped('foundkeep-device-token'), token); storage()?.setItem(scoped('foundkeep-account'), accountJson); },
  async refreshSession(token, accountJson) { if (storage()?.getItem(scoped('foundkeep-device-token')) === token) storage()?.setItem(scoped('foundkeep-account'), accountJson); },
  async getToken() { return storage()?.getItem(scoped('foundkeep-device-token')) || null; },
  async clearSession() { storage()?.removeItem(scoped('foundkeep-device-token')); storage()?.removeItem(scoped('foundkeep-account')); },
  async pendingCount() { return 0; },
  async blockedPendingCount() { return 0; },
  async resolveBlockedPendingToUnfiled() { return 0; },
  async retryPending() { return 0; },
  async downloadCaptureFile() { throw new Error('Open files in the Foundkeep mobile app.'); },
  async getPolicy() { return storage()?.getItem(scoped('foundkeep-mobile-policy')) || null; },
  async setPolicy(policyJson) { storage()?.setItem(scoped('foundkeep-mobile-policy'), policyJson); },
};

export default FoundkeepShared;
