import { AdaptiveText as Text } from '../../components/AdaptiveText.tsx';
import * as Clipboard from 'expo-clipboard';
import { type Href, Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Brand, Button, Message, Screen } from '../../components/ui.tsx';
import { useSession } from '../../session/SessionProvider.tsx';
import { useThemedStyles } from '../../appearance/AppearanceProvider.tsx';
import { colors, typography } from '../../theme.ts';

export default function RecoveryCode() {
  const { recoveryCode, acknowledgeRecovery, consumePendingRoute } = useSession(); const [copied, setCopied] = useState(false); const [saved, setSaved] = useState(false);
  const styles = useThemedStyles(baseStyles);
  if (!recoveryCode) return <Redirect href="/(app)/(tabs)/collection" />;
  const copy = async () => { await Clipboard.setStringAsync(recoveryCode); setCopied(true); };
  return <Screen><ScrollView contentContainerStyle={styles.page}><Brand compact /><View style={styles.heading}><Text style={typography.label}>One-time recovery code</Text><Text style={typography.title}>Keep this somewhere safe.</Text><Text style={typography.body}>Foundkeep cannot show this code again. You need it if you forget your password.</Text></View><View accessible accessibilityLabel={`Recovery code ${recoveryCode}`} style={styles.code}><Text selectable style={styles.codeText}>{recoveryCode}</Text></View><Message>{copied ? 'Copied to the clipboard.' : 'A password manager is a good place for it.'}</Message><View style={styles.actions}><Button label="Copy recovery code" secondary onPress={copy} /><Button label={saved ? 'Continue to Foundkeep' : 'I saved the code'} onPress={() => { if (!saved) { setSaved(true); return; } acknowledgeRecovery(); router.replace((consumePendingRoute() || '/(app)/onboarding') as Href); }} /></View></ScrollView></Screen>;
}
const baseStyles = StyleSheet.create({ page: { flexGrow: 1, padding: 24, gap: 28 }, heading: { marginTop: 24, gap: 12 }, code: { padding: 18, borderWidth: 1, borderColor: colors.accent, borderRadius: 20, backgroundColor: colors.surface }, codeText: { color: colors.ink, fontSize: 17, lineHeight: 26, fontFamily: 'monospace' }, actions: { marginTop: 'auto', gap: 12 } });
