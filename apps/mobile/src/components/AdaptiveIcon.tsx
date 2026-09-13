import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { nativeThemeRevision, resolvedThemeColor } from '../appearance/preferences.ts';
import { useMaterial } from './ScenicSurface.tsx';

/** Remount glyph text after Android resolves a new night-mode color resource. */
export function AdaptiveIcon(props: ComponentProps<typeof Ionicons>) {
  const { scheme } = useMaterial();
  return <Ionicons key={nativeThemeRevision(scheme)} {...props} color={resolvedThemeColor(props.color, scheme)} />;
}
