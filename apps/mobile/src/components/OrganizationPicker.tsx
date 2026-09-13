import { AdaptiveText as Text } from './AdaptiveText.tsx';
import { AdaptiveIcon as Ionicons } from './AdaptiveIcon.tsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { Folder, Organization } from '../api/types.ts';
import { addUserTag, STARTER_TAGS, tagSuggestions } from '../collection/organization.ts';
import { useSession } from '../session/SessionProvider.tsx';
import { colors, typography } from '../theme.ts';
import { Button, Field, Message, Screen } from './ui.tsx';
import { useMotionAllowed } from './motion.tsx';
import { Shimmer } from './Shimmer.tsx';
import { useThemedStyles } from '../appearance/AppearanceProvider.tsx';

export type OrganizationChoice = { folderId: string | null | undefined; folderName?: string; userTags: string[] };
export function OrganizationPicker({ value, onChange, filter = false, manageFolders = true, compact = false }: { value: OrganizationChoice; onChange: (value: OrganizationChoice) => void; filter?: boolean; manageFolders?: boolean; compact?: boolean }) {
  const styles = useThemedStyles(baseStyles);
  const { client } = useSession();
  const [visible, setVisible] = useState(false);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tag, setTag] = useState('');
  const [folderName, setFolderName] = useState('');
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
  const motion = useMotionAllowed();
  const load = useCallback(async (reload = false) => {
    setLoading(true);
    try { setOrganization(await client.organization({ reload })); setError(''); }
    catch (value) { setError((value as Error).message); }
    finally { setLoading(false); }
  }, [client]);
  useEffect(() => { setOrganization(null); }, [client]);
  useEffect(() => { if (visible) void load(); }, [visible, load]);
  const addTag = (name: string) => {
    const result = addUserTag(filter ? [] : value.userTags, name);
    if (result.error) { setError(result.error); return; }
    onChange({ ...value, userTags: result.tags }); setTag(''); setError('');
  };
  const toggleTag = (name: string) => {
    const selected = value.userTags.some(tag => tag.toLowerCase() === name.toLowerCase());
    if (selected) onChange({ ...value, userTags: value.userTags.filter(tag => tag.toLowerCase() !== name.toLowerCase()) });
    else addTag(name);
  };
  const saveFolder = async (name = folderName) => {
    if (saving || !name.trim()) return;
    setSaving(true); setError('');
    try {
      const { folder } = editingFolder ? await client.renameFolder(editingFolder.id, name.trim()) : await client.createFolder(name.trim());
      if (!editingFolder || value.folderId === folder.id) onChange({ ...value, folderId: folder.id, folderName: folder.name });
      setEditingFolder(null); setFolderName(''); await load(true);
    } catch (value) { setError((value as Error).message); }
    finally { setSaving(false); }
  };
  const deleteFolder = () => {
    if (!editingFolder || saving) return;
    const folder = editingFolder;
    Alert.alert(`Delete “${folder.name}”?`, 'Your saved items will stay in your collection, without a folder.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete folder', style: 'destructive', onPress: async () => {
      setSaving(true);
      try { await client.deleteFolder(folder.id); if (value.folderId === folder.id) onChange({ ...value, folderId: filter ? undefined : null, folderName: undefined }); setEditingFolder(null); setFolderName(''); await load(true); }
      catch (value) { setError((value as Error).message); }
      finally { setSaving(false); }
    } }]);
  };
  const tags = useMemo(() => tagSuggestions(organization?.tags.map(tag => tag.name) || [], value.userTags, tag, organization?.suggestedTags || STARTER_TAGS), [organization, value.userTags, tag]);
  const summary = value.folderId ? value.folderName || 'Selected folder' : filter && value.folderId === undefined ? 'All saves' : 'Unfiled';
  const folderRow = (id: string | null | undefined, name: string, count?: number) => <Pressable accessibilityRole="button" accessibilityLabel={name} accessibilityState={{ selected: value.folderId === id }} onPress={() => onChange({ ...value, folderId: id, folderName: name })} style={({ pressed }) => [styles.folder, pressed && { opacity: .7 }]}><Ionicons name={id ? 'folder-outline' : id === null ? 'file-tray-outline' : 'grid-outline'} color={colors.accent} size={20} /><Text style={styles.folderName}>{name}</Text>{count !== undefined ? <Text style={typography.small}>{count}</Text> : null}{value.folderId === id ? <Ionicons name="checkmark" color={colors.ink} size={19} /> : null}</Pressable>;
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={filter ? 'Filter by folder or tag' : 'Choose folder and tags'} accessibilityValue={{ text: `${summary}${value.userTags.length ? ' · ' + value.userTags.join(', ') : ''}` }} onPress={() => setVisible(true)} style={({ pressed }) => [styles.trigger, compact && styles.compactTrigger, compact && (value.folderId !== undefined || value.userTags.length > 0) && styles.activeTrigger, pressed && { opacity: .7 }]}><Ionicons name="folder-outline" size={18} color={colors.accent} />{compact ? null : <><Text style={styles.triggerText} numberOfLines={1}>{summary}{value.userTags.length ? ` · ${value.userTags.map(tag => `#${tag}`).join(' ')}` : filter ? ' · filter' : ' · add tags'}</Text><Ionicons name="chevron-down" size={14} color={colors.muted} /></>}</Pressable>
    <Modal visible={visible} presentationStyle="pageSheet" animationType={motion ? 'slide' : 'none'} onRequestClose={() => { if (!saving) setVisible(false); }}><Screen keyboard={Platform.OS !== 'ios'}>
      <View style={styles.toolbar}><Text style={[typography.heading, { flex: 1, flexShrink: 1 }]}>{filter ? 'Find your saves' : 'Organize this save'}</Text><Pressable accessibilityRole="button" disabled={saving} onPress={() => setVisible(false)} style={styles.done}><Text style={styles.doneText}>Done</Text></Pressable></View>
      <ScrollView automaticallyAdjustKeyboardInsets keyboardDismissMode="interactive" contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={typography.heading}>Folders</Text>
        <Text style={typography.small}>Give each save a home. Use tags to connect ideas across folders.</Text>
        {filter ? folderRow(undefined, 'All saves') : null}{folderRow(null, 'Unfiled')}
        {loading && !organization ? <Shimmer style={{ height: 76, borderRadius: 10 }} /> : organization?.folders.map(folder => <View key={folder.id} style={styles.folderRow}>{folderRow(folder.id, folder.displayName || folder.name, folder.count)}{manageFolders ? <Pressable accessibilityRole="button" accessibilityLabel={`Manage ${folder.name}`} style={styles.manage} onPress={() => { setEditingFolder(folder); setFolderName(folder.name); }}><Ionicons name="ellipsis-horizontal" size={19} color={colors.muted} /></Pressable> : null}</View>)}
        {!organization?.folders.length && !loading && !editingFolder ? <View style={styles.chips}>{(organization?.suggestedFolders || ['Reading', 'Projects', 'Inspiration']).map(name => <Pressable key={name} accessibilityRole="button" disabled={saving} onPress={() => void saveFolder(name)} style={styles.chip}><Text style={styles.chipText}>+ {name}</Text></Pressable>)}</View> : null}
        <Field label={editingFolder ? 'Folder name' : 'Create a folder'} value={folderName} onChangeText={setFolderName} placeholder="e.g. Weekend ideas" maxLength={80} />
        {folderName.trim() ? <Button secondary label={editingFolder ? 'Rename folder' : 'Create folder'} onPress={() => void saveFolder()} loading={saving} /> : null}
        {editingFolder ? <View style={{ gap: 8 }}><Button secondary label="Delete folder" onPress={deleteFolder} disabled={saving} /><Button secondary label="Cancel folder changes" onPress={() => { setEditingFolder(null); setFolderName(''); }} disabled={saving} /></View> : null}
        <Text style={[typography.heading, { paddingTop: 14 }]}>Tags</Text><Text style={typography.small}>{filter ? 'Choose a tag to narrow your collection.' : 'Pick a suggestion or type to find or create a tag.'}</Text>
        <Field label={filter ? 'Find a tag' : 'Create a tag'} value={tag} onChangeText={setTag} maxLength={40} autoCapitalize="none" returnKeyType="done" onSubmitEditing={() => { addTag(tag); Keyboard.dismiss(); }} placeholder="e.g. design ideas" />{tag.trim() ? <Button secondary label={filter ? 'Filter by tag' : 'Add tag'} onPress={() => addTag(tag)} /> : null}
        <View style={styles.chips}>{tags.map(name => { const selected = value.userTags.some(tag => tag.toLowerCase() === name.toLowerCase()); return <Pressable key={name} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => toggleTag(name)} style={[styles.chip, selected && styles.selected]}><Text style={[styles.chipText, selected && { color: colors.paper }]}>#{name}</Text></Pressable>; })}</View>
        <Message error>{error}</Message>{error && !saving ? <Button secondary label="Reload folders and tags" onPress={() => void load(true)} /> : null}
        {filter ? <Button secondary label="Clear filters" onPress={() => { onChange({ folderId: undefined, userTags: [] }); setVisible(false); }} /> : null}
      </ScrollView>
    </Screen></Modal>
  </>;
}
const baseStyles = StyleSheet.create({ compactTrigger: { width: 44, paddingHorizontal: 0, justifyContent: 'center', borderRadius: 9 }, activeTrigger: { backgroundColor: colors.accentSoft, borderColor: colors.accent }, trigger: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.line }, triggerText: { color: colors.ink, fontSize: 13, flex: 1 }, toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 24, paddingTop: 8, paddingBottom: 8 }, done: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, doneText: { color: colors.accent, fontSize: 16, fontWeight: '600' }, page: { padding: 24, paddingBottom: 48, gap: 12 }, folderRow: { flexDirection: 'row', alignItems: 'center' }, folder: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, folderName: { flex: 1, color: colors.ink, fontSize: 16 }, manage: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { minHeight: 44, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.line, justifyContent: 'center', backgroundColor: colors.surface }, selected: { backgroundColor: colors.ink, borderColor: colors.ink }, chipText: { color: colors.ink, fontSize: 13, flexShrink: 1 } });
