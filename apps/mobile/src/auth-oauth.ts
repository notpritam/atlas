import { getEnvironment } from './environment.ts';
export const OAUTH_NAMES = { apple: 'Apple', google: 'Google', github: 'GitHub', twitter: 'X' } as const;
export type OAuthProvider = keyof typeof OAUTH_NAMES;
export type OAuthIntent = 'sign-in' | 'delete';
export type PendingOAuth = { flow: string; verifier: string; intent: OAuthIntent; provider: OAuthProvider };
export function isOAuthProvider(value: unknown): value is OAuthProvider {
  return typeof value === 'string' && Object.hasOwn(OAUTH_NAMES, value);
}
export function validAuthorizeUrl(value: string, flow: string) {
  return /^[a-f0-9]{32}$/.test(flow) && value === `${getEnvironment().origin}/api/auth/oauth/authorize/${flow}`;
}
export function parseOAuthReturn(value: string): { flow: string; code: string | null; error: boolean } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== `${getEnvironment().scheme}:` || url.host !== 'oauth' || url.pathname !== '/complete' || url.hash || url.username || url.password) return null;
    const params = url.searchParams;
    for (const key of params.keys()) if (!['flow', 'code', 'error'].includes(key) || params.getAll(key).length !== 1) return null;
    const flow = params.get('flow'), code = params.get('code');
    if (!flow || !/^[a-f0-9]{32}$/.test(flow)) return null;
    if (params.get('error') === 'oauth_failed' && !code) return { flow, code: null, error: true };
    if (params.has('error') || !code || !/^[A-Za-z0-9_-]{43}$/.test(code)) return null;
    return { flow, code, error: false };
  } catch { return null; }
}
export function createPendingOAuth(now = Date.now) {
  let pending: (PendingOAuth & { expires: number }) | null = null;
  let owner: symbol | undefined;
  let returningUntil = 0;
  const expire = () => {
    if (pending && (pending.expires <= now() || (!owner && returningUntil > 0 && returningUntil <= now()))) {
      pending = null; owner = undefined; returningUntil = 0;
    }
  };
  return {
    set(value: PendingOAuth, screen?: symbol) { pending = { ...value, expires: now() + 600_000 }; owner = screen; returningUntil = 0; },
    get(flow: string, screen?: symbol): PendingOAuth | null {
      expire();
      if (!pending || pending.flow !== flow || (screen && owner !== screen)) return null;
      const { expires: _, ...value } = pending;
      return value;
    },
    claim(flow: string, screen: symbol) {
      expire();
      if (!pending || pending.flow !== flow) return null;
      owner = screen;
      returningUntil = 0;
      const { expires: _, ...value } = pending;
      return value;
    },
    markReturn(flow: string) {
      expire();
      if (owner && pending?.flow === flow) returningUntil = now() + 5_000;
    },
    release(screen: symbol) {
      if (owner !== screen) return;
      if (returningUntil > now() && pending) {
        // Navigation has already received a matching callback. Allow its new
        // screen five seconds to claim the proof, even across separate commits.
        owner = undefined;
      } else { pending = null; owner = undefined; }
    },
    clear(screen?: symbol) { if (!screen || owner === screen) { pending = null; owner = undefined; } },
  };
}
// Deliberately memory-only: after a terminated app, start again rather than
// accepting an unsolicited deep link or persisting a sign-in proof on disk.
export const pendingOAuth = createPendingOAuth();
