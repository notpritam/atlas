# Twitter / X source preservation

The 1.7.8 dev extension and backend preserve individual X posts independently of AI organization. A new private save of an X status permalink queues a durable preservation job. This applies to the extension, web/mobile capture API, new bookmark imports and MCP-created saves. Existing saves offer **Save source files** in the reader. Local-only extension saves stay local; server preservation starts when a copy is saved to the connected account.

## What is kept

- Tweet text, author, publication time when exposed, and the original permalink in a downloadable text archive. Longer text captured from the selected post is retained.
- The post's own available photos and progressive MP4 video variants, including animations exposed as MP4. Quoted-post media is excluded.
- Readable text from up to three linked articles. A metadata-only or truncated teaser is not reported as a complete article. The original link remains available when the publisher does not expose its body.
- Visible X Article text when the extension can associate its article element with the selected tweet. Standalone X Article pages, entire threads and replies are not a completeness guarantee.

The worker resolves X's public syndication metadata using the same public embed-token calculation as [yt-dlp's Twitter extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitter.py). It passes selected video variants to the existing pinned yt-dlp/ffprobe boundary described in [media-runtime.md](media-runtime.md). Image downloads use a DNS-pinned, bounded public reader. No browser cookies or account credentials are forwarded to X or publishers. No third-party download service is required.

## Access, state and storage

The normal destination review remains mandatory. A private server copy belongs to the connected account even if selected text is also submitted to a collection; assets are never included in public collection responses.

`customer_preservation_jobs` stores owner, source, validated browser context, lease and retry state. `customer_media_assets` stores each archive/file independently with its hash, byte count and source. Completed copies survive a partial failure and are not downloaded again on retry. A restarted worker reclaims expired leases; commits recheck the owner, source and lease. Deleting a save/account removes its jobs and files, while the existing orphan sweeper handles abandoned staging files.

The reader and extension sidebar show pending/running, ready, partial or failed state. Users can retry missing files, read saved articles, view photos, play a private stored video, and download copies. The sidebar retrieves bounded file chunks through the existing account-bound background connection and revokes local blob URLs when leaving the item.

Cookie-only browser asset endpoints and authenticated mobile/extension asset endpoints check capture and asset ownership. Binary responses support byte ranges, private/no-store caching and attachment downloads. The current paths are `/api/captures/:id/preservation`, `/api/captures/:id/assets/:asset`, with corresponding `/api/mobile/captures/...` paths. POST to preservation accepts only an empty object and queues or retries a job.

Preservation is available on Free and Pro within their existing storage quotas, with no AI credit charge. Limits are 50 MiB per video, 8 MiB per image, 100 MiB per post bundle, eight media items, three linked articles and 210 seconds per attempt. The downloader can only lower its existing limits. Unsupported, deleted, gated, oversized or unavailable sources remain explicitly partial/unavailable. Downloads use useful bounded video renditions, not a promise of the highest-resolution original. No generated transcription or third-party embeds are added in this slice.

## Verification

Run the backend suite, extension suite, type checks and site build, then use the built dev extension for:

```sh
FOUNDKEEP_ALLOW_DEV_TEST=1 CHROMIUM_PATH=/path/to/chromium \
  node --test tests/next-twitter-preservation.mjs
```

This deliberately targets only dev, creates and deletes its own temporary account, saves a real video through the native sidebar review, checks server hashes/ranges/downloads, plays it in the sidebar and web reader, preserves two photos and a readable linked NASA article, and checks the dev MCP server name. The X page DOM is a controlled fixture; media resolution/downloads and the app/account API are real. A logged-in X session is still needed for manual testing of X's current live DOM.

Public examples verified on 2026-09-14:

- [Video](https://x.com/captainamerica/status/719944021058060289): 537,709-byte MP4.
- [Two photos](https://x.com/NASA/status/2040468080686424396): 447,912 and 467,868 bytes.
- [Photo and linked article](https://x.com/NASA/status/1583474732749697026): the publisher exposes over 12,000 characters of readable article text.
- [Photo with a limited blog preview](https://x.com/NASA/status/1735036375630545220): photo preserved; Tumblr's truncated teaser is treated as metadata-only.

Availability can change upstream. These checks establish this dev slice, not completeness for Instagram, YouTube, LinkedIn or Reddit.

## Dev release

- Backend: `/home/pritam/.local/share/foundkeep-backend/releases/20260914-twitter-preservation-1.7.8` (source hashes recorded in `release.json`). The previous backend dependency manifest is unchanged; its verified dependency tree and pinned Python runtime are reused.
- Site: `/home/pritam/.local/share/foundkeep-site-dev/releases/20260914-twitter-preservation-1.7.8-final`.
- Extension: [FoundKeep Dev 1.7.8](https://dev.foundkeep.app/ext/foundkeep-extension-dev-1.7.8.zip), SHA-256 `134d33fd772fb3bf33b5f89b08d1949fd4f67b281b20f8bfb466a56e731a83d7`.
- Rollback: previous site `20260914-auto-connect-1.7.4`, static downloads `20260914-entry-audit-1.7.7`, backend `20260913-141918-remote-media-ebe9e2e`. The old backend service drop-in is retained beside the current file as `foundkeep-media-release.conf.before-twitter-1.7.8`; it is not loaded by systemd. The migration is additive; preserve the new tables and saved files if rolling back application code.
- Existing dev data was backed up with SQLite's online backup API before migration. The original five accounts and 22 saves were retained. Automated live checks create/delete only their temporary accounts.
- Dev Agent connections now generate the MCP server name `foundkeep-dev`; production keeps `foundkeep`. Credentials are still generated per connection and never hardcoded into the app.


## Library previews (1.7.12)

Library and mobile capture DTOs now include bounded `preservedMedia` metadata:
status, photo/video counts, up to four owned media URLs, and a 480-character
post excerpt. MCP reads use the same metadata selection. Original files, private
filesystem paths and complete post/article bodies are not included in cards.
The authenticated preview endpoint can serve the first preserved photo, so
already-downloaded saves work without a new preservation job.

Dashboard cards show a compact media grid, photo/video counts, and personal
and generated tags. Saved video previews are lazy, muted and paused; playback
remains in the reader. The library polls every three seconds while visible
saves have pending/running preservation, returning to its usual interval when
finished. Reader preservation updates also invalidate the associated card and
item query. Retry sends the normal JSON object through the shared API helper.

`customer-preservation-routes.test.ts` checks pending-to-ready card metadata,
owned image bytes, web/mobile parity, preview bounds and account isolation.
`tests/next-library-media.mjs` checks real photo/video saves appearing without a
page reload, private URLs, tags, dark mode, narrow screens and opening the
corresponding reader. It creates and removes its own temporary dev account and
requires `FOUNDKEEP_ALLOW_DEV_TEST=1`.

Backend/site dev release: `20260914-library-media-1.7.12`. Preserve the prior
`20260914-mcp-parity-1.7.11` releases for rollback. No database migration or
extension/mobile binary update is required for this web fix.
