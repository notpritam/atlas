import test from 'node:test';
import assert from 'node:assert/strict';
import { createScrollChrome } from './scrollChrome.ts';
test('header follows downward travel, then reveals on a deliberate reversal', () => {
  const chrome = createScrollChrome(200);
  assert.equal(chrome.scroll(60, 1000), 60);
  assert.equal(chrome.scroll(240, 1000), 200);
  assert.equal(chrome.scroll(238, 1000), 200);
  assert.equal(chrome.scroll(220, 1000), 180);
  assert.equal(chrome.scroll(30, 1000), 0);
});
test('top and bottom overscroll cannot make the header jitter or reappear', () => {
  const chrome = createScrollChrome(200);
  assert.equal(chrome.scroll(-50, 600), 0);
  assert.equal(chrome.scroll(0, 600), 0);
  assert.equal(chrome.scroll(600, 600), 200);
  assert.equal(chrome.scroll(680, 600), 200);
  assert.equal(chrome.scroll(610, 600), 200);
  assert.equal(chrome.scroll(600, 600), 200);
  assert.equal(chrome.scroll(580, 600), 180);
});
test('search stays expanded and large-text changes keep the measured bounds', () => {
  const chrome = createScrollChrome(200);
  chrome.scroll(400, 1000);
  assert.equal(chrome.scroll(500, 1000, true), 0);
  assert.equal(chrome.scroll(550, 1000, true), 0);
  assert.equal(chrome.scroll(600, 1000), 50);
  assert.equal(chrome.resize(30), 30);
  assert.equal(chrome.reveal(), 0);
});

import { createRequire } from 'node:module';
import { createDockMotion, dockSpring } from '../components/dockMotion.ts';

// Exercise the real spring implementation. The public Animated export switches
// to an instant mock under NODE_ENV=test (including Bun), hiding every frame.
const Animated = createRequire(import.meta.url)('react-native-web/dist/cjs/vendor/react-native/Animated/AnimatedImplementation');
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 16) as unknown as number;
globalThis.cancelAnimationFrame = handle => clearTimeout(handle);
const value = (node: unknown): number => (node as { __getValue(): number }).__getValue();

test('collapse never produces negative label widths or reveals text at rest', async () => {
  const progress = new Animated.Value(0);
  const motion = createDockMotion(progress, 120);
  const frames: { width: number; opacity: number }[] = [];
  progress.addListener(() => frames.push({ width: value(motion.labelWidth), opacity: value(motion.labelOpacity) }));
  await new Promise<void>(resolve => Animated.spring(progress, { ...dockSpring, toValue: 1 }).start(() => resolve()));
  assert.ok(frames.length > 2, 'must observe the animation, not just its final state');
  assert.ok(frames.every(frame => frame.width >= 0), 'spring must never pass a negative width to native layout');
  assert.ok(frames.filter(frame => frame.width < 4).every(frame => frame.opacity === 0), 'text must be fully hidden before its clipping area closes');
  assert.equal(value(motion.labelWidth), 0);
  assert.equal(value(motion.labelOpacity), 0);
});

test('interrupted springs and narrow layouts stay bounded at both endpoints', () => {
  for (const width of [103, 120]) {
    const progress = new Animated.Value(0);
    const motion = createDockMotion(progress, width);
    // A spring reports its first overshooting frame before clamping to rest.
    for (const frame of [0, .3, .9, 1, 1.002, 1, .8, .4, -.002, 0]) {
      progress.setValue(frame);
      assert.ok(value(motion.tabWidth) >= 56 && value(motion.tabWidth) <= width);
      assert.ok(value(motion.labelWidth) >= 0 && value(motion.labelWidth) <= width - 44);
      assert.ok(value(motion.labelOpacity) >= 0 && value(motion.labelOpacity) <= 1);
      if (frame >= .8) assert.equal(value(motion.labelOpacity), 0);
    }
    assert.equal(value(motion.labelWidth), width - 44);
    assert.equal(value(motion.labelOpacity), 1);
  }
});
