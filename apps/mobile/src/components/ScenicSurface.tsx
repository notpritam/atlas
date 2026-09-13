import { useAppearance } from '../appearance/AppearanceProvider.tsx';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, useWindowDimensions, View, type ViewProps, type ViewStyle } from 'react-native';
import { colors, palettes } from '../theme.ts';

const MaterialContext = createContext({ opaque: true, scheme: 'light' as 'light' | 'dark', fontScale: 1 });

/** One accessibility subscription for all materials, never one blur per card. */
export function MaterialProvider({ children }: { children: ReactNode }) {
  const { fontScale } = useWindowDimensions();
  const { scheme } = useAppearance();
  const [transparency, setTransparency] = useState(true);
  const [contrast, setContrast] = useState(false);
  useEffect(() => {
    let active = true;
    if (Platform.OS === 'web') {
      const reduced = window.matchMedia('(prefers-reduced-transparency: reduce)');
      const increased = window.matchMedia('(prefers-contrast: more)');
      const update = () => { setTransparency(reduced.matches); setContrast(increased.matches); };
      update(); reduced.addEventListener('change', update); increased.addEventListener('change', update);
      return () => { reduced.removeEventListener('change', update); increased.removeEventListener('change', update); };
    }
    if (Platform.OS !== 'ios') return;
    void AccessibilityInfo.isReduceTransparencyEnabled().then(value => { if (active) setTransparency(value); }).catch(() => {});
    void AccessibilityInfo.isDarkerSystemColorsEnabled().then(value => { if (active) setContrast(value); }).catch(() => {});
    const reduced = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setTransparency);
    const increased = AccessibilityInfo.addEventListener('darkerSystemColorsChanged', setContrast);
    return () => { active = false; reduced.remove(); increased.remove(); };
  }, []);
  const value = useMemo(() => ({ opaque: transparency || contrast, scheme, fontScale }), [transparency, contrast, scheme, fontScale]);
  return <MaterialContext.Provider value={value}>
    {Platform.OS === 'web' ? <style>{`:root{color-scheme:${scheme};${webPalette(scheme)}}`}</style> : null}
    {children}
  </MaterialContext.Provider>;
}
export const useMaterial = () => useContext(MaterialContext);
const webPalette = (scheme: 'light' | 'dark') => Object.entries(palettes[scheme]).map(([name, color]) => `--foundkeep-${name}:${color}`).join(';');

/** Liquid Glass on compatible iOS; frosted web preview and solid fallbacks. */
export function GlassSurface({ children, style, interactive = false, ...props }: ViewProps & { interactive?: boolean }) {
  const { opaque, scheme } = useMaterial();
  const native = Platform.OS === 'ios' && !opaque && isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
  const Surface = native ? GlassView : View;
  const webFrost = Platform.OS === 'web' && !opaque ? { backdropFilter: 'blur(20px) saturate(140%)', WebkitBackdropFilter: 'blur(20px) saturate(140%)' } as ViewStyle : undefined;
  return <Surface {...props} {...(native ? { glassEffectStyle: 'regular' as const, colorScheme: scheme, tintColor: palettes[scheme].surface, isInteractive: interactive } : {})}
    style={[styles.material, !native && { backgroundColor: opaque ? colors.surface : colors.glass }, webFrost, style, opaque && { backgroundColor: colors.surface, borderColor: colors.line }]}>{children}</Surface>;
}

export function FrostedPanel({ children, style, ...props }: ViewProps) {
  const { opaque } = useMaterial();
  return <View {...props} style={[styles.panel, { backgroundColor: opaque ? colors.surface : colors.glassCard, borderColor: opaque ? colors.line : colors.glassEdge }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  material: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.glassEdge, borderRadius: 24, borderCurve: 'continuous', shadowColor: colors.shadow, shadowOffset: { width: 0, height: 5 }, shadowOpacity: .09, shadowRadius: 18, elevation: 3 },
  panel: { borderWidth: 1, borderColor: colors.glassEdge, borderRadius: 22, borderCurve: 'continuous', padding: 20, gap: 14 },
});
