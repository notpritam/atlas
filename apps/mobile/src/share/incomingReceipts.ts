import type { AndroidShare } from './androidRuntime.ts';
export type IncomingReceipt = { id: string; shares: AndroidShare[] };
type Dependencies = {
  pending(): Promise<IncomingReceipt[]>;
  acknowledge(id: string): Promise<unknown>;
  owner(): string | null;
  enqueue(shares: AndroidShare[], owner: string): Promise<unknown>;
  afterSaved(): Promise<void>;
  signedOut(): void;
  failed(error: unknown, discard: () => Promise<void>): void;
};
/** Native receipts preserve arrivals during JS/network work. Notifications take
 * an owner snapshot immediately; a later account cannot adopt an observed share. */
export function createIncomingReceiptDrain(deps: Dependencies) {
  const receipts = new Map<string, IncomingReceipt & { owner: string | null }>();
  const acknowledged = new Set<string>();
  let active: Promise<void> | null = null;
  let observing: Promise<void> = Promise.resolve();
  let again = false;
  async function observe(owner: string | null) {
    const pending = await deps.pending();
    for (const receipt of pending) {
      if (acknowledged.has(receipt.id)) continue;
      const existing = receipts.get(receipt.id);
      if (!existing) receipts.set(receipt.id, { ...receipt, owner });
      else if (!existing.owner && owner) existing.owner = owner;
    }
  }
  function observeInOrder(owner = deps.owner()) {
    // Serialize snapshots, not uploads. Their captured owners and results cannot
    // be applied out of order after a newer account/acknowledgement.
    observing = observing.catch(() => {}).then(() => observe(owner));
    return observing;
  }
  function notify(): Promise<void> {
    // Independent of uploads. Each native event is retained even while the drain waits.
    observeInOrder();
    again = true;
    if (active) return active;
    active = (async () => {
      const attempted = new Set<string>();
      do {
        again = false;
        await observing;
        for (const receipt of receipts.values()) {
          if (attempted.has(receipt.id)) continue;
          if (!receipt.owner) { deps.signedOut(); continue; }
          attempted.add(receipt.id);
          try {
            await deps.enqueue(receipt.shares, receipt.owner);
            await deps.acknowledge(receipt.id);
            acknowledged.add(receipt.id); receipts.delete(receipt.id);
          } catch (error) {
            deps.failed(error, async () => {
              // A delayed Discard can only remove the receipt shown in its alert.
              await deps.acknowledge(receipt.id); acknowledged.add(receipt.id); receipts.delete(receipt.id);
              await notify();
            });
            continue;
          }
          await deps.afterSaved().catch(() => {});
          // Always drain arrivals after enqueue/retry, even if JS missed an event.
          await observeInOrder();
        }
      } while (again);
    })().finally(() => { active = null; });
    return active;
  }
  return { notify };
}
