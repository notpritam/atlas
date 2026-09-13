import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { previewSourceUrl } from './customer-preview.ts';

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_DURATION = 30 * 60;
const MAX_DEADLINE = 120_000;
const HELPER = fileURLToPath(new URL('../scripts/customer-remote-media.py', import.meta.url));
const reasons = {
  unavailable: 'Public video is unavailable without authentication or additional platform support.',
  unsupported: 'This source, stream or video format is not supported.',
  too_large: 'The video exceeds the download size limit.',
  cancelled: 'The video download was cancelled.',
  timeout: 'The video download exceeded its time limit.',
  error: 'The video could not be safely downloaded and validated.',
} as const;
type FailureStatus = keyof typeof reasons;
export type RemoteMediaSubtitle = { language: string; automatic: boolean; text: string };
export type RemoteMediaResult = { status: FailureStatus; reason: string } | {
  status: 'downloaded'; absolutePath: string; sourceUrl: string; mime: 'video/mp4';
  bytes: number; /** SHA-256 digest encoded as base64url. */ sha256: string; durationSeconds: number;
  title: string; description: string; author: string; subtitles: RemoteMediaSubtitle[];
  /** Caller must dispose in a finally block after copying into owner-scoped storage. */
  dispose(): Promise<void>;
};
export type RemoteMediaOptions = { signal?: AbortSignal; maxBytes?: number; maxDurationSeconds?: number; deadlineMs?: number };
export type RemoteMediaProcess = { executable: string; args: string[]; cwd: string; stdin: string };
export type RemoteMediaRunner = (spec: RemoteMediaProcess, signal: AbortSignal) => Promise<string>;

/** External process boundary. Callers cannot supply executable/arguments via download options. */
export const runRemoteMediaProcess: RemoteMediaRunner = async (spec, signal) => {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(spec.executable, spec.args, {
      cwd: spec.cwd, detached: true, shell: false, stdio: ['pipe', 'pipe', 'ignore'],
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: spec.cwd, XDG_CONFIG_HOME: spec.cwd, XDG_CACHE_HOME: spec.cwd, TMPDIR: spec.cwd, OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1' },
    });
    let failure: Error | undefined;
    let size = 0;
    const chunks: Buffer[] = [];
    const kill = () => {
      if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    };
    const abort = () => { failure = new Error('Aborted'); kill(); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 256 * 1024) { failure = new Error('Process output limit'); kill(); }
      else chunks.push(chunk);
    });
    child.stdin.on('error', () => {});
    child.on('error', error => { failure = error; });
    child.on('close', code => {
      signal.removeEventListener('abort', abort);
      if (failure || code !== 0) reject(failure || new Error('Media process failed'));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    child.stdin.end(spec.stdin);
  });
};

function bounded(value: number | undefined, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(Math.floor(value), maximum)) : maximum;
}
function text(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, maximum) : '';
}
function failure(status: FailureStatus): RemoteMediaResult { return { status, reason: reasons[status] }; }

/** One public source -> one disposable, probed MP4. Does not persist or replace source evidence. */
export async function downloadCustomerRemoteMedia(
  rawUrl: string, options: RemoteMediaOptions = {},
  dependencies: { runExtractor?: RemoteMediaRunner } = {},
): Promise<RemoteMediaResult> {
  const source = previewSourceUrl(rawUrl);
  if (!source) return failure('unsupported');
  if (options.signal?.aborted) return failure('cancelled');
  const python = process.env.FOUNDKEEP_MEDIA_PYTHON;
  if ((!python || !isAbsolute(python)) && !dependencies.runExtractor) return failure('unavailable');
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, bounded(options.deadlineMs, MAX_DEADLINE));
  const maxBytes = bounded(options.maxBytes, MAX_BYTES);
  const maxDuration = bounded(options.maxDurationSeconds, MAX_DURATION);
  let directory: string | undefined;
  let keep = false;
  try {
    directory = await mkdtemp(join(tmpdir(), 'foundkeep-remote-media-'));
    const output = await (dependencies.runExtractor || runRemoteMediaProcess)({
      executable: python || '/usr/bin/python3', args: ['-I', HELPER], cwd: directory,
      stdin: JSON.stringify({ url: source.href, maxBytes, maxDurationSeconds: maxDuration }),
    }, controller.signal);
    controller.signal.throwIfAborted();
    if (Buffer.byteLength(output) > 256 * 1024) return failure('error');
    const metadata = JSON.parse(output);
    if (!metadata || typeof metadata !== 'object') return failure('error');
    if (metadata.status !== 'downloaded') {
      return failure(['unavailable', 'unsupported', 'too_large'].includes(metadata.status) ? metadata.status : 'error');
    }
    const absolutePath = join(directory, 'video.mp4');
    const file = await lstat(absolutePath);
    if (!file.isFile() || file.isSymbolicLink() || !file.size) return failure('error');
    if (file.size > maxBytes) return failure('too_large');
    const bytes = await readFile(absolutePath);
    if (bytes.length !== file.size || bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp') return failure('error');
    // Only the MOV demuxer and local file protocol are enabled; external data
    // references are disabled. No network-capable protocols reach ffprobe.
    const probe = JSON.parse(await runRemoteMediaProcess({
      executable: '/usr/bin/prlimit', args: ['--as=536870912', '--cpu=15', '--fsize=1048576', '--nofile=32', '--', '/usr/bin/ffprobe', '-v', 'error', '-threads', '1', '-protocol_whitelist', 'file', '-f', 'mov', '-enable_drefs', '0', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', absolutePath],
      cwd: directory, stdin: '',
    }, controller.signal));
    const durationSeconds = Number(probe.format?.duration);
    const streams: Record<string, unknown>[] = Array.isArray(probe.streams) ? probe.streams : [];
    const video = streams.find(stream => stream.codec_type === 'video');
    if (!video || video.codec_name !== 'h264' || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > maxDuration
      || Number(video.width) < 1 || Number(video.height) < 1 || Number(video.width) > 4096 || Number(video.height) > 4096
      || streams.some(stream => stream.codec_type === 'audio' && stream.codec_name !== 'aac')) return failure('unsupported');
    const subtitles: RemoteMediaSubtitle[] = (Array.isArray(metadata.subtitles) ? metadata.subtitles.slice(0, 2) : []).flatMap((item: any) => {
      const language = text(item?.language, 32);
      const body = text(item?.text, 32_000);
      return language && body ? [{ language, text: body, automatic: item.automatic === true }] : [];
    });
    controller.signal.throwIfAborted();
    const temporary = directory;
    keep = true;
    return { status: 'downloaded', absolutePath, sourceUrl: source.href, mime: 'video/mp4', bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('base64url'), durationSeconds,
      title: text(metadata.title, 500), description: text(metadata.description, 16_000), author: text(metadata.author, 300), subtitles,
      dispose: () => rm(temporary, { recursive: true, force: true }),
    };
  } catch {
    return failure(options.signal?.aborted ? 'cancelled' : timedOut ? 'timeout' : 'error');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    if (directory && !keep) await rm(directory, { recursive: true, force: true });
  }
}
