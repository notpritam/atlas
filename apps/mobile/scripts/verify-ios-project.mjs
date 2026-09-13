import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = process.argv[2] ? resolve(process.argv[2]) : new URL('../', import.meta.url).pathname;
const variants = JSON.parse(await readFile(join(root, 'variants.json'), 'utf8'));
const variant = variants[process.env.FOUNDKEEP_APP_ENV ?? 'prod'];
assert.ok(variant, 'Unknown environment.');
const ios = join(root, 'ios');
const exists = async path => { try { await access(path); return true; } catch { return false; } };
const projectDirectories = (await readdir(ios)).filter(name => name.endsWith('.xcodeproj'));
const projectDirectory = (await Promise.all(projectDirectories.map(async name => [name, await exists(join(ios, name))]))).find(([, present]) => present)?.[0];
assert.ok(projectDirectory, 'Generated Foundkeep Xcode project is missing.');
const project = await readFile(join(ios, projectDirectory, 'project.pbxproj'), 'utf8');
assert.match(project, /FoundkeepShare/);
assert.match(project, /app\.foundkeep\.ios\.ShareExtension/);
assert.match(project, /ShareViewController\.swift in Sources/);
assert.match(project, /ShareItemLoader\.swift in Sources/);
assert.match(project, /ShareUploader\.swift in Sources/);
assert.match(project, /SharePolicy\.swift in Sources/);
assert.match(project, /Embed.*Extensions|Copy Files/);

const shareDirectory = join(ios, 'FoundkeepShare');
for (const file of ['Info.plist', 'FoundkeepShare.entitlements', 'PrivacyInfo.xcprivacy', 'ShareViewController.swift', 'ShareItemLoader.swift', 'ShareUploader.swift', 'SharePolicy.swift', 'FoundkeepQueueScope.swift', 'SafariPreprocessor.js']) {
  assert.ok(await exists(join(shareDirectory, file)), `${file} was not copied into the Share Extension target.`);
}
const info = await readFile(join(shareDirectory, 'Info.plist'), 'utf8');
assert.match(info, /com\.apple\.share-services/);
assert.match(info, /NSExtensionActivationSupportsWebURLWithMaxCount/);
assert.match(info, /NSExtensionActivationSupportsText/);
assert.match(info, /NSExtensionActivationSupportsImageWithMaxCount/);
assert.match(info, /NSExtensionActivationSupportsMovieWithMaxCount/);
assert.match(info, /NSExtensionActivationSupportsFileWithMaxCount/);
assert.match(info, /SafariPreprocessor/);
const entitlements = await readFile(join(shareDirectory, 'FoundkeepShare.entitlements'), 'utf8');
assert.match(entitlements, /group\.app\.foundkeep\.ios/);
assert.match(entitlements, /app\.foundkeep\.shared/);
const sharePrivacy = await readFile(join(shareDirectory, 'PrivacyInfo.xcprivacy'), 'utf8');
assert.match(sharePrivacy, /NSPrivacyAccessedAPICategoryUserDefaults/);
assert.match(sharePrivacy, /1C8F\.1/);
assert.match(project, /PrivacyInfo\.xcprivacy in Resources/);
const mainName = projectDirectory.replace(/\.xcodeproj$/, '');
const mainEntitlements = await readFile(join(ios, mainName, `${mainName}.entitlements`), 'utf8');
for (const value of [info, await readFile(join(ios, mainName, 'Info.plist'), 'utf8')]) {
  assert.ok(value.includes(variant.origin));
  assert.ok(value.includes(variant.keychainService));
  assert.ok(value.includes('<key>FoundkeepStorageNamespace</key>'));
}
assert.match(mainEntitlements, /group\.app\.foundkeep\.ios/);
assert.match(mainEntitlements, /app\.foundkeep\.shared/);
assert.match(mainEntitlements, /aps-environment/);
assert.match(mainEntitlements, /com\.apple\.developer\.associated-domains/);
assert.ok(mainEntitlements.includes(`applinks:${new URL(variant.origin).hostname}`));
console.log('Foundkeep iOS project includes the native Share Extension and shared security groups.');
