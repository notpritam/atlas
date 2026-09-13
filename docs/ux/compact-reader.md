# Compact interface and saved readers

Pritam's final reference direction on 13 September 2026 replaces spacious navigation with compact rows, neutral segmented pills, a single clean interface font and pure-black dark mode. The approved Library first information architecture remains in place. No workspace selector or sidebar New note action is added.

- Interface font: locally hosted official Inter variable, with license/source beside the asset. App headings use a restrained scale and weight.
- Dark canvas, sidebar, cards and reader surfaces: `#000000`. Borders, hover and selected states use neutral gray. Light mode uses neutral white surfaces.
- Desktop navigation and primary controls: 36px; outlined navigation icons: 18px. Mobile/coarse controls retain 44–48px targets. Segmented filters show their real labels and available counts.
- Collection cards open the full published snapshot in a keyboard-accessible reader. Original-source navigation is a separate action. Public readers do not fetch private captures.
- Saved panels and full reading pages share a compact icon toolbar, clear title/type/source hierarchy, useful media space and responsive context column. Full prose, media, files, provenance, linked saves, processing information, collection sharing and confirmed deletion remain available.
- Expanded reader controls stay visible during scrolling. Mobile combines the existing hamburger and reader actions in one 56px row.

## Validation and deployment

Code and visual review passed at `15cdcd9`. Site typechecking and separate production-mode builds for the disposable and permanent dev backends passed. Public collection, appearance and sidebar suites passed; the authenticated dashboard regression passed media, note, history/filter/back, scroll restoration, responsive reader and session guard checks.

Final browser verification measured 36px desktop controls, 44px wide-touch source controls, a 56px mobile header, a sticky toolbar at top 0 after 805px scrolling, true-black surfaces across card types and readable dark hover states. There were no browser runtime errors or horizontal overflow at the checked desktop/phone widths.

Dev website release: `20260913-115909-compact-reader`, switched at 2026-09-13T12:00:54Z. Only `foundkeep-site-dev.service` restarted. Existing dev accounts, data, backend and Paddle sandbox were preserved. Previous website release `20260913-105647-android-share` remains available for rollback. Production and native binaries did not receive this visual update.

Open [dashboard](https://dev.foundkeep.app/dashboard) or [demo collection](https://dev.foundkeep.app/collection/demo-design-that-works). Local screenshot and browser evidence: `.impeccable/review/compact-reader/{initial,final,live}/`.
