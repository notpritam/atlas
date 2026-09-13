import { getEnvironment } from '../environment.ts';
export type FoundkeepLink = { href: string; requiresAuth: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const protectedRoutes = new Map<string, string>([
  ['collection', '/(app)/(tabs)/collection'],
  ['settings', '/(app)/(tabs)/settings'],
  ['new-note', '/(app)/new-note'],
]);
const publicRoutes = new Map<string, string>([
  ['login', '/(auth)/sign-in'],
  ['register', '/(auth)/register'],
  ['recover', '/(auth)/recover'],
]);

function resolvePath(raw: string): FoundkeepLink | null {
  const path = raw.replace(/^\/+|\/+$/g, '');
  const publicHref = publicRoutes.get(path);
  if (publicHref) return { href: publicHref, requiresAuth: false };
  const protectedHref = protectedRoutes.get(path || 'collection');
  if (protectedHref) return { href: protectedHref, requiresAuth: true };
  const capture = /^capture\/([^/]+)$/.exec(path);
  if (capture && UUID.test(capture[1]!)) {
    return { href: `/(app)/capture/${capture[1]!.toLowerCase()}`, requiresAuth: true };
  }
  return null;
}

/** Parse only Foundkeep-owned, data-free navigation links. Credentials and
 * arbitrary URLs are never accepted as destinations. */
export function parseFoundkeepLink(raw: string): FoundkeepLink | null {
  if (!raw || raw.length > 512) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.username || url.password || url.hash) return null;
  if (url.protocol === `${getEnvironment().scheme}:`) {
    if (url.search) return null;
    return resolvePath([url.hostname, url.pathname].map(value => value.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/'));
  }
  if (url.protocol !== 'https:' || url.origin !== getEnvironment().origin || url.port || !['/open', '/open.html'].includes(url.pathname)) return null;
  if ([...url.searchParams.keys()].some(key => key !== 'path')) return null;
  const path = url.searchParams.get('path');
  return path ? resolvePath(path) : null;
}

/** Validate an internal destination before carrying it through authentication. */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 160) return null;
  const destination = protectedRoutes.get(raw.replace(/^\/\(app\)\/(?:\(tabs\)\/)?/, ''));
  if (destination && raw.startsWith('/(app)/')) return destination;
  const capture = /^\/\(app\)\/capture\/([^/]+)$/.exec(raw);
  return capture && UUID.test(capture[1]!) ? `/(app)/capture/${capture[1]!.toLowerCase()}` : null;
}
