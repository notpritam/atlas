import { AdaptiveText as Text } from './AdaptiveText.tsx';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AdaptiveIcon as Ionicons } from './AdaptiveIcon.tsx';
import { OAuthButtons } from './OAuthButtons.tsx';
import { colors } from '../theme.ts';

/** Providers come first; email remains available even when provider discovery fails. */
export function AuthOptions({ children }: { children: ReactNode }) {
  const [emailOpen, setEmailOpen] = useState(false);
  return <View style={styles.options}>
    <OAuthButtons />
    <Pressable accessibilityRole="button" accessibilityLabel="Continue with email" accessibilityState={{ expanded: emailOpen }} aria-expanded={emailOpen} onPress={() => setEmailOpen(value => !value)} style={({ pressed }) => [styles.email, pressed && { opacity: .7 }]}>
      <Ionicons name="mail-outline" size={20} color={colors.ink} />
      <Text style={styles.label}>Continue with email</Text>
      <Ionicons name={emailOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.muted} />
    </Pressable>
    {emailOpen ? <View style={styles.fields}>{children}</View> : null}
  </View>;
}
const styles = StyleSheet.create({
  options: { gap: 10 },
  email: { minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, gap: 12, borderRadius: 13, borderWidth: 1, borderColor: colors.line },
  label: { flex: 1, color: colors.ink, fontSize: 15, fontWeight: '600' },
  fields: { paddingTop: 12, gap: 16 },
});
