import { forwardRef } from 'react';
import { TextInput as NativeTextInput, type TextInputProps } from 'react-native';
import { palettes } from '../theme.ts';
import { useMaterial } from './ScenicSurface.tsx';

/** Send concrete colors when the scheme changes without remounting the field. */
export const AdaptiveTextInput = forwardRef<NativeTextInput, TextInputProps>(function AdaptiveTextInput(props, ref) {
  const { scheme } = useMaterial();
  const palette = palettes[scheme];
  return <NativeTextInput {...props} ref={ref} style={[props.style, { color: palette.ink }]}
    placeholderTextColor={palette.muted} selectionColor={palette.accent} cursorColor={palette.accent} />;
});
