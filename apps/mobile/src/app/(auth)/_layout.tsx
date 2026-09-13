import { type Href, router, Stack, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAppearance } from '../../appearance/AppearanceProvider.tsx';
import { useMotionAllowed } from '../../components/motion.tsx';
import { useSession } from '../../session/SessionProvider.tsx';
import { palettes } from '../../theme.ts';

export default function AuthLayout() {
  const motion = useMotionAllowed();
  const { ready, account, recoveryCode, consumePendingRoute } = useSession();
  const pathname = usePathname();
  const { scheme } = useAppearance();
  const palette = palettes[scheme];
  const redirecting = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (recoveryCode && pathname !== '/recovery-code') router.replace('/(auth)/recovery-code');
    else if (account && !recoveryCode && pathname !== '/recovery-code' && !redirecting.current) {
      redirecting.current = true;
      router.replace((consumePendingRoute() || '/(app)/(tabs)/collection') as Href);
    }
    if (!account || recoveryCode) redirecting.current = false;
  }, [ready, account, recoveryCode, pathname, consumePendingRoute]);
  if (!ready || (account && !recoveryCode && pathname !== '/recovery-code')) return <View style={{ flex: 1, backgroundColor: palette.paper, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={palette.accent} /></View>;
  return <Stack screenOptions={{ headerShown: false, animation: motion ? 'slide_from_right' : 'fade' }} />;
}
