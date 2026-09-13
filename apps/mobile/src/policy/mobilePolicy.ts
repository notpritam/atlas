import { getEnvironment } from '../environment.ts';
import type { CaptureType } from '../api/types.ts';

const MOBILE_CAPTURE_TYPES = ['bookmark', 'selection', 'note', 'image', 'video', 'audio', 'document', 'file'] as const;
type MobileCaptureType = typeof MOBILE_CAPTURE_TYPES[number];

export type MobilePolicy = {
  schemaVersion: 1;
  revision: number;
  cacheSeconds: number;
  minimumVersion: string;
  features: { notifications: boolean };
  capture: Record<MobileCaptureType, boolean>;
  limits: {
    fileBytes: number;
    textCharacters: number;
    articleCharacters: number;
    batchItems: number;
    uploadTimeoutSeconds: number;
  };
  notice: string | null;
};

export const DEFAULT_MOBILE_POLICY: MobilePolicy = {
  schemaVersion: 1,
  revision: 1,
  cacheSeconds: 300,
  minimumVersion: '1.0.0',
  features: { notifications: true },
  capture: { bookmark: true, selection: true, note: true, image: true, video: true, audio: true, document: true, file: true },
  limits: { fileBytes: 50 * 1024 * 1024, textCharacters: 50_000, articleCharacters: 500_000, batchItems: 20, uploadTimeoutSeconds: 15 },
  notice: null,
};

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: unknown, keys: readonly string[]) => object(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const integer = (value: unknown, min: number, max: number) => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;

export function normalizeMobilePolicy(value: unknown): MobilePolicy | null {
  const rootKeys = ['schemaVersion', 'revision', 'cacheSeconds', 'minimumVersion', 'features', 'capture', 'limits', 'notice'];
  const limitKeys = ['fileBytes', 'textCharacters', 'articleCharacters', 'batchItems', 'uploadTimeoutSeconds'];
  if (!object(value) || !exactKeys(value, rootKeys)) return null;
  const capture = value.capture;
  const features = value.features;
  const limits = value.limits;
  if (value.schemaVersion !== 1 ||
      !integer(value.revision, 1, Number.MAX_SAFE_INTEGER) || !integer(value.cacheSeconds, 60, 3600) ||
      typeof value.minimumVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.minimumVersion) ||
      !object(features) || !exactKeys(features, ['notifications']) || typeof features.notifications !== 'boolean' ||
      !object(capture) || !exactKeys(capture, MOBILE_CAPTURE_TYPES) || MOBILE_CAPTURE_TYPES.some(type => typeof capture[type] !== 'boolean') ||
      !object(limits) || !exactKeys(limits, limitKeys) || !integer(limits.fileBytes, 1024 * 1024, 50 * 1024 * 1024) ||
      !integer(limits.textCharacters, 1000, 100_000) || !integer(limits.articleCharacters, 10_000, 500_000) || !integer(limits.batchItems, 1, 20) ||
      !integer(limits.uploadTimeoutSeconds, 5, 30) ||
      !(value.notice === null || (typeof value.notice === 'string' && value.notice.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value.notice)))) return null;
  return JSON.parse(JSON.stringify(value)) as MobilePolicy;
}

export function isCaptureEnabled(policy: MobilePolicy, type: CaptureType): boolean {
  return MOBILE_CAPTURE_TYPES.includes(type as MobileCaptureType) && policy.capture[type as MobileCaptureType];
}

export function requiresBinaryUpdate(currentVersion: string, minimumVersion: string): boolean {
  const current = currentVersion.split('.').map(Number);
  const minimum = minimumVersion.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((current[index] || 0) !== (minimum[index] || 0)) return (current[index] || 0) < (minimum[index] || 0);
  }
  return false;
}

export async function fetchMobilePolicy(fetcher: typeof fetch = fetch): Promise<MobilePolicy | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetcher(`${getEnvironment().origin}/mobile-policy.json`, { cache: 'no-store', redirect: 'error', signal: controller.signal });
      if (!response.ok) return null;
      return normalizeMobilePolicy(await response.json());
    } finally { clearTimeout(timeout); }
  } catch { return null; }
}
