import {customerNativeUrl} from './customer-native.ts';
import type { Database } from 'bun:sqlite';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const TOKEN = /^(?:Exponent|Expo)PushToken\[[A-Za-z0-9_-]{10,200}\]$/;

export function isExpoPushToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value);
}

type CaptureNotification = {
  accountId: string;
  captureId: string;
  status: 'done' | 'failed';
};

type PushRow = { connection_id: string; expo_push_token: string };
type NotificationFetcher = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

/** Deliver private, content-free capture state. Expo tokens are device routing
 * identifiers; they never carry capture text, titles, source URLs or auth. */
export async function deliverCaptureNotification(
  db: Database,
  capture: CaptureNotification,
  fetcher: NotificationFetcher = fetch,
): Promise<number> {
  const devices = db.query(`SELECT connection_id,expo_push_token FROM customer_push_devices
    WHERE account_id=? AND enabled=1 ORDER BY created_at LIMIT 20`).all(capture.accountId) as PushRow[];
  if (!devices.length) return 0;
  const messages = devices.map(device => ({
    to: device.expo_push_token,
    title: 'Foundkeep',
    body: capture.status === 'done'
      ? 'Your saved item is ready.'
      : 'Your item was saved. Some details could not be processed.',
    sound: 'default',
    data: { url: customerNativeUrl('capture/'+capture.captureId) },
  }));
  try {
    const response = await fetcher(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(8_000),
    });
    const raw = (await response.text()).slice(0, 64 * 1024);
    if (!response.ok) return 0;
    let receipts: unknown;
    try { receipts = JSON.parse(raw)?.data; } catch { return 0; }
    if (!Array.isArray(receipts)) return 0;
    for (let index = 0; index < receipts.length && index < devices.length; index++) {
      const receipt = receipts[index] as { status?: unknown; details?: { error?: unknown } } | null;
      if (receipt?.status === 'error' && receipt.details?.error === 'DeviceNotRegistered') {
        db.query('DELETE FROM customer_push_devices WHERE connection_id=? AND expo_push_token=?')
          .run(devices[index]!.connection_id, devices[index]!.expo_push_token);
      }
    }
    return messages.length;
  } catch {
    return 0;
  }
}
