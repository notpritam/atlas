import { test, expect } from 'bun:test';
import { createHmac } from 'node:crypto';
import { verifyPaddleSignature } from '../src/paddle-signature.ts';

const secret = 'pdl_ntfset_testsecret';
const body = '{"event_id":"evt_1","event_type":"subscription.created"}';
function sign(ts: number, b = body, s = secret) {
  const h1 = createHmac('sha256', s).update(`${ts}:${b}`).digest('hex');
  return `ts=${ts};h1=${h1}`;
}

test('accepts a valid, fresh signature', () => {
  const ts = Math.floor(Date.now() / 1000);
  expect(verifyPaddleSignature(body, sign(ts), secret)).toBe(true);
});
test('rejects a tampered body', () => {
  const ts = Math.floor(Date.now() / 1000);
  expect(verifyPaddleSignature(body + 'x', sign(ts), secret)).toBe(false);
});
test('rejects a wrong secret', () => {
  const ts = Math.floor(Date.now() / 1000);
  expect(verifyPaddleSignature(body, sign(ts, body, 'wrong'), secret)).toBe(false);
});
test('rejects a stale timestamp (>1h)', () => {
  const ts = Math.floor(Date.now() / 1000) - 7200;
  expect(verifyPaddleSignature(body, sign(ts), secret)).toBe(false);
});
test('rejects a malformed header', () => {
  expect(verifyPaddleSignature(body, 'garbage', secret)).toBe(false);
});
