import { parseOAuthReturn, pendingOAuth } from '../auth-oauth.ts';
import { parseFoundkeepLink } from '../linking/deepLinks.ts';
// Expo invokes this before routing untrusted external URLs. Incoming Android
// share intents open the collection; their payload is read by IncomingShares.
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  const returned = parseOAuthReturn(path);
  if (returned) { pendingOAuth.markReturn(returned.flow); return path; }
  const destination = parseFoundkeepLink(path);
  return destination?.href || '/';
}
