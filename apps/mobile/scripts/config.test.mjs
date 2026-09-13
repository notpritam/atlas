import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Foundkeep mobile config pins the release identity and safe OTA runtime', async () => {
  const app = JSON.parse(await readFile(new URL('../app.json', import.meta.url), 'utf8')).expo;
  assert.equal(app.name, 'Foundkeep');
  assert.equal(app.slug, 'foundkeep');
  assert.equal(app.version, '1.0.0');
  assert.equal(app.scheme, 'foundkeep');
  assert.equal(app.ios.bundleIdentifier, 'app.foundkeep.ios');
  assert.equal(app.ios.buildNumber, '1');
  assert.equal(app.ios.supportsTablet, false);
  assert.ok(app.ios.associatedDomains.includes('applinks:foundkeep.app'));
  assert.deepEqual(app.runtimeVersion, { policy: 'fingerprint' });
  assert.equal(app.updates.checkAutomatically, 'ON_LOAD');
  assert.equal(app.updates.fallbackToCacheTimeout, 0);
  assert.equal(app.updates.url, 'https://u.expo.dev/33362145-2b45-4d86-bb08-cd10c6bfae61');
  assert.equal(app.extra.eas.projectId, '33362145-2b45-4d86-bb08-cd10c6bfae61');
  assert.equal(app.ios.infoPlist.ITSAppUsesNonExemptEncryption, false);
  assert.equal(app.ios.infoPlist.NSPhotoLibraryUsageDescription, undefined);
  assert.equal(app.ios.privacyManifests.NSPrivacyTracking, false);
  assert.deepEqual(
    app.ios.privacyManifests.NSPrivacyAccessedAPITypes.find(
      item => item.NSPrivacyAccessedAPIType === 'NSPrivacyAccessedAPICategoryUserDefaults',
    )?.NSPrivacyAccessedAPITypeReasons,
    ['1C8F.1'],
  );
  assert.ok(app.ios.privacyManifests.NSPrivacyCollectedDataTypes.some(item => item.NSPrivacyCollectedDataType === 'NSPrivacyCollectedDataTypeBrowsingHistory'));
  assert.equal(app.ios.privacyManifests.NSPrivacyCollectedDataTypes.find(item => item.NSPrivacyCollectedDataType === 'NSPrivacyCollectedDataTypeDeviceID')?.NSPrivacyCollectedDataTypeLinked, true);
  assert.ok(app.plugins.includes('expo-router'));
  assert.ok(app.plugins.includes('expo-updates'));
  assert.ok(app.plugins.includes('expo-notifications'));
  assert.doesNotMatch(JSON.stringify(app), /token|password|secret/i);
});

test('EAS profiles separate development, preview and production update channels', async () => {
  const eas = JSON.parse(await readFile(new URL('../eas.json', import.meta.url), 'utf8'));
  assert.equal(eas.build.development.bun, '1.4.2');
  assert.equal(eas.build.development.developmentClient, true);
  assert.equal(eas.build.development.channel, 'development');
  assert.equal(eas.build.preview.bun, '1.4.2');
  assert.equal(eas.build.preview.channel, 'preview');
  assert.equal(eas.build.production.bun, '1.4.2');
  assert.equal(eas.build.production.channel, 'production');
  assert.equal(eas.build.production.autoIncrement, true);
  assert.equal(eas.submit.production.ios.ascAppId, '6809771188');
});

test('resolved dev config isolates bundle, group, keychain, Android, OTA channel and submission', async () => {
  const { execFileSync } = await import('node:child_process');
  const cwd = new URL('..', import.meta.url);
  const config = env => JSON.parse(execFileSync('bunx', ['expo','config','--type','public','--json'], {cwd,env:{...process.env,FOUNDKEEP_APP_ENV:env},encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  const prod=config('prod'),dev=config('dev');
  assert.equal(prod.ios.bundleIdentifier,'app.foundkeep.ios');assert.equal(prod.scheme,'foundkeep');
  assert.equal(dev.name,'FoundKeep Dev');assert.equal(dev.ios.bundleIdentifier,'app.foundkeep.ios');assert.equal(dev.android.package,'app.foundkeep.android');assert.equal(prod.android.package,'app.foundkeep.android');
  assert.equal(dev.scheme,'foundkeep');assert.equal(dev.extra.foundkeep.origin,'https://dev.foundkeep.app');
  assert.deepEqual(dev.ios.entitlements['com.apple.security.application-groups'],['group.app.foundkeep.ios']);
  assert.deepEqual(dev.ios.entitlements['keychain-access-groups'],['$(AppIdentifierPrefix)app.foundkeep.shared']);
  assert.equal(dev.ios.infoPlist.FoundkeepOrigin,'https://dev.foundkeep.app');
  assert.equal(dev.extra.eas.build.experimental.ios.appExtensions[0].bundleIdentifier,'app.foundkeep.ios.ShareExtension');
  assert.equal(dev.android.allowBackup,false);assert.equal(dev.ios.infoPlist.FoundkeepStorageNamespace,'dev');assert.equal(prod.ios.infoPlist.FoundkeepStorageNamespace,'');assert.notEqual(dev.ios.infoPlist.FoundkeepKeychainService,prod.ios.infoPlist.FoundkeepKeychainService);
  const sharing=dev.plugins.find(plugin=>Array.isArray(plugin)&&plugin[0]==='expo-sharing')[1];assert.equal(sharing.android.enabled,true);assert.equal(sharing.ios.enabled,false);
  const eas=JSON.parse(await readFile(new URL('../eas.json',import.meta.url),'utf8'));
  for(const name of ['friends-ios','friends-android','friends-play']) {assert.equal(eas.build[name].channel,'production-beta');assert.equal(eas.build[name].env.FOUNDKEEP_APP_ENV,'prod');}
  for(const name of ['pritam-ios','pritam-android']){assert.equal(eas.build[name].channel,'dev');assert.equal(eas.build[name].env.FOUNDKEEP_APP_ENV,'dev');}
  assert.equal(eas.build['friends-android'].android.buildType,'apk');assert.equal(eas.build['friends-play'].android.buildType,'app-bundle');assert.equal(eas.submit['friends-ios'].ios.ascAppId,'6809771188');
  assert.throws(()=>config('staging'));
});
