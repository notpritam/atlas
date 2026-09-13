import { Tabs } from 'expo-router';
import { DockProvider, FloatingDock } from '../../../components/FloatingDock.tsx';
import { useAppearance } from '../../../appearance/AppearanceProvider.tsx';
import { palettes } from '../../../theme.ts';
export default function CollectionTabs() {
  const { scheme } = useAppearance();
  return <DockProvider><Tabs tabBar={props => <FloatingDock {...props} />} screenOptions={{ headerShown: false, tabBarStyle: { position: 'absolute' }, sceneStyle: { backgroundColor: palettes[scheme].paper } }}>
    <Tabs.Screen name="collection" options={{ title: 'Gallery' }} />
    <Tabs.Screen name="settings" options={{ title: 'You' }} />
  </Tabs></DockProvider>;
}
