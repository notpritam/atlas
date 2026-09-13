import { AdaptiveText as Text } from '../../components/AdaptiveText.tsx';
import { AdaptiveIcon as Ionicons } from '../../components/AdaptiveIcon.tsx';
import { router } from 'expo-router';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Brand, Button, Screen } from '../../components/ui.tsx';
import { useSession } from '../../session/SessionProvider.tsx';
import { useThemedStyles } from '../../appearance/AppearanceProvider.tsx';
import { colors, typography } from '../../theme.ts';
const steps = [
  { icon: 'share-outline', title: 'Find something to keep', body: 'In your browser, photos, files, or another app, tap Share.' },
  { icon: 'bookmark-outline', title: 'Choose Foundkeep', body: Platform.OS === 'android' ? 'Select Foundkeep from the Android share menu. Tap More if it is not visible.' : 'Swipe along the app row and tap More if you don’t see it. Add Foundkeep to your favorites for next time.' },
  { icon: 'checkmark-outline', title: 'Save it to your collection', body: Platform.OS === 'android' ? 'Foundkeep opens and saves the shared items to your collection. Sign in first if prompted. Files wait safely on your device while offline.' : 'Add a note if you like, then tap Save. Everything appears here with its source attached.' },
] as const;
export default function ShareGuide() {
  const { policy, updateRequired } = useSession();
  const styles = useThemedStyles(baseStyles);
  return <Screen top={false}><ScrollView contentContainerStyle={styles.page}><Brand compact /><View style={styles.heading}><Text style={typography.title}>Keep a good find.{`\n`}In a few taps.</Text><Text style={[typography.body, { color: colors.muted }]}>Save straight from the app you’re using.</Text></View>{steps.map((step, index) => <View key={step.title} style={styles.step}><View style={styles.icon}><Ionicons name={step.icon} size={23} color={colors.accent} /></View><View style={styles.copy}><Text style={styles.stepTitle}>{index + 1}. {step.title}</Text><Text style={typography.body}>{step.body}</Text></View></View>)}<View style={styles.actions}><Button label="Got it" onPress={() => router.dismissTo('/(app)/(tabs)/collection')} />{policy.capture.note && !updateRequired ? <Button label="Try writing a note" secondary onPress={() => router.replace('/(app)/new-note')} /> : null}</View></ScrollView></Screen>;
}
const baseStyles = StyleSheet.create({ page: { padding: 24, paddingBottom: 48, gap: 18 }, heading: { gap: 12, paddingTop: 10 }, step: { flexDirection: 'row', alignItems: 'flex-start', gap: 15, paddingVertical: 22, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, icon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }, copy: { flex: 1, gap: 6 }, stepTitle: { color: colors.ink, fontSize: 17, fontWeight: '600' }, actions: { gap: 12, marginTop: 8 } });
