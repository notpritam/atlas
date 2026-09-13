import { AdaptiveText as Text } from './AdaptiveText.tsx';
import type { ReactNode } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, type TextInputProps, View } from 'react-native';
import { AdaptiveTextInput as TextInput } from './AdaptiveTextInput.tsx';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, palettes, typography } from '../theme.ts';
import { useAppearance, useThemedStyles } from '../appearance/AppearanceProvider.tsx';

export function Screen({ children, keyboard = false, top = true, bottom = false }: { children: ReactNode; keyboard?: boolean; top?: boolean; bottom?: boolean }) {
  const styles = useThemedStyles(baseStyles);
  const content = <SafeAreaView edges={[...(top ? ['top' as const] : []), 'left', 'right', ...(bottom ? ['bottom' as const] : [])]} style={styles.fill}>{children}</SafeAreaView>;
  return <View style={styles.screen}>{keyboard ? <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>{content}</KeyboardAvoidingView> : content}</View>;
}

export function Mark({ size = 38 }: { size?: number }) {
  return <Image source={require('../../assets/images/mark.png')} accessible={false} style={{ width: size, height: size, borderRadius: size * .22 }} />;
}

export function Brand({ compact = false, inverse = false }: { compact?: boolean; inverse?: boolean }) {
  const styles = useThemedStyles(baseStyles);
  return <View style={styles.brand}><Mark size={compact ? 28 : 40} /><Text maxFontSizeMultiplier={1.5} style={[styles.brandName, compact && { fontSize: 19 }, inverse && { color: colors.white }]}>Foundkeep</Text></View>;
}

export function LegalFooter() {
  const styles = useThemedStyles(baseStyles);
  return <Text style={styles.legal}>By continuing, you accept our <Text accessibilityRole="link" style={styles.legalLink} onPress={() => void Linking.openURL('https://foundkeep.app/terms')}>Terms</Text> and <Text accessibilityRole="link" style={styles.legalLink} onPress={() => void Linking.openURL('https://foundkeep.app/privacy')}>Privacy</Text>.</Text>;
}

export function Button({ label, onPress, loading = false, disabled = false, secondary = false, danger = false, icon }: { label: string; onPress: () => void; loading?: boolean; disabled?: boolean; secondary?: boolean; danger?: boolean; icon?: ReactNode }) {
  const styles = useThemedStyles(baseStyles);
  const palette = palettes[useAppearance().scheme];
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled || loading} onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.buttonSecondary, danger && styles.buttonDanger, pressed && styles.buttonPressed, (disabled || loading) && styles.buttonDisabled]}>{loading ? <ActivityIndicator color={secondary && !danger ? palette.ink : danger ? palette.onError : palette.paper} /> : <View style={styles.buttonContent}>{icon ? <View style={styles.buttonIcon}>{icon}</View> : null}<Text style={[styles.buttonText, Boolean(icon) && styles.buttonIconText, secondary && !danger && styles.buttonTextSecondary, danger && { color: colors.onError }]}>{label}</Text>{icon ? <View style={styles.buttonIcon} /> : null}</View>}</Pressable>;
}

export function Field({ label, help, ...props }: TextInputProps & { label: string; help?: string }) {
  const styles = useThemedStyles(baseStyles);
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput {...props} testID={props.testID || `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} style={[styles.input, props.multiline && styles.multiline, props.style]} placeholderTextColor={colors.muted} selectionColor={colors.accent} accessibilityLabel={label} />{help ? <Text style={typography.small}>{help}</Text> : null}</View>;
}

export function Message({ children, error = false }: { children?: ReactNode; error?: boolean }) {
  const styles = useThemedStyles(baseStyles);
  if (!children) return null;
  return <View accessibilityRole={error ? 'alert' : undefined} style={[styles.message, error && styles.messageError]}><Text style={[typography.small, error && { color: colors.error }]}>{children}</Text></View>;
}

const baseStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  fill: { flex: 1 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandName: { color: colors.ink, fontSize: 28, fontWeight: '700', letterSpacing: -1 },
  legal: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', paddingHorizontal: 10, paddingVertical: 12 },
  legalLink: { color: colors.ink, textDecorationLine: 'underline' },
  fieldLabel: { color: colors.ink, fontSize: 14, fontWeight: '500' },
  button: { minHeight: 52, borderRadius: 13, paddingHorizontal: 20, paddingVertical: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink },
  buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  buttonDanger: { backgroundColor: colors.error },
  buttonPressed: { opacity: .78 },
  buttonDisabled: { opacity: .46 },
  buttonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%' },
  buttonIcon: { width: 20, alignItems: 'center' },
  buttonIconText: { flex: 1 },
  buttonText: { color: colors.paper, fontSize: 15, fontWeight: '600', flexShrink: 1, textAlign: 'center' },
  buttonTextSecondary: { color: colors.ink },
  field: { gap: 7 },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: colors.surface, paddingHorizontal: 14, color: colors.ink, fontSize: 17 },
  multiline: { minHeight: 130, paddingTop: 14, textAlignVertical: 'top' },
  message: { padding: 12, borderRadius: 14, backgroundColor: colors.accentSoft },
  messageError: { backgroundColor: colors.errorSurface },
});
