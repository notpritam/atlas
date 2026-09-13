/** Shared, dependency-free presentation rules for the web and native libraries. */
export type SavedVia = 'iphone' | 'android' | 'browser' | 'dashboard';
type OriginCapture = {
  sourceUrl?: string | null; savedVia?: SavedVia | null;
  provenance?: { captureMethod?: string; sourceApplication?: string | null; pageUrl?: string | null; canonicalUrl?: string | null; targetUrl?: string | null } | null;
};
const platforms: [string[], string][] = [
  [['youtube.com', 'youtu.be'], 'YouTube'], [['instagram.com'], 'Instagram'], [['twitter.com', 'x.com'], 'X'],
  [['tiktok.com'], 'TikTok'], [['reddit.com', 'redd.it'], 'Reddit'], [['pinterest.com', 'pin.it'], 'Pinterest'],
  [['linkedin.com'], 'LinkedIn'], [['github.com'], 'GitHub'], [['medium.com'], 'Medium'], [['substack.com'], 'Substack'],
  [['wikipedia.org'], 'Wikipedia'], [['spotify.com'], 'Spotify'], [['apple.com'], 'Apple'],
];
export function savedVia(capture: OriginCapture): SavedVia | null {
  const method = capture.provenance?.captureMethod || '';
  if (method.startsWith('android-')) return 'android';
  if (method.startsWith('ios-')) return 'iphone';
  if (method === 'library-note') return 'dashboard';
  if (/^(popup-|keyboard-|context-|extension-|twitter-action)/.test(method)) return 'browser';
  if (capture.savedVia && ['iphone', 'android', 'browser', 'dashboard'].includes(capture.savedVia)) return capture.savedVia;
  return null;
}
export const savedViaLabels: Record<SavedVia, string> = { iphone: 'iPhone', android: 'Android', browser: 'Browser extension', dashboard: 'Web dashboard' };
export function sourcePlatform(capture: OriginCapture): string | null {
  for (const raw of [capture.sourceUrl, capture.provenance?.targetUrl, capture.provenance?.canonicalUrl, capture.provenance?.pageUrl]) {
    try {
      const url = new URL(raw || '');
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
      const domain = url.hostname.replace(/^www\./, '');
      return platforms.find(([domains]) => domains.some(host => domain === host || domain.endsWith(`.${host}`)))?.[1] || domain;
    } catch {}
  }
  const app = capture.provenance?.sourceApplication?.toLowerCase();
  return app === 'com.apple.mobileslideshow' ? 'Photos' : app === 'com.apple.documentsapp' ? 'Files' : null;
}
export type DatedSave = { id: string; createdAt?: number | string; capturedAt: number | string };
export function savedTimestamp(capture: DatedSave): number {
  const value = capture.createdAt ?? capture.capturedAt;
  const timestamp = typeof value === 'number' ? value : new Date(value).valueOf();
  return Number.isFinite(timestamp) ? timestamp : 0;
}
export function compareRecent(a: DatedSave, b: DatedSave) {
  return savedTimestamp(b) - savedTimestamp(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}
export function savedAge(capture: DatedSave, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - savedTimestamp(capture)) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d ago`;
  return new Date(savedTimestamp(capture)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
export function mergeRecentPage<T extends DatedSave>(previous: T[], incoming: T[], preserveOlder: boolean): T[] {
  const oldest = incoming.at(-1);
  const items = new Map((preserveOlder && oldest ? previous.filter(item => compareRecent(item, oldest) > 0) : []).map(item => [item.id, item]));
  for (const item of incoming) items.set(item.id, item);
  return [...items.values()].sort(compareRecent);
}
export function previewRatio(width?: number | null, height?: number | null): number {
  return width && height && width > 0 && height > 0 ? Math.max(.6, Math.min(2, width / height)) : 1.4;
}

/** Shortest-column placement keeps chronological DOM/native order and fixed gaps. */
export function masonryLayout(heights: number[], width: number, columns: number, gap: number) {
  const count = Math.max(1, Math.floor(columns));
  const itemWidth = Math.max(1, (width - gap * (count - 1)) / count);
  const bottoms = Array<number>(count).fill(0);
  const items = heights.map(height => {
    const column = bottoms.indexOf(Math.min(...bottoms));
    const top = bottoms[column]!;
    const size = Math.max(1, height);
    bottoms[column] = top + size + gap;
    return { top, left: column * (itemWidth + gap), width: itemWidth, height: size, column };
  });
  return { items, height: heights.length ? Math.max(...bottoms) - gap : 0, itemWidth };
}
