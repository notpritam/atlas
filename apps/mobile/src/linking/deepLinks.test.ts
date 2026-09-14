import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFoundkeepLink, safeReturnPath } from './deepLinks.ts';

const captureId = '7496c7eb-26ef-4f35-8255-d2d00d8e7a39';

test('custom links open public account routes and protected collection routes', () => {
  assert.deepEqual(parseFoundkeepLink('foundkeep://'), { href: '/(app)/(tabs)/collection', requiresAuth: true });
  assert.deepEqual(parseFoundkeepLink('foundkeep://login'), { href: '/(auth)/sign-in', requiresAuth: false });
  assert.deepEqual(parseFoundkeepLink('foundkeep:///register'), { href: '/(auth)/register', requiresAuth: false });
  assert.deepEqual(parseFoundkeepLink('foundkeep://recover'), { href: '/(auth)/recover', requiresAuth: false });
  assert.deepEqual(parseFoundkeepLink('foundkeep://collection'), { href: '/(app)/(tabs)/collection', requiresAuth: true });
  assert.deepEqual(parseFoundkeepLink(`foundkeep://capture/${captureId}`), {
    href: `/(app)/capture/${captureId}`,
    requiresAuth: true,
  });
});

test('FoundKeep web links resolve to the same allowlisted app destinations', () => {
  assert.deepEqual(parseFoundkeepLink('https://foundkeep.app/open?path=settings'), {
    href: '/(app)/(tabs)/settings', requiresAuth: true,
  });
  assert.deepEqual(parseFoundkeepLink(`https://foundkeep.app/open.html?path=capture%2F${captureId}`), {
    href: `/(app)/capture/${captureId}`, requiresAuth: true,
  });
});

test('links never accept another origin, credentials, fragments or arbitrary routes', () => {
  for (const link of [
    'https://foundkeep.app.evil.example/open.html?path=collection',
    'https://foundkeep.app/open.html?path=https://evil.example',
    'foundkeep://capture/not-a-uuid',
    'foundkeep://capture/7496c7eb-26ef-4f35-8255-d2d00d8e7a39/extra',
    'foundkeep://unknown',
    'foundkeep://login?token=secret',
    'foundkeep://login#unexpected',
  ]) assert.equal(parseFoundkeepLink(link), null, link);
});

test('post-login return paths are allowlisted protected destinations only', () => {
  assert.equal(safeReturnPath('/(app)/(tabs)/collection'), '/(app)/(tabs)/collection');
  assert.equal(safeReturnPath(`/(app)/capture/${captureId}`), `/(app)/capture/${captureId}`);
  assert.equal(safeReturnPath('/(app)/collection'), '/(app)/(tabs)/collection');
  assert.equal(safeReturnPath('/(app)/settings'), '/(app)/(tabs)/settings');
  assert.equal(safeReturnPath('/(auth)/recover'), null);
  assert.equal(safeReturnPath('https://evil.example'), null);
});
