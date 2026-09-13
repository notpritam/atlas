import { AppearanceProvider, useAppearance } from '../appearance/AppearanceProvider.tsx';
import { IncomingShares } from '../share/IncomingShares';
import { MotionProvider } from '../components/motion.tsx';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider } from '../session/SessionProvider.tsx';
import { palettes } from '../theme.ts';
import { NavigationController } from '../linking/NavigationController.tsx';
import { MaterialProvider } from '../components/ScenicSurface.tsx';

export default function RootLayout() { return <AppearanceProvider><ThemedRoot /></AppearanceProvider>; }
function ThemedRoot() {
  const { scheme } = useAppearance();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const palette = palettes[scheme];
  const theme = { ...base, colors: { ...base.colors, primary: palette.accent, background: palette.paper, card: palette.paper, text: palette.ink, border: palette.line, notification: palette.accent } };
  return <ThemeProvider value={theme}><SessionProvider><MotionProvider><MaterialProvider><StatusBar style="auto" /><NavigationController /><IncomingShares /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.paper }, animation: 'fade' }} /></MaterialProvider></MotionProvider></SessionProvider></ThemeProvider>;
}
