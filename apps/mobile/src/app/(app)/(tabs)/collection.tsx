import { AdaptiveText as Text } from '../../../components/AdaptiveText.tsx';
import { AdaptiveIcon as Ionicons } from '../../../components/AdaptiveIcon.tsx';
import { AdaptiveTextInput } from '../../../components/AdaptiveTextInput.tsx';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { CaptureType } from '../../../api/types.ts';
import { Brand, Message, Screen } from '../../../components/ui.tsx';
import { OrganizationPicker, type OrganizationChoice } from '../../../components/OrganizationPicker.tsx';
import { GalleryList } from '../../../components/GalleryList.tsx';
import { useDock } from '../../../components/FloatingDock.tsx';
import { useCollection } from '../../../collection/useCollection.ts';
import { useSession } from '../../../session/SessionProvider.tsx';
import { createScrollChrome } from '../../../collection/scrollChrome.ts';
import { useMotionAllowed } from '../../../components/motion.tsx';
import { colors } from '../../../theme.ts';
import { useThemedStyles } from '../../../appearance/AppearanceProvider.tsx';

const filters: Array<{ type?: CaptureType; label: string }> = [
  { label: 'All' }, { type: 'bookmark', label: 'Links' }, { type: 'image', label: 'Images' }, { type: 'note', label: 'Notes' },
  { type: 'document', label: 'Documents' }, { type: 'selection', label: 'Highlights' }, { type: 'screenshot', label: 'Screenshots' },
  { type: 'audio', label: 'Audio' }, { type: 'video', label: 'Video' }, { type: 'tweet', label: 'Posts' }, { type: 'file', label: 'Files' },
];
export default function CollectionScreen() {
  const styles = useThemedStyles(baseStyles);
  const { policy, updateRequired } = useSession();
  const [query, setQuery] = useState('');
  const [listReset, setListReset] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [type, setType] = useState<CaptureType>();
  const [organization, setOrganization] = useState<OrganizationChoice>({ folderId: undefined, userTags: [] });
  const { height, fontScale } = useWindowDimensions();
  const motion = useMotionAllowed();
  const { setCollapsed, bottomSpace } = useDock();
  const searchRef = useRef<TextInput>(null);
  const searchingRef = useRef(false);
  const [headerHeight, setHeaderHeight] = useState(240);
  const measuredHeight = useRef(240);
  const chrome = useRef(createScrollChrome(240)).current;
  const travel = useRef(new Animated.Value(0)).current;
  const [compact, setCompact] = useState(false);
  const compactRef = useRef(false);
  const syncCompact = useCallback((next: boolean) => {
    if (compactRef.current !== next) { compactRef.current = next; setCompact(next); setCollapsed(next); }
  }, [setCollapsed]);
  useEffect(() => () => setCollapsed(false), [setCollapsed]);
  const revealSearch = () => {
    chrome.reveal(); syncCompact(false); searchingRef.current = true;
    travel.stopAnimation();
    if (motion) Animated.spring(travel, { toValue: 0, stiffness: 310, damping: 32, mass: 1, useNativeDriver: true }).start();
    else travel.setValue(0);
    searchRef.current?.focus();
  };
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const hidden = chrome.scroll(contentOffset.y, contentSize.height - layoutMeasurement.height, searchingRef.current);
    travel.stopAnimation(); travel.setValue(hidden);
    syncCompact(hidden >= measuredHeight.current - 1);
  }, [chrome, travel, syncCompact]);
  useEffect(() => { const timer = setTimeout(() => setSearchQuery(query.trim()), 250); return () => clearTimeout(timer); }, [query]);
  const collection = useCollection({ q: searchQuery || undefined, type, folderId: organization.folderId === null ? 'unfiled' : organization.folderId, tag: organization.userTags[0] });
  const canWrite = policy.capture.note && !updateRequired;
  return <Screen>
    <View testID="collection-header" style={[styles.top, compact && styles.topCompact]}>
      <Brand compact />
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Show search and filters" onPress={revealSearch} style={({ pressed }) => [styles.add, pressed && styles.pressed]}><Ionicons name="search-outline" size={22} color={colors.ink} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Write a new note" accessibilityState={{ disabled: !canWrite }} disabled={!canWrite} onPress={() => router.push('/(app)/new-note')} style={({ pressed }) => [styles.add, pressed && styles.pressed, !canWrite && { opacity: .4 }]}><Ionicons name="add" size={25} color={colors.ink} /></Pressable>
      </View>
    </View>
    <View style={styles.galleryRegion}>
      <GalleryList resetKey={listReset} collection={collection} headerSpace={headerHeight} bottomSpace={bottomSpace} onScroll={onScroll} filtered={Boolean(searchQuery || type || organization.folderId !== undefined || organization.userTags.length)} />
      <Animated.View testID="collection-expanded-controls" pointerEvents={compact ? 'none' : 'auto'} accessibilityElementsHidden={compact} importantForAccessibility={compact ? 'no-hide-descendants' : 'auto'} style={[styles.header, { transform: [{ translateY: Animated.multiply(travel, -1) }] }]} onLayout={event => {
        const next = Math.ceil(event.nativeEvent.layout.height);
        if (next === measuredHeight.current) return;
        measuredHeight.current = next; setHeaderHeight(next); travel.setValue(chrome.resize(next));
      }}>
        <View style={styles.controls}>
        {height > 550 && fontScale < 1.8 ? <View style={styles.heading}><Text style={styles.title}>The collection.</Text><Text style={styles.subtitle}>Recently saved · newest first</Text></View> : null}
        {updateRequired ? <Message error>Update Foundkeep in the App Store to keep saving.</Message> : <Message>{policy.notice}</Message>}
        <View style={styles.search}><Ionicons name="search-outline" size={19} color={colors.muted} /><AdaptiveTextInput ref={searchRef} testID="collection-search" value={query} onChangeText={setQuery} onFocus={() => { searchingRef.current = true; chrome.reveal(); travel.setValue(0); syncCompact(false); }} onBlur={() => { searchingRef.current = false; }} maxLength={200} accessibilityLabel="Search saved items" placeholder="Search your collection" style={styles.searchInput} returnKeyType="search" autoCorrect={false} clearButtonMode="while-editing" /></View>
        <View style={styles.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} keyboardShouldPersistTaps="handled" style={{ flex: 1 }}>
          {filters.map(filter => <Pressable key={filter.label} accessibilityRole="button" accessibilityState={{ selected: type === filter.type }} onPress={() => { setType(filter.type); setListReset(value => value + 1); if (!filter.type) { setQuery(''); setSearchQuery(''); setOrganization({ folderId: undefined, userTags: [] }); void collection.refresh(); } chrome.reveal(); syncCompact(false); travel.setValue(0); }} style={({ pressed }) => [styles.filter, type === filter.type && styles.filterActive, pressed && styles.pressed]}><Text style={[styles.filterText, type === filter.type && styles.filterTextActive]}>{filter.label}</Text></Pressable>)}
        </ScrollView>
        <OrganizationPicker value={organization} onChange={setOrganization} filter compact />
        </View>
        </View>
      </Animated.View>
    </View>
  </Screen>;
}

const baseStyles = StyleSheet.create({
  galleryRegion: { flex: 1, overflow: 'hidden' },
  header: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 16, backgroundColor: colors.paper },
  controls: { gap: 14 },
  top: { minHeight: 56, marginHorizontal: 20, marginTop: 6, marginBottom: 2, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 3, backgroundColor: colors.paper }, topCompact: { borderColor: colors.line }, actions: { flexDirection: 'row', gap: 4 }, add: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, pressed: { opacity: .65 },
  heading: { gap: 5, paddingTop: 2, paddingBottom: 2 }, title: { color: colors.ink, fontSize: 32, lineHeight: 37, fontWeight: '600', letterSpacing: -1.1 }, subtitle: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  search: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: colors.surface }, searchInput: { flex: 1, minHeight: 44, color: colors.ink, fontSize: 16, paddingVertical: 8 },
  filterRow: { flexDirection: 'row', gap: 10, alignItems: 'center' }, filters: { gap: 5 }, filter: { paddingHorizontal: 13, minHeight: 44, justifyContent: 'center', borderRadius: 7, backgroundColor: colors.paper }, filterActive: { backgroundColor: colors.accentSoft }, filterText: { color: colors.muted, fontSize: 13, fontWeight: '600' }, filterTextActive: { color: colors.accent },
});
