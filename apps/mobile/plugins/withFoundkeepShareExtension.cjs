const fs = require('node:fs');
const path = require('node:path');
const { withXcodeProject } = require('expo/config-plugins');

const TARGET_NAME = 'FoundkeepShare';

const SOURCE_FILES = ['ShareViewController.swift', 'ShareItemLoader.swift', 'ShareUploader.swift', 'SharePolicy.swift', 'FoundkeepQueueScope.swift'];
const MARK_FILE = 'FoundkeepMark.png';
const RESOURCE_FILES = ['SafariPreprocessor.js', 'PrivacyInfo.xcprivacy', MARK_FILE];
const ALL_FILES = ['Info.plist', 'FoundkeepShare.entitlements', ...SOURCE_FILES, ...RESOURCE_FILES];

function copyNativeSources(projectRoot, platformProjectRoot, variant) {
  const source = path.join(projectRoot, 'share-extension');
  const target = path.join(platformProjectRoot, TARGET_NAME);
  fs.mkdirSync(target, { recursive: true });
  for (const file of ALL_FILES) {
    const sourceFile = file === MARK_FILE ? path.join(projectRoot, 'assets', 'images', 'mark.png')
      : file === 'FoundkeepQueueScope.swift' ? path.join(projectRoot, 'modules', 'foundkeep-shared', 'ios', file)
      : path.join(source, file);
    if (['Info.plist', 'FoundkeepShare.entitlements'].includes(file)) {
      let content = fs.readFileSync(sourceFile, 'utf8').replaceAll('group.app.foundkeep.ios', variant.appGroup).replaceAll('app.foundkeep.shared', variant.keychainAccessGroup);
      if (file === 'Info.plist') content = content.replace('<dict>', `<dict><key>FoundkeepStorageNamespace</key><string>${variant.storageNamespace}</string><key>FoundkeepAppGroup</key><string>${variant.appGroup}</string><key>FoundkeepKeychainService</key><string>${variant.keychainService}</string><key>FoundkeepOrigin</key><string>${variant.origin}</string><key>FoundkeepScheme</key><string>${variant.scheme}</string>`);
      fs.writeFileSync(path.join(target, file), content);
    } else fs.copyFileSync(sourceFile, path.join(target, file));
  }
}

function addTopLevelGroup(project, files) {
  const { uuid } = project.addPbxGroup(files, TARGET_NAME, TARGET_NAME);
  const groups = project.hash.project.objects.PBXGroup;
  const mainGroup = project.getFirstProject().firstProject.mainGroup;
  if (groups[mainGroup]) {
    groups[mainGroup].children.push({ value: uuid, comment: TARGET_NAME });
    return;
  }
  throw new Error('Foundkeep could not locate the main Xcode project group.');
}

function configureTarget(project, target, bundleIdentifier) {
  const configurationList = project.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList];
  const configurations = project.pbxXCBuildConfigurationSection();
  for (const entry of configurationList.buildConfigurations) {
    const settings = configurations[entry.value].buildSettings;
    Object.assign(settings, {
      APPLICATION_EXTENSION_API_ONLY: 'YES',
      CLANG_ENABLE_MODULES: 'YES',
      CODE_SIGN_ENTITLEMENTS: `${TARGET_NAME}/FoundkeepShare.entitlements`,
      CURRENT_PROJECT_VERSION: '1',
      GENERATE_INFOPLIST_FILE: 'NO',
      INFOPLIST_FILE: `${TARGET_NAME}/Info.plist`,
      IPHONEOS_DEPLOYMENT_TARGET: '15.1',
      MARKETING_VERSION: '1.0.0',
      PRODUCT_BUNDLE_IDENTIFIER: `"${bundleIdentifier}"`,
      PRODUCT_NAME: `"${TARGET_NAME}"`,
      SKIP_INSTALL: 'YES',
      SUPPORTS_MACCATALYST: 'NO',
      SWIFT_VERSION: '5.0',
      TARGETED_DEVICE_FAMILY: '"1"',
    });
  }
  project.addTargetAttribute('ProvisioningStyle', 'Automatic', target.uuid);
}

module.exports = function withFoundkeepShareExtension(config) {
  const variant = config.extra.foundkeep;
  const bundleIdentifier = `${variant.iosBundle}.ShareExtension`;
  return withXcodeProject(config, mod => {
    const project = mod.modResults;
    copyNativeSources(mod.modRequest.projectRoot, mod.modRequest.platformProjectRoot, variant);
    const existingTarget = project.findTargetKey(TARGET_NAME) || project.findTargetKey(`"${TARGET_NAME}"`);
    if (existingTarget) {
      configureTarget(project, { uuid: existingTarget, pbxNativeTarget: project.pbxNativeTargetSection()[existingTarget] }, bundleIdentifier);
      const group = project.findPBXGroupKey({ name: TARGET_NAME });
      if (!group) throw new Error('Foundkeep could not locate the Share Extension group.');
      const mark = project.addFile(MARK_FILE, group);
      if (mark) {
        mark.uuid = project.generateUuid();
        mark.target = existingTarget;
        project.addToPbxBuildFileSection(mark);
        project.addToPbxResourcesBuildPhase(mark);
      }
      const scope = project.addFile('FoundkeepQueueScope.swift', group);
      if (scope) {
        scope.uuid = project.generateUuid();
        scope.target = existingTarget;
        project.addToPbxBuildFileSection(scope);
        project.addToPbxSourcesBuildPhase(scope);
      }
      return mod;
    }

    const target = project.addTarget(TARGET_NAME, 'app_extension', TARGET_NAME, bundleIdentifier);
    addTopLevelGroup(project, ALL_FILES);
    project.addBuildPhase(SOURCE_FILES, 'PBXSourcesBuildPhase', 'Sources', target.uuid, 'app_extension');
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid, 'app_extension');
    project.addBuildPhase(RESOURCE_FILES, 'PBXResourcesBuildPhase', 'Resources', target.uuid, 'app_extension');
    configureTarget(project, target, bundleIdentifier);
    return mod;
  });
};
