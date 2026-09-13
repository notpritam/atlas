import { AdaptiveText as Text } from './AdaptiveText.tsx';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { AccessibilityInfo, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { masonryLayout, previewRatio } from '../../../../packages/shared/src/collection-presentation.ts';
import { captureTitle } from '../collection/model.ts';
import { galleryColumns } from '../collection/preview.ts';
import { useCollection } from '../collection/useCollection.ts';
import { MotionBoundary } from './motion.tsx';
import { GalleryCard } from './GalleryCard.tsx';
import { GallerySkeleton } from './Shimmer.tsx';
import { Button, Message } from './ui.tsx';
import { colors, palettes, typography } from '../theme.ts';
import type { Capture } from '../api/types.ts';
import { useAppearance, useThemedStyles } from '../appearance/AppearanceProvider.tsx';

export function GalleryList({ collection, filtered = false, headerSpace = 0, bottomSpace = 24, resetKey = 0, onScroll }: { collection: ReturnType<typeof useCollection>; filtered?: boolean; headerSpace?: number; bottomSpace?: number; resetKey?: number; onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void }) {
  const styles = useThemedStyles(baseStyles);
  const palette = palettes[useAppearance().scheme];
  const { width, height, fontScale } = useWindowDimensions();
  const [viewport, setViewport] = useState({ width, height: height / 2 });
  const [windowTop, setWindowTop] = useState(0);
  const [reader, setReader] = useState(false);
  const [, measured] = useState(0);
  const sizes = useRef(new Map<string, { key: string; height: number }>());
  const frame = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const scroll = useRef<ScrollView>(null);
  const offset = useRef(0);
  const columns = galleryColumns(viewport.width, fontScale);
  const contentWidth = Math.max(1, viewport.width - 36);
  const itemWidth = (contentWidth - (columns - 1) * 12) / columns;
  const { captures, loading, refreshing, loadingMore, total, error, refresh, loadMore } = collection;
  const keys = captures.map(item => `${item.id}:${itemWidth}:${fontScale}`);
  const layout = masonryLayout(captures.map((item, index) => {
    const cached = sizes.current.get(item.id);
    if (cached?.key === keys[index]) return cached.height;
    const written = item.type === 'note' || item.type === 'selection';
    const textLines = Math.min(4, Math.ceil(captureTitle(item).length / Math.max(10, (itemWidth - 44) / (8 * fontScale))));
    return (written ? 0 : (itemWidth - 12) / previewRatio(item.width, item.height) - 26) + 110 + textLines * 21 * fontScale + (item.folder ? 22 * fontScale : 0) + (item.userTags?.length ? 24 * fontScale : 0);
  }), contentWidth, columns, 12);
  const previous = useRef<{ captures: Capture[]; layout: typeof layout; headerSpace: number; width: number } | null>(null);
  // Keep the visible save anchored when a background refresh prepends new items,
  // or when an off-screen card receives its measured height.
  useLayoutEffect(() => {
    const before = previous.current;
    if (before && before.width === contentWidth && offset.current > headerSpace + 40) {
      const index = before.layout.items.findIndex(item => item.top + item.height > offset.current - before.headerSpace - 16);
      const anchor = before.captures[index];
      const nextIndex = anchor ? captures.findIndex(item => item.id === anchor.id) : -1;
      if (nextIndex >= 0) {
        const delta = layout.items[nextIndex]!.top - before.layout.items[index]!.top + headerSpace - before.headerSpace;
        if (Math.abs(delta) > 1) { offset.current = Math.max(0, offset.current + delta); scroll.current?.scrollTo({ y: offset.current, animated: false }); setWindowTop(offset.current); }
      }
    }
    previous.current = { captures, layout, headerSpace, width: contentWidth };
  });
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isScreenReaderEnabled().then(value => { if (live) setReader(value); });
    const listener = AccessibilityInfo.addEventListener('screenReaderChanged', setReader);
    return () => { live = false; listener.remove(); if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, []);
  useEffect(() => { const ids = new Set(captures.map(item => item.id)); for (const id of sizes.current.keys()) if (!ids.has(id)) sizes.current.delete(id); }, [captures]);
  useEffect(() => { offset.current = 0; setWindowTop(0); previous.current = null; scroll.current?.scrollTo({ y: 0, animated: false }); }, [resetKey]);
  const open = useCallback((capture: Capture) => router.push({ pathname: '/(app)/capture/[id]', params: { id: capture.id } }), []);
  const regionTop = headerSpace + 16;
  const footerVisible = windowTop + viewport.height > regionTop + layout.height - 320;
  return <ScrollView ref={scroll} testID="gallery-list" style={styles.list} contentContainerStyle={[styles.content, { paddingBottom: bottomSpace }, !captures.length && { flexGrow: 1 }]}
    onLayout={event => { const { width, height } = event.nativeEvent.layout; setViewport(previous => previous.width === width && previous.height === height ? previous : { width, height }); }}
    onScroll={event => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      offset.current = contentOffset.y;
      if (Math.abs(contentOffset.y - windowTop) > viewport.height / 4 || contentOffset.y <= 0) setWindowTop(Math.max(0, contentOffset.y));
      if (!error && !loading && contentOffset.y + layoutMeasurement.height > contentSize.height - 400) void loadMore();
      onScroll?.(event);
    }} scrollEventThrottle={16} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={palette.accent} progressViewOffset={headerSpace} />}>
    <View style={{ height: headerSpace }} />
    {captures.length && error ? <View style={styles.error}><Message error>{error}</Message><Button secondary label="Try again" onPress={() => void refresh()} /></View> : null}
    {captures.length ? <View testID="masonry-gallery" style={{ height: layout.height }}>
      {captures.map((capture, index) => {
        const item = layout.items[index]!;
        // Preserve native/assistive reading order while mounting only a few screens.
        const visible = item.top + item.height >= windowTop - regionTop && item.top <= windowTop + viewport.height - regionTop;
        if (!reader && (item.top + item.height < windowTop - regionTop - viewport.height * 2 || item.top > windowTop - regionTop + viewport.height * 3)) return null;
        const ready = sizes.current.has(capture.id);
        return <View key={capture.id} testID={`gallery-cell-${capture.id}`} style={{ position: 'absolute', top: item.top, left: item.left, width: item.width, opacity: ready ? 1 : 0 }} pointerEvents={ready ? 'auto' : 'none'} accessibilityElementsHidden={!ready} onLayout={event => {
          const height = Math.ceil(event.nativeEvent.layout.height);
          const cached = sizes.current.get(capture.id);
          if (height <= 0 || (cached?.height === height && cached.key === keys[index])) return;
          sizes.current.set(capture.id, { key: keys[index]!, height });
          if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; measured(value => value + 1); });
        }}><MotionBoundary enabled={visible}><GalleryCard capture={capture} onOpen={open} /></MotionBoundary></View>;
      })}
    </View> : loading ? <GallerySkeleton columns={columns} viewportHeight={viewport.height} /> : error ? <View style={styles.empty}><Text style={typography.heading}>Couldn’t open your collection.</Text><Message error>{error}</Message><Button label="Try again" onPress={() => void refresh()} /></View> : <View style={styles.empty}>
      <Text style={[typography.title, { textAlign: 'center' }]}>{filtered ? 'No finds this time.' : 'A home for your good finds.'}</Text>
      <Text style={[typography.body, styles.emptyCopy]}>{filtered ? 'Try another word or choose All.' : 'Share a link, a photo, or a passing thought. Find it all here.'}</Text>
      {!filtered ? <Button secondary label="See how to save" onPress={() => router.push('/(app)/onboarding')} /> : null}
    </View>}
    {loadingMore ? <View style={{ paddingTop: 12 }}><MotionBoundary enabled={footerVisible}><GallerySkeleton columns={columns} viewportHeight={200} /></MotionBoundary></View> : captures.length ? <Text style={styles.count}>{captures.length < total ? `${captures.length} of ${total} finds` : `${total} ${total === 1 ? 'find' : 'finds'} · yours to keep`}</Text> : null}
  </ScrollView>;
}
const baseStyles = StyleSheet.create({ list: { flex: 1 }, content: { paddingHorizontal: 18, paddingTop: 16 }, error: { gap: 10, paddingBottom: 16 }, empty: { flex: 1, paddingVertical: 40, paddingHorizontal: 16, gap: 18, alignItems: 'center', justifyContent: 'center' }, emptyCopy: { color: colors.muted, textAlign: 'center', maxWidth: 300 }, count: { ...typography.small, textAlign: 'center', paddingVertical: 24 } });
