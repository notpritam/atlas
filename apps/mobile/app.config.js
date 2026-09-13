const variants = require('./variants.json');
module.exports = ({ config }) => {
  const env = process.env.FOUNDKEEP_APP_ENV ?? 'prod';
  if (!Object.hasOwn(variants, env)) throw new Error('FOUNDKEEP_APP_ENV must be dev or prod');
  const variant = variants[env];
  const group = `$(AppIdentifierPrefix)${variant.keychainAccessGroup}`;
  const entitlements = { 'com.apple.security.application-groups': [variant.appGroup], 'keychain-access-groups': [group] };
  return {
    ...config, name: variant.name, scheme: variant.scheme,
    ios: { ...config.ios, bundleIdentifier: variant.iosBundle, associatedDomains: [`applinks:${new URL(variant.origin).hostname}`], entitlements,
      infoPlist: { ...config.ios.infoPlist, FoundkeepKeychainAccessGroup: group, FoundkeepAppGroup: variant.appGroup, FoundkeepKeychainService: variant.keychainService, FoundkeepOrigin: variant.origin, FoundkeepScheme: variant.scheme, FoundkeepStorageNamespace: variant.storageNamespace } },
    android: { ...config.android, package: variant.androidPackage, allowBackup: false,
      intentFilters: [{ action: 'VIEW', autoVerify: true, category: ['BROWSABLE', 'DEFAULT'], data: [{ scheme: 'https', host: new URL(variant.origin).hostname, pathPrefix: '/open' }] }] },
    plugins: [...config.plugins.filter(plugin => (Array.isArray(plugin) ? plugin[0] : plugin) !== 'expo-sharing' && (Array.isArray(plugin) ? plugin[0] : plugin) !== 'expo-secure-store'),
      ['expo-sharing', { android: { enabled: true, singleShareMimeTypes: ['text/*', 'image/*', 'video/*', 'audio/*', 'application/*'], multipleShareMimeTypes: ['image/*', 'video/*', 'audio/*', 'application/*'] }, ios: { enabled: false } }], 'expo-secure-store', 'expo-system-ui', './plugins/withFoundkeepTheme.cjs'],
    extra: { ...config.extra, foundkeep: variant, eas: { ...config.extra.eas,
      build: { experimental: { ios: { appExtensions: [{ targetName: 'FoundkeepShare', bundleIdentifier: `${variant.iosBundle}.ShareExtension`, entitlements }] } } } } },
  };
};
