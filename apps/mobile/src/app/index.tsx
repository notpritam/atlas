import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAppearance } from '../appearance/AppearanceProvider.tsx';
import { useSession } from '../session/SessionProvider.tsx';
import { palettes } from '../theme.ts';

export default function Index() {
  const { ready, account, recoveryCode } = useSession();
  const { scheme } = useAppearance();
  const palette = palettes[scheme];
  if (!ready) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.paper }}><ActivityIndicator color={palette.accent} /></View>;
  if (recoveryCode) return <Redirect href="/(auth)/recovery-code" />;
  return <Redirect href={account ? '/(app)/(tabs)/collection' : '/(auth)/sign-in'} />;
}
