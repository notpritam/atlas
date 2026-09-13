import test from 'node:test';
import assert from 'node:assert/strict';
import { captureTitle, filterCaptures, groupCaptures } from './model.ts';

const captures = [
  { id: '1', type: 'document', batchId: 'batch-a', sourceTitle: 'Field report', fileName: 'report.pdf', noteText: null, selectionText: null, capturedAt: 3 },
  { id: '2', type: 'audio', batchId: 'batch-a', sourceTitle: null, fileName: 'voice memo.m4a', noteText: null, selectionText: null, capturedAt: 2 },
  { id: '3', type: 'note', batchId: null, sourceTitle: null, fileName: null, noteText: 'Remember the red door', selectionText: null, capturedAt: 1 },
] as any[];

test('search covers titles, filenames and saved text while type filters remain exact', () => {
  assert.deepEqual(filterCaptures(captures, 'report', null).map(item => item.id), ['1']);
  assert.deepEqual(filterCaptures(captures, 'voice', 'audio').map(item => item.id), ['2']);
  assert.deepEqual(filterCaptures(captures, 'door', 'document'), []);
});

test('multi-item shares stay adjacent as a collection group', () => {
  const groups = groupCaptures(captures);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0]?.items.map(item => item.id), ['1', '2']);
  assert.equal(groups[0]?.batchId, 'batch-a');
  assert.equal(groups[1]?.batchId, null);
});

test('capture titles prefer source title, filename, text and a readable fallback', () => {
  assert.equal(captureTitle(captures[0]), 'Field report');
  assert.equal(captureTitle(captures[1]), 'voice memo.m4a');
  assert.equal(captureTitle(captures[2]), 'Remember the red door');
  assert.equal(captureTitle({ type: 'video' } as any), 'Untitled video');
});

import { sourcePlatform, savedVia, compareRecent, mergeRecentPage, masonryLayout } from '../../../../packages/shared/src/collection-presentation.ts';

test('origin labels use source domains and capture provenance without inventing unknown platforms', () => {
  assert.equal(sourcePlatform({ sourceUrl: 'https://m.youtube.com/watch?v=1' }), 'YouTube');
  assert.equal(sourcePlatform({ sourceUrl: 'https://youtube.com.evil.test/watch' }), 'youtube.com.evil.test');
  assert.equal(sourcePlatform({ sourceUrl: 'javascript:alert(1)' }), null);
  assert.equal(savedVia({ provenance: { captureMethod: 'ios-share-url' } }), 'iphone');
  assert.equal(savedVia({ savedVia: 'iphone', provenance: { captureMethod: 'android-share-text' } }), 'android');
  assert.equal(savedVia({ savedVia: 'iphone', provenance: { captureMethod: 'ios-share-text' } }), 'iphone');
  assert.equal(savedVia({ provenance: { captureMethod: 'popup-save-page' } }), 'browser');
  assert.equal(savedVia({ savedVia: 'dashboard' }), 'dashboard');
  assert.equal(savedVia({}), null);
});
test('recent saves ignore device clock and processing updates and preserve older pagination on refresh', () => {
  const older = { id: 'a', createdAt: 10, capturedAt: 9000 };
  const newer = { id: 'b', createdAt: 20, capturedAt: 1 };
  assert.deepEqual([older, newer].sort(compareRecent).map(item => item.id), ['b', 'a']);
  const latest = { id: 'c', createdAt: 30, capturedAt: 30 };
  assert.deepEqual(mergeRecentPage([newer, older], [latest, newer], true).map(item => item.id), ['c', 'b', 'a']);
  assert.deepEqual(mergeRecentPage([newer, older], [latest], false), [latest]);
});
test('masonry fills the next available column with exact gaps and no overlaps', () => {
  const result = masonryLayout([300, 120, 200, 80, 450], 372, 2, 12);
  assert.deepEqual(result.items.map(item => item.top), [0, 0, 132, 312, 344]);
  assert.equal(result.itemWidth, 180);
  for (const [index, item] of result.items.entries()) for (const next of result.items.slice(index + 1)) {
    if (item.column === next.column) assert.ok(next.top >= item.top + item.height + 12);
  }
  assert.equal(masonryLayout([], 372, 2, 12).height, 0);
});
