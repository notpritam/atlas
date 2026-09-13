import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createFingerprintAsync } from '@expo/fingerprint';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

test('native share changes require a new OTA runtime; app UI and test changes do not', async () => {
  const baseline = await createFingerprintAsync(projectRoot, { platforms: ['ios'] });
  for (const [filePath, native] of [
    ['share-extension/ShareItemLoader.swift', true],
    ['src/palettes.json', true],
    ['variants.json', true],
    ['share-extension/SafariPreprocessor.js', true],
    ['share-extension/Info.plist', true],
    ['assets/images/mark.png', true],
    ['modules/foundkeep-shared/ios/FoundkeepSharedModule.swift', true],
    ['src/components/GalleryCard.tsx', false],
    ['share-extension/tests/ShareItemLoaderTests.swift', false],
  ]) {
    // Change only the bytes presented to Expo's hasher. No source file is edited.
    const changed = await createFingerprintAsync(projectRoot, {
      platforms: ['ios'],
      fileHookTransform(source, chunk, end) {
        return source.type === 'file' && source.filePath === filePath && end
          ? Buffer.concat([Buffer.from(chunk ?? ''), Buffer.from('\nchanged-for-runtime-regression')])
          : chunk;
      },
    });
    assert.equal(changed.hash !== baseline.hash, native, filePath);
  }
});

test('Android receipt bridge changes require a new native runtime', async () => {
  const baseline = await createFingerprintAsync(projectRoot, { platforms: ['android'] });
  const filePath = 'modules/foundkeep-shared/android/src/main/java/app/foundkeep/shared/FoundkeepAndroidSharesModule.kt';
  const changed = await createFingerprintAsync(projectRoot, {
    platforms: ['android'],
    fileHookTransform(source, chunk, end) {
      return source.type === 'file' && source.filePath === filePath && end
        ? Buffer.concat([Buffer.from(chunk ?? ''), Buffer.from('\nchanged-for-android-receipt-regression')]) : chunk;
    },
  });
  assert.notEqual(changed.hash, baseline.hash);
});
