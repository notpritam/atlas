import { getEnvironment } from '../environment.ts';
import type { Capture } from '../api/types.ts';

type PreviewSource = { uri: string; headers?: Record<string, string> };
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']);

export function capturePreviewSource(capture: Partial<Capture>, token: string | null, accountId: string | undefined): PreviewSource | null {
  const kind = capture.blobUrl ? 'blob' : capture.fileUrl && IMAGE_MIMES.has(capture.fileMime || '') ? 'file' : capture.previewUrl ? 'preview' : null;
  if (kind) {
    if (!token || !accountId || !capture.id) return null;
    const query = new URLSearchParams({ account: accountId, v: String(capture.updatedAt || 0) });
    // Never trust a returned URL with a bearer header. Construct the exact owned
    // endpoint, with a non-secret account/revision key for native image caches.
    return { uri: `${getEnvironment().origin}/api/mobile/captures/${encodeURIComponent(capture.id)}/${kind}?${query}`, headers: { Authorization: `Bearer ${token}` } };
  }
  const raw = capture.provenance?.leadImageUrl;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.hostname === 'localhost' || url.hostname.endsWith('.local') || !url.hostname.includes('.') ||
      /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) return null;
    return { uri: url.href }; // Remote website images receive no account token.
  } catch { return null; }
}

export function galleryColumns(width: number, fontScale: number): 1 | 2 {
  return width < 340 || fontScale >= 1.3 ? 1 : 2;
}
