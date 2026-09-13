import { DynamicColorIOS, Platform, PlatformColor, StyleSheet, type ColorValue } from 'react-native';

import paletteValues from './palettes.json' with { type: 'json' };
const { light, dark } = paletteValues;
export const palettes = paletteValues;
export const colors = Object.fromEntries(Object.entries(light).map(([key, value]) => [key,
  Platform.OS === 'ios' ? DynamicColorIOS({ light: value, dark: dark[key as keyof typeof light] })
     : Platform.OS === 'android' ? PlatformColor(`@color/foundkeep_${key.toLowerCase()}`)
    // RN Web cannot compose shadowOpacity with a CSS variable color.
    : Platform.OS === 'web' && key !== 'shadow' ? `var(--foundkeep-${key}, ${value})` : value,
])) as Record<keyof typeof light, ColorValue>;

export const typography = StyleSheet.create({
  display: { color: colors.ink, fontSize: 40, lineHeight: 44, fontWeight: '600', letterSpacing: -1.5 },
  title: { color: colors.ink, fontSize: 32, lineHeight: 37, fontWeight: '600', letterSpacing: -0.8 },
  heading: { color: colors.ink, fontSize: 20, lineHeight: 25, fontWeight: '600', letterSpacing: -0.3 },
  body: { color: colors.ink, fontSize: 16, lineHeight: 23 },
  small: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  label: { color: colors.muted, fontSize: 11, lineHeight: 15, fontWeight: '700', letterSpacing: 1.1, textTransform: 'uppercase' },
});
