import { ProcessCapture } from '../../../billing/ProcessCapture.tsx';
import { savedVia, savedViaLabels, sourcePlatform } from '../../../../../../packages/shared/src/collection-presentation.ts';
import { AdaptiveText as Text } from '../../../components/AdaptiveText.tsx';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { Capture } from '../../../api/types.ts';
import { CapturePreview, captureLabels } from '../../../components/CapturePreview.tsx';
import { EditCaptureSheet } from '../../../components/EditCaptureSheet.tsx';
import { RelatedSaves } from '../../../components/RelatedSaves.tsx';
import { FrostedPanel } from '../../../components/ScenicSurface.tsx';
import { Shimmer } from '../../../components/Shimmer.tsx';
import { Button, Message, Screen } from '../../../components/ui.tsx';
import { capturePreviewSource } from '../../../collection/preview.ts';
import { captureTitle } from '../../../collection/model.ts';
import { useSession } from '../../../session/SessionProvider.tsx';
import { colors, typography } from '../../../theme.ts';

const readableBytes = (value: number) => value < 1024 ? `${value} B` : value < 1048576 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1048576).toFixed(1)} MB`;
const date = (value?: number | null) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Unknown';
function Row({ label, value }: { label: string; value?: string | number | null }) { if (value === null || value === undefined || value === '') return null; return <View style={styles.row}><Text style={typography.label}>{label}</Text><Text selectable style={styles.rowValue}>{String(value)}</Text></View>; }

import FoundkeepShared from '../../../../modules/foundkeep-shared/src';

export default function CaptureDetail() {
  const { id } = useLocalSearchParams<{ id: string }>(); const { client, token, account } = useSession(); const [capture, setCapture] = useState<Capture | null>(null); const [error, setError] = useState(''); const [opening, setOpening] = useState(false);
  const [originExpanded, setOriginExpanded] = useState(false);
  const [editing, setEditing] = useState<Capture | null>(null);
  const [retry, setRetry] = useState(0);
  const pending = useRef(false);
  pending.current = capture?.status === 'pending' || capture?.status === 'processing';
  useFocusEffect(useCallback(() => {
    let live = true, request = 0;
    let inFlight = false;
    setCapture(null); setError(''); setOriginExpanded(false);
    const load = async (reload = false, replace = false) => {
      if (inFlight && !replace) return;
      inFlight = true;
      const current = ++request;
      try {
        const value = await client.getCapture(id, { reload });
        if (live && current === request) { setCapture(value.capture); setError(''); }
      } catch (value) {
        if (live && current === request) setError((value as Error).message);
      } finally { if (current === request) inFlight = false; }
    };
    void load();
    const unsubscribe = client.subscribeInvalidation(() => void load(true, true));
    const appState = AppState.addEventListener('change', state => { if (state === 'active') void load(true); });
    const poll = setInterval(() => { if (AppState.currentState === 'active' && pending.current) void load(true); }, 5_000);
    return () => { live = false; request++; clearInterval(poll); unsubscribe(); appState.remove(); };
  }, [client, id, retry]));
  const remove = () => Alert.alert('Delete this save?', 'This permanently removes it from your Foundkeep account.', [{ text: 'Keep it', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { try { await client.deleteCapture(id); router.replace('/(app)/(tabs)/collection'); } catch (value) { setError((value as Error).message); } } }]);
  const openFile = async () => {
    if (!capture?.fileName) return;
    setOpening(true); setError('');
    try {
      const localUrl = await FoundkeepShared.downloadCaptureFile(capture.id, capture.fileName);
      if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is unavailable on this device.');
      await Sharing.shareAsync(localUrl, { dialogTitle: capture.fileName, mimeType: capture.fileMime || undefined });
    } catch (value) { setError((value as Error).message || 'Foundkeep could not open this file.'); }
    finally { setOpening(false); }
  };
  if (!capture || capture.id !== id) return <Screen top={false}><Stack.Screen options={{ title: 'Saved item', headerRight: () => null }} /><View style={styles.loading}>{error ? <><Message error>{error}</Message><Button label="Try again" secondary onPress={() => setRetry(value => value + 1)} /></> : <View accessibilityRole="progressbar" accessibilityLabel="Loading saved item" style={{ gap: 22 }}><Shimmer style={{ height: 240, borderRadius: 14 }} /><Shimmer style={{ height: 30, width: '85%', borderRadius: 6 }} /><Shimmer style={{ height: 18, width: '60%', borderRadius: 4 }} /></View>}</View></Screen>;
  const source = capture.provenance?.pageUrl || capture.sourceUrl;
  const openSource = () => {
    if (!source) return;
    try {
      const url = new URL(source);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      void Linking.openURL(url.href).catch(() => setError('This source could not be opened.'));
    } catch { setError('This source could not be opened.'); }
  };
  const more = () => Alert.alert('Saved item', undefined, [
    ...(capture.batchId ? [{ text: 'View items saved together', onPress: () => router.push({ pathname: '/(app)/batch/[id]', params: { id: capture.batchId! } }) }] : []),
    ...(capture.fileName ? [{ text: 'Open or share file', onPress: () => { if (!opening) void openFile(); } }] : []),
    { text: 'Delete save', style: 'destructive' as const, onPress: remove },
    { text: 'Cancel', style: 'cancel' as const },
  ]);
  const tags = [...new Set([...(capture.userTags || []), ...(capture.tags || [])])];
  const hasPreview = Boolean(capturePreviewSource(capture, token, account?.id));
  const imageAspect = (capture.type === 'image' || capture.type === 'screenshot') && capture.width && capture.height
    ? Math.max(.65, Math.min(1.9, capture.width / capture.height)) : 1.05;
  const publisher = capture.provenance?.siteName || capture.provenance?.sourceApplication;
  return <Screen top={false}>
    <Stack.Screen options={{ title: 'Saved item', headerRight: () => <View style={styles.actions}>
      <QuickAction label="Edit and organize" icon="create-outline" onPress={() => setEditing(capture)} />
      {source ? <QuickAction label="Open original source" icon="open-outline" onPress={openSource} /> : null}
      <QuickAction label="More saved item actions" icon="ellipsis-horizontal" onPress={more} />
    </View> }} />
    <ScrollView contentContainerStyle={styles.page}>
      {hasPreview ? <CapturePreview capture={capture} contain={capture.type === 'image' || capture.type === 'screenshot'} style={[styles.cover, { aspectRatio: imageAspect }]} /> : null}
      <FrostedPanel style={[styles.hero, hasPreview && styles.overlap]}>
        <Text selectable style={typography.title}>{captureTitle(capture)}</Text>
        <Text style={typography.small}>{publisher || captureLabels[capture.type]} · Saved {date(capture.capturedAt)}</Text>
        {capture.folder || tags.length ? <View style={styles.tags}>
          {capture.folder ? <Pressable accessibilityRole="button" accessibilityLabel={`Change folder: ${capture.folder.name}`} onPress={() => setEditing(capture)} style={styles.tag}><Ionicons name="folder-outline" size={14} color={colors.accent} /><Text style={styles.tagText}>{capture.folder.name}</Text></Pressable> : null}
          {tags.slice(0, 4).map(tag => <Pressable key={tag} accessibilityRole="button" accessibilityLabel={`Edit tag ${tag}`} onPress={() => setEditing(capture)} style={styles.tag}><Text style={styles.tagText}>#{tag}</Text></Pressable>)}
          {tags.length > 4 ? <Pressable accessibilityRole="button" accessibilityLabel={`Show all ${tags.length} tags`} onPress={() => setEditing(capture)} style={styles.tag}><Text style={styles.tagText}>+{tags.length - 4}</Text></Pressable> : null}
        </View> : null}
      </FrostedPanel>
      {pending.current ? <Message>Saved. Your details are being prepared.</Message> : capture.status === 'failed' ? <Message>Saved safely. Some details could not be prepared.</Message> : null}
      {capture.fileName ? <Pressable accessibilityRole="button" accessibilityLabel={opening ? 'Preparing file' : 'Open or share file'} disabled={opening} onPress={() => void openFile()} style={({ pressed }) => [styles.file, pressed && styles.pressed]}>
        <Ionicons name={capture.type === 'audio' ? 'musical-notes-outline' : capture.type === 'video' ? 'videocam-outline' : 'document-outline'} size={24} color={colors.accent} />
        <View style={{ flex: 1, gap: 4 }}><Text style={styles.fileName}>{capture.fileName}</Text><Text style={typography.small}>{capture.fileMime || 'File'} · {readableBytes(capture.fileBytes)}</Text></View>
        {opening ? <ActivityIndicator color={colors.accent} /> : <Ionicons name="share-outline" size={20} color={colors.accent} />}
      </Pressable> : null}
      {capture.selectionText || capture.noteText || capture.summary || capture.articleText ? <FrostedPanel style={styles.reading}>
      <Row label="Highlight" value={capture.selectionText} />
      <Row label="Note" value={capture.noteText} />
      <Row label="Summary" value={capture.summary} />
      <Row label="Saved text" value={capture.articleText} />
      </FrostedPanel> : null}
      <FrostedPanel style={styles.origin}>
        <Pressable accessibilityRole="button" accessibilityLabel="Show source details" accessibilityState={{ expanded: originExpanded }} onPress={() => setOriginExpanded(value => !value)} style={styles.originToggle}>
          <View style={{ flex: 1, gap: 4 }}><Text style={typography.heading}>Original source</Text><Text numberOfLines={1} style={typography.small}>{source || publisher || capture.provenance?.originalFileName || 'Saved in Foundkeep'}</Text></View>
          <Ionicons name={originExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
        </Pressable>
        {originExpanded ? <View style={{ gap: 16, paddingTop: 20 }}>
          <Row label="Page" value={source} /><Row label="Canonical page" value={capture.provenance?.canonicalUrl} />
          <Row label="Original title" value={capture.provenance?.pageTitle} /><Row label="Publisher" value={capture.provenance?.siteName} />
          <Row label="Platform" value={sourcePlatform(capture)} /><Row label="Saved via" value={savedVia(capture) ? savedViaLabels[savedVia(capture)!] : null} /><Row label="Source app" value={capture.provenance?.sourceApplication} /><Row label="Original file" value={capture.provenance?.originalFileName} />
          <Row label="Declared type" value={capture.provenance?.declaredMime} /><Row label="Original size" value={capture.provenance?.byteSize ? readableBytes(capture.provenance.byteSize) : null} />
          <Row label="Suggested tags" value={capture.tags?.map(tag => `#${tag}`).join('  ')} />
        </View> : null}
      </FrostedPanel>
      <Message error>{error}</Message>
      <ProcessCapture key={capture.id} id={capture.id} status={capture.status} onProcessed={()=>client.invalidate()} />
      <RelatedSaves key={capture.id} capture={capture} />
    </ScrollView>
    {editing ? <EditCaptureSheet capture={editing} onClose={() => setEditing(null)} /> : null}
  </Screen>;
}
function QuickAction({ label, icon, onPress }: { label: string; icon: React.ComponentProps<typeof Ionicons>['name']; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}><Ionicons name={icon} size={22} color={colors.accent} /></Pressable>;
}
const styles = StyleSheet.create({
  page: { padding: 20, paddingTop: 8, paddingBottom: 48, gap: 20 }, loading: { flex: 1, justifyContent: 'center', padding: 24, gap: 16 },
  actions: { flexDirection: 'row' }, quickAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 }, pressed: { opacity: .6 },
  cover: { borderRadius: 24, aspectRatio: 1.05 },
  hero: { gap: 12, padding: 20, borderRadius: 24 },
  overlap: { marginTop: -56, marginHorizontal: 10, shadowColor: colors.shadow, shadowOffset: { width: 0, height: 5 }, shadowOpacity: .05, shadowRadius: 16 }, tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, tag: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9, backgroundColor: colors.accentSoft, maxWidth: '100%' }, tagText: { color: colors.accent, fontSize: 13, lineHeight: 18, flexShrink: 1 },
  file: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, borderRadius: 20, backgroundColor: colors.surface }, fileName: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  row: { gap: 8 }, rowValue: { color: colors.ink, fontSize: 16, lineHeight: 25 },
  reading: { gap: 24 },
  origin: { padding: 18 }, originToggle: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 14 },
});
