export function safeDisplayName(value: unknown, fallback = 'Shared file'): string {
  if (typeof value !== 'string') return fallback;
  return (value.split(/[\\/]/).pop() || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0,180) || fallback;
}
export async function localFileName(uri: string, providerName: (uri: string) => Promise<string | null>, fileName: string): Promise<string> {
  if (uri.startsWith('content://')) return safeDisplayName(await providerName(uri));
  if (uri.startsWith('file://')) return safeDisplayName(fileName);
  throw new Error('Only local files can be saved.');
}
export class TransferTimeoutError extends Error {
  constructor() { super('The transfer took too long. Please try again.'); this.name = 'TransferTimeoutError'; }
}
/** Keep one deadline through headers AND consumption. Racing the abort also
 * releases the owner serializer if a fetch/reader ignores cancellation. */
export async function withTransferTimeout<T>(milliseconds: number, work: (signal: AbortSignal, wait: <V>(promise: Promise<V>) => Promise<V>) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let rejectTimeout!: (error: Error) => void;
  const timeout = new Promise<never>((_,reject) => { rejectTimeout = reject; });
  const timer = setTimeout(() => { const error = new TransferTimeoutError(); rejectTimeout(error); controller.abort(error); }, milliseconds);
  const wait = <V>(promise: Promise<V>) => Promise.race([promise, timeout]);
  try { return await work(controller.signal, wait); }
  finally { clearTimeout(timer); }
}
type ReadableBody = { getReader(): { read(): Promise<ReadableStreamReadResult<Uint8Array>>; cancel(reason?: unknown): Promise<void>; releaseLock(): void } };
/** Cancellation is fire-and-forget: a broken transport must not stall cleanup. */
export async function consumeBytes(body: ReadableBody, signal: AbortSignal, wait: <V>(promise: Promise<V>) => Promise<V>, write: (bytes: Uint8Array) => void): Promise<void> {
  const reader = body.getReader();
  let completed = false;
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', cancel, {once:true});
  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const {done,value} = await wait(reader.read());
      if (signal.aborted) throw signal.reason;
      if (done) { completed = true; break; }
      write(value);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!completed) cancel();
    // Some native streams reject releaseLock while their cancelled read settles.
    try { reader.releaseLock(); } catch {}
  }
}
export async function consumeUploadResponse(response: { status: number; body: ReadableBody | null }, signal: AbortSignal, wait: <V>(promise: Promise<V>) => Promise<V>): Promise<{status:number;error?:string}> {
  let raw = ''; let size = 0; const decoder = new TextDecoder();
  if (response.body) await consumeBytes(response.body, signal, wait, bytes => {
    size += bytes.byteLength;
    if (size > 1_048_576) throw new Error('The upload response was too large.');
    raw += decoder.decode(bytes, {stream:true});
  });
  raw += decoder.decode();
  let error: string | undefined;
  try { const value = JSON.parse(raw); if (typeof value?.error === 'string') error=value.error; } catch {}
  return { status: response.status, error };
}
export async function saveDownloadedBody(response: { ok: boolean; body: ReadableBody | null }, signal: AbortSignal, wait: <V>(promise: Promise<V>) => Promise<V>, file: { open(): {writeBytes(bytes:Uint8Array):void;close():void}; remove(): void; uri: string }): Promise<string> {
  if (!response.ok || !response.body) {
    if (response.body) { const reader=response.body.getReader(); void reader.cancel().catch(()=>{}); try {reader.releaseLock();} catch {} }
    throw new Error('The original file could not be downloaded.');
  }
  let handle: ReturnType<typeof file.open> | undefined;
  try {
    handle = file.open();
    await consumeBytes(response.body, signal, wait, bytes => handle!.writeBytes(bytes));
    handle.close(); handle = undefined;
    return file.uri;
  } catch (error) {
    try { handle?.close(); } finally { file.remove(); }
    throw error;
  }
}
