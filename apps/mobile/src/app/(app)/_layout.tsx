import { BillingProvider } from '../../billing/BillingProvider.tsx';
import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useSession } from '../../session/SessionProvider.tsx';
import { useMotionAllowed } from '../../components/motion.tsx';
import { useAppearance } from '../../appearance/AppearanceProvider.tsx';
import { palettes } from '../../theme.ts';

export const unstable_settings = { initialRouteName: '(tabs)' };
export default function AppLayout() {
  const { ready, account } = useSession();
  const motion = useMotionAllowed();
  const { scheme } = useAppearance();
  const palette = palettes[scheme];
  if (!ready) return <View style={{ flex: 1, backgroundColor: palette.paper, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={palette.accent} /></View>;
  if (!account) return <Redirect href="/(auth)/sign-in" />;
  return <BillingProvider><Stack screenOptions={{ headerStyle: { backgroundColor: palette.paper }, headerTintColor: palette.accent, headerTitleStyle: { color: palette.ink, fontSize: 17, fontWeight: '600' }, headerShadowVisible: false, contentStyle: { backgroundColor: palette.paper }, animation: motion ? 'default' : 'fade', headerBackButtonDisplayMode: 'minimal' }}>
    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    <Stack.Screen name="capture/[id]" options={{ title: 'Saved item' }} />
    <Stack.Screen name="batch/[id]" options={{ title: 'Saved together' }} />
    <Stack.Screen name="new-note" options={{ title: 'New note', presentation: 'modal' }} />
    <Stack.Screen name="onboarding" options={{ title: 'Save from anywhere', presentation: 'modal' }} />
    <Stack.Screen name="subscription" options={{ title: 'Your plan' }} />
  </Stack></BillingProvider>;
}
