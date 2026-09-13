import { useAppearance } from '../../../appearance/AppearanceProvider.tsx';
import { getEnvironment } from '../../../environment.ts';
import { useBilling } from '../../../billing/BillingProvider.tsx';
import { AdaptiveText as Text } from '../../../components/AdaptiveText.tsx';
import { AdaptiveIcon as Ionicons } from '../../../components/AdaptiveIcon.tsx';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import FoundkeepShared from '../../../../modules/foundkeep-shared/src';
import { OAuthButtons } from '../../../components/OAuthButtons.tsx';
import { useDock } from '../../../components/FloatingDock.tsx';
import { Brand, Button, Field, Message, Screen } from '../../../components/ui.tsx';
import { useSession } from '../../../session/SessionProvider.tsx';
import { FrostedPanel } from '../../../components/ScenicSurface.tsx';
import { colors, typography } from '../../../theme.ts';
import { disableNotifications, enableNotifications, notificationState, type NotificationState } from '../../../notifications/notifications.ts';

const usage = (value = 0) => `${(value / 1048576).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
export default function Settings() {
  const { plan } = useBilling();
  const appearance = useAppearance();
  const { bottomSpace } = useDock();
  const { account, usage: storage, policy, updateRequired, logout, deleteAccount, client } = useSession(); const [error, setError] = useState('');
  const [pending, setPending] = useState(0);
  const [blocked, setBlocked] = useState(0);
  const [resolving, setResolving] = useState(false);
  const refreshQueue = useCallback(async () => {
    const [pending, blocked] = await Promise.all([FoundkeepShared.pendingCount(), FoundkeepShared.blockedPendingCount()]);
    setPending(pending); setBlocked(blocked);
  }, []);
  useFocusEffect(useCallback(() => { void refreshQueue().catch(() => {}); }, [refreshQueue]));
  const recoverBlocked = () => Alert.alert('Save these items to Unfiled?', 'Their folder was deleted. Your tags, notes, files, and original sources will stay attached.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Save to Unfiled', onPress: async () => {
    setResolving(true); setError('');
    try { await FoundkeepShared.resolveBlockedPendingToUnfiled(); await FoundkeepShared.retryPending(); client.invalidate(); await refreshQueue(); }
    catch (value) { setError((value as Error).message); }
    finally { setResolving(false); }
  } }]);
  const [showDelete, setShowDelete] = useState(false); const [password, setPassword] = useState(''); const [deleting, setDeleting] = useState(false);
  const [notification, setNotification] = useState<NotificationState>('off'); const [changingNotification, setChangingNotification] = useState(false);
  useEffect(() => { let live = true; void notificationState(client).then(value => { if (live) setNotification(value); }).catch(() => {}); return () => { live = false; }; }, [client]);
  const changeNotifications = async () => {
    if (notification === 'blocked') { await Linking.openSettings(); return; }
    if (notification === 'unavailable') return;
    setChangingNotification(true); setError('');
    try {
      if (notification === 'on') await disableNotifications(client);
      else await enableNotifications(client);
      setNotification(await notificationState(client));
    } catch (value) {
      setError((value as Error).message);
      try { setNotification(await notificationState(client)); } catch {}
    } finally { setChangingNotification(false); }
  };
  const signOut = () => Alert.alert('Sign out of this device?', 'Foundkeep will stop saving from the Share sheet until you sign in again.', [{ text: 'Stay signed in', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: async () => { try { await logout(); router.replace('/(auth)/sign-in'); } catch (value) { setError((value as Error).message); } } }]);
  const confirmDeletion = () => {
    if (!password) { setError('Enter your password to delete this account.'); return; }
    Alert.alert('Permanently delete this account?', 'Every cloud capture and uploaded file will be deleted. This cannot be undone.', [
      { text: 'Keep account', style: 'cancel' },
      { text: 'Delete permanently', style: 'destructive', onPress: () => void (async () => {
        setDeleting(true); setError('');
        try { await deleteAccount(password); router.replace('/(auth)/sign-in'); }
        catch (value) { setError((value as Error).message); setDeleting(false); }
      })() },
    ]);
  };
  const notificationCopy = !policy.features.notifications ? 'Capture alerts are temporarily unavailable.' : notification === 'on' ? 'On. A private alert opens the saved item when processing finishes.' : notification === 'blocked' ? 'Off in device Settings. Allow Foundkeep alerts there to turn them back on.' : notification === 'unavailable' ? 'Push alerts are available on a physical device.' : 'Off. Turn this on to hear when a shared item is ready.';
  const notificationAction = notification === 'on' ? 'Turn off capture alerts' : notification === 'blocked' ? 'Open device Settings' : 'Turn on capture alerts';
  return <Screen><ScrollView contentContainerStyle={[styles.page, { paddingBottom: bottomSpace }]}>
    <Brand compact />
    <View style={styles.heading}><Text style={typography.title}>Settings.</Text><Text style={[typography.body, { color: colors.muted }]}>A little space for you.</Text></View>
    {updateRequired ? <Message error>Update Foundkeep from the App Store to keep saving.</Message> : <Message>{policy.notice}</Message>}
    <FrostedPanel><Text style={typography.heading}>Appearance</Text><View style={{flexDirection:'row',gap:8}}>{(['system','light','dark'] as const).map(value=><Pressable key={value} accessibilityRole="radio" accessibilityState={{checked:appearance.preference===value}} onPress={()=>void appearance.setPreference(value).catch(()=>setError('Appearance could not be saved.'))} style={{flex:1,minHeight:48,padding:12,borderRadius:12,alignItems:'center',justifyContent:'center',backgroundColor:appearance.preference===value?colors.accentSoft:colors.surface}}><Text style={typography.label}>{value}</Text></Pressable>)}</View></FrostedPanel>
    <View style={styles.profile}><View style={styles.avatar}><Text style={styles.initial}>{(account?.name || 'F').slice(0, 1).toUpperCase()}</Text></View><View style={{ flex: 1, gap: 4 }}><Text style={styles.account}>{account?.name}</Text><Text style={typography.small}>{account?.email}</Text></View></View>
    <View style={styles.section}><View style={styles.storageRow}><Text style={typography.heading}>Your collection</Text><Text style={typography.small}>{storage?.captures.toLocaleString() || 0} saves</Text></View><View style={styles.meter}><View style={[styles.meterFill, { width: `${storage?.maxBytes ? Math.min(100, storage.bytes / storage.maxBytes * 100) : 0}%` }]} /></View><Text style={typography.small}>{usage(storage?.bytes)} of {usage(storage?.maxBytes)} used</Text></View>
    <SettingsRow icon="sparkles-outline" label="Your plan" title={plan?.pro ? 'Foundkeep Pro' : 'Your free collection'} detail={plan?.pro ? 'Manage your subscription and processing allowance.' : 'Explore Pro, or restore an App Store purchase.'} onPress={() => router.push('/(app)/subscription')} />
    {pending > 0 ? <FrostedPanel><Text style={typography.label}>Waiting to upload</Text><Text style={typography.body}>{pending} {pending === 1 ? 'save is' : 'saves are'} kept safely on this device.</Text>{blocked > 0 ? <><Text style={typography.small}>{blocked} need a new home because their folder was deleted.</Text><Button secondary label="Save blocked items to Unfiled" loading={resolving} onPress={recoverBlocked} /></> : <Text style={typography.small}>They’ll upload when Foundkeep reconnects.</Text>}</FrostedPanel> : null}
    <View style={styles.section}>
      <SettingsRow icon="notifications-outline" label={notificationAction} title="Capture-ready alerts" detail={notificationCopy} value={notification === 'on' ? 'On' : 'Off'} loading={changingNotification} disabled={!policy.features.notifications || notification === 'unavailable'} onPress={() => void changeNotifications()} />
      <SettingsRow icon="share-outline" label="How to save from other apps" title="Save from other apps" detail="A quick guide to your device’s Share menu." onPress={() => router.push('/(app)/onboarding')} />
    </View>
    <Message error>{error}</Message>
    <View style={styles.section}>
      <SettingsRow icon="help-circle-outline" label="Support" onPress={() => void Linking.openURL('https://foundkeep.app/support')} />
      <SettingsRow icon="shield-checkmark-outline" label="Privacy policy" onPress={() => void Linking.openURL('https://foundkeep.app/privacy')} />
      <SettingsRow icon="document-text-outline" label="Terms" onPress={() => void Linking.openURL('https://foundkeep.app/terms')} />
      <SettingsRow icon="globe-outline" label="Open web dashboard" onPress={() => void Linking.openURL(`${getEnvironment().origin}/dashboard`)} />
    </View>
    <SettingsRow icon="log-out-outline" label="Sign out" onPress={signOut} />
    {showDelete ? <View style={styles.deletePanel}><Text style={typography.heading}>Delete your account?</Text><Text style={typography.small}>This permanently removes your account and every save. Export anything you need first. Deleting your Foundkeep account does not cancel an App Store subscription; cancel it in your Apple Account settings.</Text>{account?.hasPassword === false ? <OAuthButtons intent="delete" /> : <><Field label="Password" value={password} onChangeText={setPassword} textContentType="password" secureTextEntry autoCapitalize="none" /><Button label="Delete account permanently" danger loading={deleting} onPress={confirmDeletion} /></>}<Button label="Cancel" secondary disabled={deleting} onPress={() => { setShowDelete(false); setPassword(''); setError(''); }} /></View> : <SettingsRow icon="trash-outline" label="Delete account" onPress={() => setShowDelete(true)} />}
    <Text style={styles.version}>Foundkeep 1.0.0</Text>
  </ScrollView></Screen>;
}
function SettingsRow({ icon, label, title, detail, value, onPress, disabled = false, loading = false }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; title?: string; detail?: string; value?: string; onPress: () => void; disabled?: boolean; loading?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={detail} accessibilityState={{ disabled: disabled || loading }} disabled={disabled || loading} onPress={onPress} style={({ pressed }) => [styles.row, (pressed || disabled || loading) && { opacity: .5 }]}>
    <Ionicons name={icon} size={22} color={colors.muted} /><View style={{ flex: 1, gap: 4 }}><Text style={styles.rowTitle}>{title || label}</Text>{detail ? <Text style={typography.small}>{detail}</Text> : null}</View>
    {loading ? <ActivityIndicator color={colors.accent} /> : <>{value ? <Text style={typography.small}>{value}</Text> : null}<Ionicons name="chevron-forward" size={16} color={colors.muted} /></>}
  </Pressable>;
}
const styles = StyleSheet.create({
  page: { padding: 24, gap: 20 }, heading: { gap: 9, marginTop: 14 },
  profile: { flexDirection: 'row', gap: 14, alignItems: 'center', paddingVertical: 8 },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.accentSoft, justifyContent: 'center', alignItems: 'center' }, initial: { color: colors.accent, fontSize: 22, fontWeight: '600' }, account: { color: colors.ink, fontSize: 20, fontWeight: '600' },
  section: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: 16, gap: 10 }, storageRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  meter: { height: 4, borderRadius: 2, backgroundColor: colors.line, overflow: 'hidden', marginVertical: 4 }, meterFill: { height: '100%', backgroundColor: colors.accent },
  row: { flexDirection: 'row', minHeight: 52, alignItems: 'center', gap: 12, paddingVertical: 10 }, rowTitle: { color: colors.ink, fontSize: 16, lineHeight: 22 },
  deletePanel: { gap: 12, padding: 18, borderWidth: 1, borderColor: colors.line, borderRadius: 13, backgroundColor: colors.errorSurface }, version: { ...typography.small, textAlign: 'center', marginTop: 8 },
});
