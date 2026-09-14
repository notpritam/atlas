# Extension audit and social preservation handoff — 14 September 2026

This pass audits the extension entry points and appearance before the next social media / embedding implementation. Extension changes ship as 1.7.7 to dev. Backend/media findings below describe existing behavior, not newly shipped platform support. Production remains on its existing release.

## Entry points

| Entry | Finding / final behavior | Evidence |
| --- | --- | --- |
| Chrome toolbar | Opens Chrome's native sidebar, no popup | `tests/extension-action.mjs` checks native target and toolbar configuration |
| Sidebar page, highlight, region, full page | All stage the common destination review before capture | `sidebar-capture.js`, `save-review.js`; native action/destination and capture-engine tests |
| Sidebar note | Review before writing; draft remains on cancellation/error | Native action test and `extension-library.mjs` |
| X/Twitter post button | Exact post text/author/permalink; native destination review; Cancel writes nothing | Actual content-script/native-sidebar test in `extension-destination.mjs` |
| Right-click page, selection, link, image, region, full page | Shared review; image-host access moved to the final submit gesture | `background.js` context-menu handler, `sidebar-destination.js`; handler audited in source |
| Keyboard highlight / screenshots | Same review; page identity checked again at confirmation | `background.js` command handler; source audit plus screenshot/highlight engine tests |
| Retained popup / old local-library tabs | Previously saved immediately. Visible capture and note actions now open the same sidebar review, retaining drafts | Actual old-library → native-sidebar test plus UI tests |
| Bookmark import | Existing explicit import preview, preserves folders/dates; no per-item prompt during a batch | Bookmark/library import tests |
| Local historical import | Still requires explicit account-specific confirmation | Cloud/UI tests |
| Existing save added to collection | Existing audience/fields review; private note text is not automatically copied | `extension-collections.mjs` |

The low-level `capture`/`saveNote` compatibility messages remain for existing integrations/capture-engine tests, but are now restricted to packaged FoundKeep UI senders. New visible UI actions use review messages. This is not a claim that every legacy internal message enforces a destination.

Fixed page identity checking across capture triggers so navigating after opening a review cannot silently extract a different page. Exact tweet payloads and standalone notes do not depend on the page remaining open.

## Appearance

- All packaged extension screens consume one light/dark token set in `theme.css` and the same self-hosted Inter font as the website. Removed the popup's separate orange palette and dark-only local-library styling.
- Sidebar Settings has System, Light and Dark. The choice persists in extension-local storage and updates open views without reloading. System follows device changes. Dev/prod retain independent preferences.
- Primary controls, hover, selection, focus, forms, collection review/error states and scrollbars use semantic tokens. Badge success uses platform green. The shared brand mark is retained.
- X's injected button chooses the green shade from the actual post text appearance, since X can use a different theme from the device. Reduced-motion users do not receive the button transition.
- Native tests verify explicit dark overrides a light OS and System responds live. Narrow sidebar tests check 320px layout and no horizontal overflow. Light and dark library screens were visually inspected together.
- This is a targeted appearance/entry-point audit, not a full WCAG certification. Native browser context menus and keyboard invocation were source-reviewed; the test harness exercises their shared capture engine and destination flow separately.

## What media processing already does

`customer-remote-media.ts`, `customer-remote-media.py`, `customer-remote-preservation.ts` and `customer-processing.ts` already use isolated, pinned yt-dlp 2026.08.19 to resolve and download one public progressive HTTP MP4. Content validation includes codec/container probing, byte/duration/time limits, network destination checks, private file storage, ownership, quotas, cancellation and cleanup. Downloaded bytes are served from FoundKeep through authenticated range-capable file endpoints.

The downloader can preserve supplied VTT captions (up to two tracks). PDF extraction, video preview frames and smaller MP4 derivatives already exist. Supplied captions are different from running a speech-recognition model.

Current constraints:

- Preservation is inside Pro managed processing, requires enabled processing, public-link consent, credits and a configured AI provider. A provider failure can roll back the staged video.
- One original file per save; no ordered multi-image/mixed-media gallery.
- No installed speech-to-text stage for videos without captions.
- Progressive MP4 only; no independently fetched video/audio merge, no HLS/DASH download and no YouTube EJS runtime. This sharply limits real YouTube coverage.
- X, Instagram and YouTube have explicit source classification. Reddit and LinkedIn currently fall back to generic web extraction and are not explicit media candidates unless page metadata indicates video.
- Only X has an injected per-post save button. The generic Save page/highlight/link entry works elsewhere; it does not guarantee selection of the intended post in a feed.

Do not label this current state as complete social-media support or claim every public URL downloads. Existing mock/fixture tests do not demonstrate live availability across platforms.

## Maintained open-source components

Research sources, checked 14 September 2026:

- [yt-dlp](https://github.com/yt-dlp/yt-dlp): retain for video resolution, formats and supplied subtitles. Its [supported-site list](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) contains Twitter, Instagram, YouTube, Reddit and LinkedIn extractors. The project explicitly says extractor presence is not a guarantee that a particular URL works. Full YouTube support additionally needs yt-dlp-ejs and a supported JS runtime; separate audio/video needs ffmpeg.
- [gallery-dl supported sites](https://github.com/mikf/gallery-dl/blob/master/docs/supportedsites.md): candidate for ordered image/post galleries on Instagram, Twitter and Reddit. Its list describes authentication dependencies for some platforms; it is not a universal public-image API. LinkedIn is absent from that list and needs its own public-post/visible-post adapter.
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper): candidate for locally generated speech transcripts, language detection and timestamps; CPU INT8 and voice-activity filtering are supported. Model/runtime resources and latency must be measured on our worker before selecting a default model.

Pin reviewed dependencies and ship isolated workers. Do not invoke a general shell command, enable arbitrary downloader plugins or forward browser cookies as a shortcut.

## Next implementation: one post → a durable bundle

The requested next phase should use a shared pipeline for extension, web and mobile saves:

1. Save the selected destination and exact post text, author, permalink and capture time immediately. Capture only the selected post, not neighboring feed cards or comments unless explicitly selected.
2. Enqueue a durable preservation job, independently of AI organization. Retain the existing original text even if a source is unavailable. Revalidate owner, deletion/revision, storage quota and source on every retry.
3. Resolve an ordered media manifest through platform adapters. Use yt-dlp for video and gallery-dl / public metadata for images, with visible-post attachment hints from the extension where appropriate. Deduplicate attachments by content hash. Validate every download and redirect using the existing network boundary.
4. Store multiple private `media assets` per capture (kind, order, original source, MIME, bytes, hash, dimensions/duration, local storage key, status). Include original video, photos, poster/preview and subtitle files as separate assets; keep old single-file captures compatible.
5. Prefer supplied captions. Where none exist, extract bounded local audio and run speech transcription offline. Store timed segments, language and `supplied` versus `generated` provenance. Video/audio merging operates only on already validated local files.
6. Expose independent states: queued, downloading, saved, partially saved, unavailable, retryable failure, transcribing, ready. Saving text, media preservation and AI organization must not report one misleading combined success.
7. Render shared photo-gallery, local-video and timed-transcript components in the rounded note modal/full page. Playback/download should use FoundKeep's authenticated storage endpoint. Keep Open original as a separate action.
8. Public/shared collections receive only explicitly reviewed assets and fields. A private capture bundle must not become public merely because its text was submitted to a collection.

| Platform | Intended post bundle | Specific remaining work |
| --- | --- | --- |
| X/Twitter | Text, author, permalink, every selected-post photo, video/GIF clip | Media hints in existing per-post capture; gallery and multiple-video handling |
| Instagram | Caption, author, permalink, ordered carousel images/videos or Reel | Exact-post capture; gallery adapter; clear unavailable state for non-public sources |
| YouTube | Title/description/channel, actual video, supplied or generated transcript | Isolated EJS support, guarded adaptive downloads/merge, STT, timed reader |
| Reddit | Post text, author/subreddit, permalink, image gallery/native video | Explicit classification, selected-post capture, gallery and split audio/video support |
| LinkedIn | Exact post text/author/permalink, public or visible-post media | Dedicated post capture/metadata adapter; verify live video extractor behavior |
| Articles | Readable text, author/date/source, selected article images | Preserve relevant body images rather than tracking/decorative assets |

Plan availability for automatic preservation (Free + Pro versus Pro-only) is a product question sent to Pritam during the audit; no billing entitlement was changed in this pass. Storage, duration and monthly transcription limits should be explicit whichever entitlement is selected.

## Acceptance checks before the social phase is called ready

Use controlled public samples for text, single photo, carousel, video-with-audio, silent video and captions on each platform. Also cover deleted/gated sources, unsafe redirects, oversized content, retry after worker restart, duplicates, account changes, edits/deletion during processing, quota exhaustion and collection visibility changes. Verify saved files play after the original source is unavailable and generated transcripts have useful timestamps. Test dev with disposable owned accounts, preserve demo/customer data, then request/perform production promotion only under the release instructions.

## Verification of extension 1.7.7

- Full extension suite: 78 passed (includes environment isolation, durable queues, actual captures, destination review, image permission timing/denial, and theme persistence).
- Exact packaged dev build in headed Chromium/Xvfb: 2 native sidebar/X destination tests passed.
- Live `https://dev.foundkeep.app`: disposable-account test passed for automatic pairing, folder delivery, private collection field review, route/focus deduplication, account-switch confirmation and explicit disconnect. Temporary accounts were removed by the test. Existing accounts/data were preserved.
- Shared light/dark library renders were inspected; no further visual iterations were required. `git diff --check` passed.

These checks validate the extension pass. They do not validate the future media pipeline against live social-platform URLs.
