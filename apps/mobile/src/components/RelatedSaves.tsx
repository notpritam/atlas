import { AdaptiveText as Text } from './AdaptiveText.tsx';
import { AdaptiveIcon as Ionicons } from './AdaptiveIcon.tsx';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import type { Capture, RelatedSave } from '../api/types.ts';
import { captureTitle } from '../collection/model.ts';
import { useSession } from '../session/SessionProvider.tsx';
import { colors, typography } from '../theme.ts';
import { CapturePreview } from './CapturePreview.tsx';
import { Shimmer } from './Shimmer.tsx';
import { useThemedStyles } from '../appearance/AppearanceProvider.tsx';

export function RelatedSaves({ capture }: { capture: Capture }) {
  const styles = useThemedStyles(baseStyles);
  const { client } = useSession();
  const [items, setItems] = useState<RelatedSave[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const revision = useRef(capture.updatedAt);
  useFocusEffect(useCallback(() => {
    let live = true, request = 0;
    setItems(null); setFailed(false);
    const load = async (reload = false) => {
      const current = ++request;
      try {
        const result = await client.relatedCaptures(capture.id, { reload });
        if (live && request === current) { setItems(result.items); setFailed(false); }
      } catch { if (live && request === current) setFailed(true); }
    };
    // Enrichment can attach tags between polls without a local write event.
    // A new capture revision must not reuse the earlier related result.
    void load(retry > 0 || revision.current !== capture.updatedAt);
    revision.current = capture.updatedAt;
    const unsubscribe = client.subscribeInvalidation(() => void load(true));
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') void load(true); });
    return () => { live = false; unsubscribe(); foreground.remove(); };
  }, [client, capture.id, capture.updatedAt, retry]));

  return <View style={styles.section}>
    <Text accessibilityRole="header" style={typography.heading}>Related saves</Text>
    {failed ? <View><Text style={typography.small}>Related saves couldn’t load.</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry related saves" onPress={() => setRetry(value => value + 1)} style={styles.retry}><Text style={styles.link}>Try again</Text></Pressable></View>
      : !items ? <View accessibilityRole="progressbar" accessibilityLabel="Finding related saves" style={{ gap: 12 }}><Shimmer style={styles.skeleton} /><Shimmer style={styles.skeleton} /></View>
      : items.length ? items.map(item => <Pressable key={item.capture.id} accessibilityRole="button" accessibilityLabel={`Open related save ${captureTitle(item.capture)}. ${item.reasons.map(reason => reason.label).join('. ')}`} onPress={() => router.push({ pathname: '/(app)/capture/[id]', params: { id: item.capture.id } })} style={({ pressed }) => [styles.item, pressed && { opacity: .65 }]}>
        <CapturePreview capture={item.capture} compact style={styles.preview} />
        <View style={styles.copy}><Text numberOfLines={2} style={styles.title}>{captureTitle(item.capture)}</Text><Text numberOfLines={2} style={typography.small}>{item.reasons.map(reason => reason.label).join(' · ')}</Text></View>
        <Ionicons name="chevron-forward" size={17} color={colors.muted} />
      </Pressable>) : <Text style={typography.small}>Saves with shared tags, folders, or sources will appear here.</Text>}
  </View>;
}
const baseStyles = StyleSheet.create({
  section: { gap: 14, paddingTop: 8 }, item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  preview: { width: 56, height: 60, aspectRatio: undefined, borderRadius: 8 }, copy: { flex: 1, gap: 5 }, title: { color: colors.ink, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  skeleton: { height: 72, borderRadius: 10 }, retry: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }, link: { color: colors.accent, fontSize: 15, fontWeight: '600' },
});
