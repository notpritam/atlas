# Public video downloader runtime

`downloadCustomerRemoteMedia(sourceUrl, options)` in `apps/backend/src/customer-remote-media.ts` downloads one public source into a disposable local MP4. It is a callable boundary only: the caller owns processing consent, accounting, durable owner-scoped storage, cancellation on edit/delete, and presentation. It never changes a database or substitutes a transient media CDN URL for the original source.

## Installation

The operator must install a separate Python virtual environment with **yt-dlp 2026.8.19**, without optional dependencies, and explicitly set:

```sh
FOUNDKEEP_MEDIA_PYTHON=/home/pritam/.local/share/foundkeep-media-runtime/yt-dlp-2026.8.19/bin/python
```

The environment is already installed on the development host. For a fresh host, the equivalent installation is:

```sh
python3 -m venv /home/pritam/.local/share/foundkeep-media-runtime/yt-dlp-2026.8.19
/home/pritam/.local/share/foundkeep-media-runtime/yt-dlp-2026.8.19/bin/python -m pip install --no-deps 'yt-dlp==2026.8.19'
```

Python 3.10+ on Linux, `/usr/bin/prlimit`, and `/usr/bin/ffprobe` are required. The path is operator configuration; request input cannot choose an executable, script, downloader arguments, output path, or environment. The module returns `unavailable` when no absolute Python runtime path is configured. The helper rejects a different yt-dlp version for platform extraction. Ship `apps/backend/scripts/customer-remote-media.py` alongside the backend; its path is resolved relative to the TypeScript module. Do not enable production until separate integration and dev verification are complete.

The implementation follows the [yt-dlp embedding and format-selection documentation](https://github.com/yt-dlp/yt-dlp#embedding-yt-dlp) and is pinned to the [2026.08.19 release](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19). Upgrade only with the focused tests and a fresh live platform check, because the request-handler/plugin internals are version-specific.

## Result and cleanup contract

```ts
const result = await downloadCustomerRemoteMedia(sourceUrl, { signal });
if (result.status === 'downloaded') {
  try {
    // Copy result.absolutePath into existing owner-scoped customer-file storage.
    // Preserve result.sourceUrl as the source evidence.
  } finally {
    await result.dispose();
  }
}
```

A successful result includes:

- `absolutePath`: private temporary local file; valid until `dispose()`.
- `sourceUrl`: validated original source, with fragment removed. Never the extracted CDN URL.
- `mime: 'video/mp4'`, actual `bytes`, `sha256` encoded as **base64url**, and probed `durationSeconds`.
- Bounded plain-text `title`, `description`, `author`; these are untrusted source metadata.
- Up to two available VTT subtitle evidence objects (`language`, `automatic`, `text`). Missing subtitles produce an empty array. Automatic platform captions are labelled; no transcript is inferred or generated.
- Idempotent asynchronous `dispose()`, which removes the entire temporary directory.

Failure statuses are `unavailable`, `unsupported`, `too_large`, `cancelled`, `timeout`, or `error`, with a fixed safe `reason`. Extractor errors, signed CDN URLs and raw stderr are not returned. Every unsuccessful path removes temporary artifacts after its subprocess exits. The caller must always dispose success, including failed persistence and cancelled owner operations. This temporary file is not durable storage or a completed save.

Options can only lower the hard limits: 50 MiB file size, 30-minute duration, and 120-second total deadline. A real local ffprobe verifies MP4 structure, H.264 video, optional AAC audio, positive bounded duration and dimensions up to 4096. Missing, empty, malformed, oversized or symlink output is rejected. This validates the container and stream metadata; it does not decode every frame.

## Network and execution boundary

Python runs with `-I`, an allowlisted environment, private temporary HOME/config/cache directories, and no inherited secrets or proxies. The embedded API bypasses CLI configuration. Plugins, cache, browser cookies, cookie files, netrc, remote components, JS runtimes, external downloaders and postprocessors are disabled. Only the stdlib urllib yt-dlp request handler is installed. These restrictions are enforced, including subprocess rejection, rather than relying on CLI defaults.

A permanent [Python audit hook](https://docs.python.org/3/library/audit_events.html) checks the actual numeric destination of every socket connection. It permits only TCP to public IPv4 or global IPv6 addresses on HTTP(S) ports; it rejects Unix sockets, UDP/raw sockets, hostname-based connects, private/metadata addresses, mapped/transition/special IPv6 and socket listening. DNS results are checked in full, including mixed public/private answers, and the actual address is checked again at connection time, preventing DNS rebinding. Address ranges mirror `customer-preview.ts`. Normal system DNS resolution is permitted; it grants no permission to connect to a returned private address.

Initial requests, redirects, CDN requests, format lookups and subtitle requests all remain in this guarded process. URL checks reject non-HTTP(S) protocols and embedded credentials. A failed boundary check never falls back to an unguarded HTTP client, proxy, native transport or executable. The guard assumes the pinned Python/yt-dlp code is trusted; it is not a general sandbox for arbitrary malicious Python code. Do not install third-party request handlers or plugins into this runtime.

Platform reads share a 100 MiB body budget and a 100-request budget. The helper limits virtual memory to 768 MiB, CPU to 60 seconds, file size to the caller's bounded maximum and file descriptors to 64; one fixed video file is written, without sidecars. Subtitles are individually capped at 32 KiB. Parent cancellation/deadline kills the entire process group and waits for it before cleanup. Probe CPU/memory/output are separately bounded. ffprobe uses only the MOV demuxer, disables external MOV data references, and permits only the local `file` protocol under the [FFmpeg protocol whitelist](https://ffmpeg.org/ffmpeg-protocols.html#Protocol-Options), so media cannot trigger decoder network access.

## Current platform limits

Public Instagram, X/Twitter and YouTube sources are passed to their real yt-dlp extractors. Direct public `.mp4` URLs use the guarded streaming HTTP implementation. Other direct URLs can be detected by yt-dlp from their response type. Only one progressive HTTP(S) MP4 is downloaded. Format selection prefers the highest compatible H.264/AAC picture up to a 720p short edge (including portrait video). If only larger formats exist it chooses the closest above that target. Declared sizes and yt-dlp estimates derived from bitrate and source duration must fit the byte budget; a smaller eligible format is chosen when a larger one exceeds it. If every compatible candidate is oversized, the result is `too_large`. Unknown codec metadata is allowed for direct media, with ffprobe providing the final check. Unknown-size formats remain eligible by quality; their size cannot be guaranteed until streaming finishes, and the hard byte limit still applies. No successful download is claimed if that limit is crossed. Playlists, live/upcoming streams, separate video/audio tracks, manifests requiring a downloader/muxer, DRM, unsupported codecs and files outside limits are rejected. No authentication, cookies, anti-bot bypass or platform refusal workaround is attempted.

This stage intentionally has no JavaScript runtime. [YouTube's current EJS requirements](https://github.com/yt-dlp/yt-dlp/wiki/EJS) mean many public YouTube videos will remain unavailable, as will sources offering only separate DASH/HLS media. Availability must be measured with real samples; this boundary does not establish friends-beta platform completeness. Adding confined JS or offline muxing requires another scoped security change.

## Verification

```sh
bun test apps/backend/test/customer-remote-media.test.ts
/home/pritam/.local/share/foundkeep-media-runtime/yt-dlp-2026.8.19/bin/python apps/backend/scripts/test_customer_remote_media.py
bunx tsc --noEmit -p apps/backend/tsconfig.json
```

The Bun tests use a real synthetic MP4 and ffprobe, exercise cleanup and malformed outputs, and kill real timed/cancelled Python processes. Python tests exercise actual audit events, mixed/rebound DNS, redirects, byte budgets, and the real pinned yt-dlp parser with only HTTP transport replaced by a deterministic fixture. A malicious local config/plugin fixture must not execute. A realistic multi-format fixture exercises the pinned yt-dlp format parser, verifies 720p preference, smaller budget fallbacks, bitrate-duration estimates, incompatible codecs/video-only exclusion and unknown-size handling. Live public platform checks are a separate root-owned release gate.
