import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import { StyleSheet, View } from 'react-native';
import { AdaptiveText as Text } from './AdaptiveText.tsx';
import { getEnvironment } from '../environment.ts';
import { useThemedStyles } from '../appearance/AppearanceProvider.tsx';
import { colors, typography } from '../theme.ts';

export function EnvironmentBadge({ devOnly = false }: { devOnly?: boolean }) {
  const styles = useThemedStyles(baseStyles);
  const dev = getEnvironment().environment === 'dev';
  if (devOnly && !dev) return null;
  return <View style={styles.badge}><Text style={styles.badgeText}>{dev ? 'DEV' : 'Production'}</Text></View>;
}

export function BuildInfo() {
  const styles = useThemedStyles(baseStyles);
  const environment = getEnvironment();
  const version = Application.nativeApplicationVersion;
  const build = Application.nativeBuildVersion;
  return <View style={styles.info} testID="build-info">
    <View style={styles.heading}><Text style={typography.heading}>App & connection</Text><EnvironmentBadge /></View>
    <Text selectable style={typography.body}>{environment.origin}</Text>
    <Text selectable style={typography.small}>{version ? `Version ${version}${build ? ` · Build ${build}` : ''}` : `Web preview · ${Constants.expoConfig?.version || 'unversioned'}`}</Text>
    <Text selectable style={typography.small}>Update channel: {Updates.channel || 'Local preview'}{Updates.updateId ? ` · ${Updates.isEmbeddedLaunch ? 'Bundled' : 'Update'} ${Updates.updateId.slice(0, 8)}` : ''}</Text>
    <Text style={typography.small}>{environment.environment === 'dev' ? 'Saves sync to your dev account. Check the same account at dev.foundkeep.app. Production accounts and saves stay separate.' : 'Saves sync to your production account at foundkeep.app.'}</Text>
  </View>;
}

const baseStyles = StyleSheet.create({
  info: { gap: 10, padding: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, borderRadius: 16, backgroundColor: colors.surface },
  heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  badge: { alignSelf: 'center', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: colors.accentSoft },
  badgeText: { color: colors.accent, fontSize: 11, lineHeight: 16, fontWeight: '700' },
});
