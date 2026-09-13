import { requireNativeModule } from 'expo';
import type { IncomingReceipt } from '../../../src/share/incomingReceipts.ts';
export default requireNativeModule<{
  pendingReceipts(): Promise<IncomingReceipt[]>;
  acknowledgeReceipt(id: string): Promise<boolean>;
  localDisplayName(uri: string): Promise<string | null>;
  copyContentUri(sourceUri: string, destinationUri: string, limit: number): Promise<number>;
  addListener(event: 'onIncomingShare', listener: () => void): { remove(): void };
}>('FoundkeepAndroidShares');
