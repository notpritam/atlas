import { forwardRef } from 'react';
import { StyleSheet, Text as NativeText, type TextProps } from 'react-native';
import { resolvedThemeColor } from '../appearance/preferences.ts';
import { useMaterial } from './ScenicSurface.tsx';

/** Refresh concrete Android palette colors in place. Remount only for Dynamic
 * Type measurement changes, preserving forms, navigation, and drafts. */
export const AdaptiveText = forwardRef<NativeText, TextProps>(function AdaptiveText(props, ref) {
  const { fontScale, scheme } = useMaterial();
  const color = StyleSheet.flatten(props.style)?.color;
  return <NativeText key={fontScale} {...props} style={[props.style, color === undefined ? null : { color: resolvedThemeColor(color, scheme) }]} ref={ref} />;
});
