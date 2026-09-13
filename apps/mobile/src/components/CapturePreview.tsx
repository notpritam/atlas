import { AdaptiveText as Text } from './AdaptiveText.tsx';
import { AdaptiveIcon as Ionicons } from './AdaptiveIcon.tsx';
import { useMemo, useRef, useEffect, useState } from 'react';
import { Animated, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Shimmer } from './Shimmer.tsx';
import { useMotionAllowed } from './motion.tsx';
import type { Capture } from '../api/types.ts';
import { capturePreviewSource } from '../collection/preview.ts';
import { useSession } from '../session/SessionProvider.tsx';
import { colors } from '../theme.ts';

export const captureIcons = { bookmark: 'link-outline', image: 'image-outline', screenshot: 'scan-outline', document: 'document-text-outline', file: 'document-outline', note: 'create-outline', selection: 'text-outline', audio: 'musical-notes-outline', video: 'videocam-outline', tweet: 'chatbubble-outline' } as const;
export const captureLabels = { bookmark: 'Link', image: 'Image', screenshot: 'Screenshot', document: 'Document', file: 'File', note: 'Note', selection: 'Highlight', audio: 'Audio', video: 'Video', tweet: 'Post' } as const;

export function CapturePreview({ capture, style, contain = false, compact = false }: { capture: Capture; style?: StyleProp<ViewStyle>; contain?: boolean; compact?: boolean }) {
  const { token, account } = useSession();
  const source = useMemo(() => capturePreviewSource(capture, token, account?.id), [capture, token, account?.id]);
  const key = source?.uri || '';
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const motion = useMotionAllowed();
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => { opacity.setValue(0); }, [key, opacity]);
  useEffect(() => {
    const animation = Animated.timing(opacity, { toValue: loadedKey === key ? 1 : 0, duration: motion ? 180 : 0, useNativeDriver: Platform.OS !== 'web', isInteraction: false });
    animation.start(); return () => animation.stop();
  }, [key, loadedKey, motion, opacity]);
  const failed = failedKey === key;
  const loaded = loadedKey === key;
  return <View style={[styles.preview, style]}>
    {source && !failed ? <>
      <Animated.Image key={key} source={source} style={[StyleSheet.absoluteFill, { opacity }]} resizeMode={contain ? 'contain' : 'cover'} resizeMethod="resize" onLoad={() => setLoadedKey(key)} onError={() => setFailedKey(key)} accessible={false} />
      {!loaded ? <Shimmer style={StyleSheet.absoluteFill} /> : null}
    </> : <View style={styles.fallback}><Ionicons name={captureIcons[capture.type]} size={compact ? 22 : 32} color={colors.accent} />{compact ? null : <Text style={styles.label}>{failed ? 'Preview unavailable' : capture.fileMime?.split('/')[1]?.toUpperCase() || captureLabels[capture.type]}</Text>}</View>}
  </View>;
}
const styles = StyleSheet.create({ preview: { backgroundColor: colors.accentSoft, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', aspectRatio: 1.25 }, fallback: { padding: 12, gap: 10, alignItems: 'center' }, label: { color: colors.muted, fontSize: 12, textAlign: 'center' } });
