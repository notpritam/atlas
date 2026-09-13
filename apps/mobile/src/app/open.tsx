import { getEnvironment } from '../environment.ts';
import { type Href, router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAppearance } from '../appearance/AppearanceProvider.tsx';
import { parseFoundkeepLink } from '../linking/deepLinks.ts';
import { useSession } from '../session/SessionProvider.tsx';
import { palettes } from '../theme.ts';

export default function OpenFoundkeepLink() {
  const params = useLocalSearchParams<{ path?: string | string[] }>();
  const { ready, account, setPendingRoute } = useSession();
  const { scheme } = useAppearance();
  const palette = palettes[scheme];
  useEffect(() => {
    if (!ready) return;
    const path = Array.isArray(params.path) ? null : params.path;
    const target = path ? parseFoundkeepLink(`${getEnvironment().origin}/open?path=${encodeURIComponent(path)}`) : null;
    if (!target) { router.replace('/'); return; }
    if (target.requiresAuth && !account) {
      setPendingRoute(target.href);
      router.replace('/(auth)/sign-in');
      return;
    }
    router.replace((!target.requiresAuth && account ? '/(app)/(tabs)/collection' : target.href) as Href);
  }, [account, params.path, ready, setPendingRoute]);
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.paper }}><ActivityIndicator color={palette.accent} /></View>;
}
