import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadCustomerRemoteMedia, runRemoteMediaProcess, type RemoteMediaRunner } from '../src/customer-remote-media.ts';

let directory: string;
let fixture: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'foundkeep-remote-test-'));
  fixture = join(directory, 'fixture.mp4');
  const process = Bun.spawn(['/usr/bin/ffmpeg', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=96x64:rate=5', '-t', '1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', fixture], { stdout: 'ignore', stderr: 'ignore' });
  expect(await process.exited).toBe(0);
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

const downloaded: RemoteMediaRunner = async ({ cwd }) => {
  await copyFile(fixture, join(cwd, 'video.mp4'));
  return JSON.stringify({ status: 'downloaded', title: '<b>Public video</b>\u0000', description: 'Caption\r\nline', author: 'Alice', subtitles: [{ language: 'en', automatic: false, text: 'WEBVTT\n\n00:00.000 --> 00:01.000\nHello' }] });
};

test('returns an actual probed MP4, hash, source evidence and idempotent cleanup', async () => {
  const result = await downloadCustomerRemoteMedia('https://www.youtube.com/watch?v=test', {}, { runExtractor: downloaded });
  expect(result.status).toBe('downloaded');
  if (result.status !== 'downloaded') return;
  const bytes = await readFile(result.absolutePath);
  expect(result.mime).toBe('video/mp4');
  expect(result.bytes).toBe(bytes.length);
  expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('base64url'));
  expect(result.sourceUrl).toBe('https://www.youtube.com/watch?v=test');
  expect(result.title).toBe('Public video');
  expect(result.subtitles[0]?.text).toContain('Hello');
  expect(result.durationSeconds).toBe(1);
  await result.dispose();
  await result.dispose();
  expect(await Bun.file(result.absolutePath).exists()).toBe(false);
});

test('rejects malformed output bytes and cleans all temporary artifacts', async () => {
  let temporary = '';
  const result = await downloadCustomerRemoteMedia('https://example.com/video.mp4', {}, { runExtractor: async ({ cwd }) => {
    temporary = cwd;
    await writeFile(join(cwd, 'video.mp4'), 'not an mp4');
    await writeFile(join(cwd, 'video.part'), 'partial');
    return '{"status":"downloaded"}';
  } });
  expect(result.status).toBe('error');
  expect(await readdir(temporary).catch(() => null)).toBe(null);
});

test('rejects oversized files even when the extractor claims success', async () => {
  const result = await downloadCustomerRemoteMedia('https://example.com/video.mp4', { maxBytes: 32 }, { runExtractor: downloaded });
  expect(result.status).toBe('too_large');
});

test('rejects symlink output and invalid extractor JSON', async () => {
  const { symlink } = await import('node:fs/promises');
  expect((await downloadCustomerRemoteMedia('https://example.com/video.mp4', {}, { runExtractor: async ({ cwd }) => {
    await symlink(fixture, join(cwd, 'video.mp4'));
    return '{"status":"downloaded"}';
  } })).status).toBe('error');
  expect((await downloadCustomerRemoteMedia('https://example.com/video.mp4', {}, { runExtractor: async () => 'not JSON' })).status).toBe('error');
});

test('initial unsafe sources never reach an extractor', async () => {
  for (const url of ['http://127.1/video.mp4', 'http://169.254.169.254/video.mp4', 'https://[::ffff:127.0.0.1]/v.mp4', 'file:///etc/passwd', 'https://user:password@example.com/video.mp4', 'https://example.com:444/video.mp4']) {
    const result = await downloadCustomerRemoteMedia(url, {}, { runExtractor: async () => { throw new Error('must not run'); } });
    expect(result.status).toBe('unsupported');
  }
});

test('retains explicit unavailability without exposing extractor errors or CDN URLs', async () => {
  const result = await downloadCustomerRemoteMedia('https://x.com/alice/status/123', {}, { runExtractor: async () => JSON.stringify({ status: 'unavailable', message: 'secret-cdn-url' }) });
  expect(result).toEqual({ status: 'unavailable', reason: 'Public video is unavailable without authentication or additional platform support.' });
});

test('cancel and timeout kill the real child and clean partial files', async () => {
  for (const cancelled of [true, false]) {
    const controller = new AbortController();
    let temporary = '';
    const result = await downloadCustomerRemoteMedia('https://example.com/video.mp4', { signal: controller.signal, deadlineMs: cancelled ? 5_000 : 100 }, { runExtractor: async (spec, signal) => {
      temporary = spec.cwd;
      if (cancelled) setTimeout(() => controller.abort(), 100);
      return runRemoteMediaProcess({ ...spec, executable: '/usr/bin/python3', args: ['-I', '-c', 'import time; open("video.part","w").write("partial"); time.sleep(30)'] }, signal);
    } });
    expect(result.status).toBe(cancelled ? 'cancelled' : 'timeout');
    expect(await readdir(temporary).catch(() => null)).toBe(null);
  }
});

test('process runner isolates configuration and caps stdout', async () => {
  process.env.FOUNDKEEP_REMOTE_TEST_SECRET = 'do-not-inherit';
  const spec = { executable: '/usr/bin/python3', args: ['-I', '-c', 'import os,json; print(json.dumps(dict(os.environ)))'], cwd: directory, stdin: '' };
  try {
    const env = JSON.parse(await runRemoteMediaProcess(spec, new AbortController().signal));
    expect(env.FOUNDKEEP_REMOTE_TEST_SECRET).toBeUndefined();
    expect(env.HTTP_PROXY).toBeUndefined();
    expect(env.HOME).toBe(directory);
    expect(env.PYTHONPATH).toBeUndefined();
    await expect(runRemoteMediaProcess({ ...spec, args: ['-I', '-c', 'print("x" * 300000)'] }, new AbortController().signal)).rejects.toThrow();
  } finally { delete process.env.FOUNDKEEP_REMOTE_TEST_SECRET; }
});
