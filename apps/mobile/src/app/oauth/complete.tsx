import { getEnvironment } from '../../environment.ts';
import { AdaptiveText as Text } from '../../components/AdaptiveText.tsx';
import * as Crypto from 'expo-crypto';
import { router, Stack, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, ScrollView } from 'react-native';
import { createFoundkeepClient, FoundkeepApiError } from '../../api/client.ts';
import { isOAuthProvider, OAUTH_NAMES, parseOAuthReturn, pendingOAuth, validAuthorizeUrl, type PendingOAuth } from '../../auth-oauth.ts';
import { FrostedPanel } from '../../components/ScenicSurface.tsx';
import { Brand, Button, Field, Message, Screen } from '../../components/ui.tsx';
import { useSession } from '../../session/SessionProvider.tsx';
import { typography } from '../../theme.ts';

type Handoff = { flow: string; code: string; pending: PendingOAuth };
export default function OAuthComplete() {
  const params = useLocalSearchParams();
  const session = useSession();
  const latest = useRef(session); latest.current = session;
  const started = useRef(false), handled = useRef(''), canceled = useRef(false);
  const owner = useRef(Symbol('oauth-screen')).current;
  useFocusEffect(useCallback(() => {
    canceled.current = false;
    return () => {
      canceled.current = true;
      // The URL entry point marks an expected provider return before Router
      // navigates. Ordinary back/blur clears ownership immediately.
      pendingOAuth.release(owner);
    };
  }, [owner]));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Opening secure sign-in…');
  const [error, setError] = useState('');
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [proof, setProof] = useState<string | null>(null);
  const [deletingIntent, setDeletingIntent] = useState(params.intent === 'delete');

  async function exchange(value: Handoff, existingPassword?: string) {
    setBusy(true); setError(''); setMessage('Finishing your sign-in…');
    try {
      if (!pendingOAuth.get(value.flow, owner)) throw new Error('Sign-in expired. Please start again.');
      const result = await latest.current.client.exchangeOAuth({ flow: value.flow, code: value.code, verifier: value.pending.verifier, ...(existingPassword ? { password: existingPassword } : {}) }, value.pending.intent);
      if (canceled.current || !pendingOAuth.get(value.flow, owner)) {
        // An abandoned handoff must not leave an unused live device connection.
        if ('token' in result) await createFoundkeepClient({ getToken: async () => result.token }).logout().catch(() => {});
        return;
      }
      setPassword(''); setNeedsPassword(false);
      if (value.pending.intent === 'delete' && 'reauthToken' in result) {
        pendingOAuth.clear(owner); setProof(result.reauthToken);
        setMessage('Identity verified. Deleting your account will permanently remove your cloud collection and connections. This cannot be undone.');
      } else if (value.pending.intent === 'sign-in' && 'token' in result) {
        await latest.current.acceptOAuthSession(result);
        router.replace((latest.current.consumePendingRoute() || '/(app)/(tabs)/collection') as Href);
      } else throw new Error('Sign-in could not be completed. Please start again.');
    } catch (value) {
      if (canceled.current) return;
      setMessage(''); setError((value as Error).message);
      if (value instanceof FoundkeepApiError && ['account_link_required', 'invalid_credentials'].includes(value.code)) setNeedsPassword(true);
      else pendingOAuth.clear(owner);
    } finally { setBusy(false); }
  }

  const serialized = JSON.stringify(params);
  useEffect(() => {
    if (!session.ready) return;
    const values = JSON.parse(serialized) as Record<string, string | string[]>;
    if (typeof values.flow === 'string') {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(values)) for (const part of Array.isArray(value) ? value : [value]) query.append(key, part);
      const returned = parseOAuthReturn(`${getEnvironment().scheme}://oauth/complete?` + query);
      if (!returned || returned.error) {
        pendingOAuth.clear(); setMessage(''); setError('Sign-in was canceled or could not be verified. Please start again.'); return;
      }
      if (handled.current === returned.flow) return;
      handled.current = returned.flow;
      const pending = pendingOAuth.claim(returned.flow, owner);
      if (!pending) { setMessage(''); setError('This sign-in expired or the app restarted. Please start again.'); return; }
      const value = { flow: returned.flow, code: returned.code!, pending };
      setDeletingIntent(pending.intent === 'delete'); setHandoff(value);
      void exchange(value); return;
    }
    if (started.current) return;
    started.current = true;
    const provider = values.provider;
    if (!isOAuthProvider(provider) || !['sign-in', 'delete'].includes(String(values.intent))) {
      setMessage(''); setError('Choose a sign-in method to continue.'); return;
    }
    const intent = values.intent === 'delete' ? 'delete' : 'sign-in';
    setBusy(true);
    void (async () => {
      try {
        pendingOAuth.clear();
        const verifier = Array.from(await Crypto.getRandomBytesAsync(32), byte => byte.toString(16).padStart(2, '0')).join('');
        const codeChallenge = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const result = await latest.current.client.startOAuth({ provider, intent, codeChallenge });
        if (!validAuthorizeUrl(result.authorizeUrl, result.flow)) throw new Error('Sign-in could not be started. Try again.');
        if (canceled.current) return;
        pendingOAuth.set({ flow: result.flow, verifier, provider, intent }, owner);
        setMessage(`Continue with ${OAUTH_NAMES[provider]} in your browser. You’ll return here automatically.`);
        await Linking.openURL(result.authorizeUrl);
      } catch (value) { pendingOAuth.clear(owner); if (!canceled.current) { setMessage(''); setError((value as Error).message); } }
      finally { setBusy(false); }
    })();
  }, [serialized, session.ready]);

  const cancel = () => {
    canceled.current = true; pendingOAuth.clear(owner); setPassword(''); setProof(null);
    router.replace(deletingIntent && session.account ? '/(app)/(tabs)/settings' : '/(auth)/sign-in');
  };
  const remove = async () => {
    if (!proof || busy) return;
    setBusy(true); setError('');
    try { await session.deleteAccount({ reauthToken: proof }); setProof(null); router.replace('/(auth)/sign-in'); }
    catch (value) { setError((value as Error).message); }
    finally { setBusy(false); }
  };
  return <Screen keyboard><Stack.Screen options={{ gestureEnabled: !busy }} /><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, padding: 24, gap: 24 }}><Brand compact /><Text style={typography.title}>{deletingIntent ? 'Verify your account.' : 'Your collection awaits.'}</Text><Message>{message}</Message><Message error>{error}</Message>{needsPassword ? <FrostedPanel><Text style={typography.body}>Connect this sign-in method to your existing FoundKeep collection using its current password.</Text><Field label="FoundKeep password" value={password} onChangeText={setPassword} textContentType="password" secureTextEntry autoCapitalize="none" /><Button label="Connect to my existing collection" loading={busy} disabled={!password} onPress={() => { if (handoff && !busy) void exchange(handoff, password); }} /></FrostedPanel> : null}{proof ? <Button label="Delete account permanently" danger loading={busy} onPress={() => void remove()} /> : null}<Button label={deletingIntent ? 'Keep my account' : 'Back to sign in'} secondary disabled={busy} onPress={cancel} /></ScrollView></Screen>;
}
