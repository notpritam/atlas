import { AdaptiveText as Text } from './AdaptiveText.tsx';
import { AdaptiveIcon as Ionicons } from './AdaptiveIcon.tsx';
import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { Capture } from '../api/types.ts';
import { captureTitle } from '../collection/model.ts';
import { CapturePreview, captureIcons, captureLabels } from './CapturePreview.tsx';
import { colors, palettes } from '../theme.ts';
import { useThemedStyles } from '../appearance/AppearanceProvider.tsx';
import { previewRatio, savedAge, savedVia, savedViaLabels, sourcePlatform } from '../../../../packages/shared/src/collection-presentation.ts';
import { useMaterial } from './ScenicSurface.tsx';

export const GalleryCard = memo(function GalleryCard({ capture, onOpen }: { capture: Capture; onOpen: (capture: Capture) => void }) {
  const { opaque, scheme } = useMaterial();
  const styles = useThemedStyles(baseStyles);
  const palette = palettes[scheme];
  const written = capture.type === 'note' || capture.type === 'selection';
  const excerpt = capture.noteText || capture.selectionText || capture.summary || capture.articleText;
  const source = sourcePlatform(capture) || (written ? 'Foundkeep' : captureLabels[capture.type]);
  const via = savedVia(capture);
  const pending = capture.status === 'pending' || capture.status === 'processing';
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${captureLabels[capture.type]} ${captureTitle(capture)}`} accessibilityHint={pending ? 'Saved. Details are being prepared.' : undefined} onPress={() => onOpen(capture)} style={({ pressed }) => [styles.card, { backgroundColor: opaque ? palette.surface : palette.glassCard }, written && styles.written, pressed && styles.pressed]}>
    {!written ? <CapturePreview capture={capture} style={[styles.preview, { aspectRatio: previewRatio(capture.width, capture.height) }]} /> : null}
    <View style={[styles.copy, !written && styles.caption, !written && { backgroundColor: opaque ? palette.surface : palette.glassCard }, opaque && { borderColor: palette.line }]}>
      <View style={styles.source}><Ionicons name={captureIcons[capture.type]} size={13} color={colors.muted} /><Text style={styles.sourceText} numberOfLines={1}>{source}</Text></View>
      <Text style={styles.title} numberOfLines={4}>{captureTitle(capture)}</Text>
      {written && excerpt && excerpt !== captureTitle(capture) ? <Text style={styles.excerpt} numberOfLines={6}>{excerpt}</Text> : null}
      {capture.folder ? <View style={styles.state}><Ionicons name="folder-outline" size={12} color={colors.accent} /><Text style={styles.sourceText} numberOfLines={1}>{capture.folder.name}</Text></View> : null}
      {capture.userTags?.length ? <Text style={styles.sourceText} numberOfLines={2}>{capture.userTags.slice(0, 2).map(tag => `#${tag}`).join('  ')}{capture.userTags.length > 2 ? ` +${capture.userTags.length - 2}` : ''}</Text> : null}
      <Text style={styles.saved} numberOfLines={2}>{via ? `${savedViaLabels[via]} · ` : ''}{savedAge(capture)}</Text>
      {capture.batchId ? <View style={styles.state}><Ionicons name="layers-outline" size={12} color={colors.muted} /><Text style={styles.sourceText}>Saved together</Text></View> : null}
      {pending ? <View style={styles.state}><Ionicons name="time-outline" size={12} color={colors.pending} /><Text style={[styles.stateText, { color: colors.pending }]}>Preparing details</Text></View> : capture.status === 'failed' ? <Text style={styles.stateText}>Saved · details unavailable</Text> : null}
    </View>
  </Pressable>;
});
const baseStyles = StyleSheet.create({
  card: { width: '100%', borderRadius: 20, borderCurve: 'continuous', borderWidth: 1, borderColor: colors.glassEdge, backgroundColor: colors.surface, overflow: 'hidden', padding: 5 },
  written: { backgroundColor: colors.note }, pressed: { opacity: .84, transform: [{ scale: .985 }] }, copy: { padding: 12, gap: 8 },
  preview: { borderRadius: 15 },
  caption: { marginTop: -26, marginHorizontal: 5, marginBottom: 5, borderRadius: 13, borderWidth: 1, borderColor: colors.glassEdge },
  source: { flexDirection: 'row', alignItems: 'center', gap: 5 }, sourceText: { color: colors.muted, fontSize: 12, flexShrink: 1 },
  title: { color: colors.ink, fontSize: 16, lineHeight: 21, fontWeight: '600', letterSpacing: -.2 },
  excerpt: { color: colors.muted, fontSize: 14, lineHeight: 21, paddingBottom: 5 },
  saved: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  state: { flexDirection: 'row', alignItems: 'center', gap: 4 }, stateText: { fontSize: 12, color: colors.muted },
});
