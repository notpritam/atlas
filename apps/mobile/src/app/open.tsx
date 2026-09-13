import { getEnvironment } from '../environment.ts';
import { type Href, router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { parseFoundkeepLink } from '../linking/deepLinks.ts';
import { useSession } from '../session/SessionProvider.tsx';
import { colors } from '../theme.ts';

export default function OpenFoundkeepLink() {
  const params = useLocalSearchParams<{ path?: string | string[] }>();
  const { ready, account, setPendingRoute } = useSession();
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
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper }}><ActivityIndicator color={colors.accent} /></View>;
}
