import { AdaptiveIcon as Ionicons } from './AdaptiveIcon.tsx';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { isOAuthProvider, OAUTH_NAMES, type OAuthIntent, type OAuthProvider } from '../auth-oauth.ts';
import { useSession } from '../session/SessionProvider.tsx';
import { colors } from '../theme.ts';
import { Button, Message } from './ui.tsx';

export function OAuthButtons({ intent = 'sign-in' }: { intent?: OAuthIntent }) {
  const { client } = useSession();
  const [providers, setProviders] = useState<OAuthProvider[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let live = true;
    void client.oauthProviders().then(value => {
      if (live && Array.isArray(value.providers)) setProviders(value.providers.filter(isOAuthProvider));
    }).catch(() => {}).finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [client]);
  if (!providers.length) return intent === 'delete' && loaded ? <Message error>Identity verification is temporarily unavailable. Try again shortly, or visit foundkeep.app/support.</Message> : null;
  return <View style={{ gap: 10 }}>{providers.map(provider => <Button key={provider} secondary={provider !== 'apple'} icon={<Ionicons name={provider === 'apple' ? 'logo-apple' : provider === 'google' ? 'logo-google' : provider === 'github' ? 'logo-github' : 'globe-outline'} size={20} color={provider === 'apple' ? colors.paper : colors.ink} />} label={`${intent === 'delete' ? 'Verify' : 'Continue'} with ${OAUTH_NAMES[provider]}`} onPress={() => router.push({ pathname: '/oauth/complete', params: { provider, intent } })} />)}</View>;
}
