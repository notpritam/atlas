# Twitter preservation implementation plan

**Goal:** Preserve a selected X post, its available photos/videos and linked article text in private FoundKeep storage, independently of AI processing.

**Architecture:** The capture transaction enqueues a durable, owner-bound preservation job for new X post saves. A bounded worker resolves public post metadata plus validated visible-post hints, stores each successful asset independently, and reports partial failures without losing the original save. Existing authenticated file serving and storage quotas apply to every asset.

**Spec:** `docs/beta/2026-09-14-extension-audit-and-social-media.md`, narrowed by Pritam to Twitter and file saving first.

**Constraints:** Dev only; preserve accounts and data; append-only DB migration; no AI processing requirement, no transcription/embeds in this slice; no cookies or private credentials forwarded to X; source/redirect/address validation; 50 MiB per video, 8 MiB per image, 100 MiB bundle, 8 media items and 3 linked articles maximum. Existing copies remain private even when tweet text is submitted to a collection.

- [x] Public resource reader and X manifest resolver (`customer-public-resource.ts`, `customer-twitter.ts`): public metadata, exact media order, safe URLs, linked articles; fixture and network-boundary tests.
- [x] Durable asset jobs (`customer-preservation.ts`, `customer-preservation-routes.ts`, `db.ts`, `customer.ts`, `index.ts`): source/owner/lease guards, retries and deduplication, incremental quota accounting, cleanup, authenticated range/download endpoints; lifecycle and API tests.
- [x] Extension exact-post hints (`twitter.js`, `background.js`, `db.js`, `cloud.js`): photos and link targets from the selected post only, optional visible long-form body; preserve review, offline queue and account isolation; browser tests.
- [x] Reader status and saved-file access (`preserved-source.tsx`): same component in modal/full-page, local media playback/download and archived articles, live job polling and retry; focused browser verification.
- [x] Test public examples and real dev save; package immutable backend/site releases and dev extension; preserve rollback releases and verify public endpoints.

## Release

Dev backend: `20260914-twitter-preservation-1.7.8`; dev site: `20260914-twitter-preservation-1.7.8-final`; dev extension: **1.7.8**. Previous releases retained. Existing dev records preserved, with a consistent SQLite backup before migration. Production was not changed. See [runtime and verification](../../beta/twitter-preservation.md).
