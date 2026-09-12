import { createHmac, timingSafeEqual } from 'node:crypto';

/** Verify a Paddle `Paddle-Signature` header (`ts=…;h1=…`) over the raw body.
 *  eventId dedupe (in the caller) is the primary replay defence; the 1h window
 *  is a coarse sanity bound that still tolerates Paddle's retry re-signing. */
export function verifyPaddleSignature(rawBody: string, header: string, secret: string, now = Date.now()): boolean {
  if (!header || !secret) return false;
  const parts: Record<string, string> = {};
  for (const seg of header.split(';')) {
    const i = seg.indexOf('=');
    if (i > 0) parts[seg.slice(0, i).trim()] = seg.slice(i + 1).trim();
  }
  const ts = parts.ts, h1 = parts.h1;
  if (!ts || !h1 || !/^\d+$/.test(ts) || !/^[a-f0-9]{64}$/.test(h1)) return false;
  if (Math.abs(now - Number(ts) * 1000) > 60 * 60 * 1000) return false;
  const expected = createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'hex'), b = Buffer.from(h1, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
