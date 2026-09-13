# FoundKeep sidebar: Library first

Selected direction: **Library first**, with Pritam's refinements on 2026-09-13. Mode: Operate. Pritam approved applying this direction to the live dashboard. The design previews retain sample content; the dashboard uses the existing authenticated APIs.

## Current design

- Use the spelling **FoundKeep** and smaller logo text: 18px on desktop/tablet, 17px inside the mobile drawer. Preserve the canonical bookmark artwork.
- Remove workspaces entirely. FoundKeep does not offer workspaces; personal and group sharing use collections.
- On desktop, the logo in the collapsed 76px rail reopens navigation while preserving the current page. Show one collapse control while expanded.
- On mobile, the closed header has a **hamburger** opener and **no logo or wordmark**, leaving more room. The FoundKeep logo remains inside the open drawer. The single collapse control, Escape and backdrop click close the drawer and restore focus to the hamburger.
- Retain white surfaces, blue active rows, New note only in the library header, visible collections, separated account tools, and a quiet plan link above the account.

The expanded sidebar is 286px, becoming 250px on tablet. The mobile drawer is up to 330px wide. Background content is inert and scrolling is locked while the drawer is open. All main destinations remain reachable, including on short screens. Keep keyboard focus containment, account menus and reduced-motion support.

The final mobile direction supersedes the earlier logo-only opener and the intermediate sidebar-icon-plus-logo header.

## Preview and authoring

- Device controls: https://dev.foundkeep.app/design/sidebar-options.html
- Full-size responsive preview: https://dev.foundkeep.app/design/library-first.html

`surface.html` and `gallery.html` are authoring templates. Run `node docs/ux/sidebar-options/build.mjs` to embed shared assets into `library-first.html` and `explore.html`. The website public files link to these artifacts; packaging dereferences the links. `original-options.html` and earlier PNGs retain historical alternatives.

Preview notes and routes use synthetic data. The real implementation shares the collection manager and plan caches, showing owned, joined and followed collections with their current visibility. Collection errors have a retry; unresolved plans never imply Free. Account settings, privacy and confirmed account switching remain reachable. There are no workspace APIs. Use the permanent dev environment for testing and keep production separate.

## Evidence

The verification JSON files and PNGs record each revision. `deployment.json` records the active dev release, public verification, and previous release retained for rollback. The latest `mobile-hamburger-*` evidence covers the hamburger-only closed mobile header, open drawer, focus restoration, and preserved desktop behavior.

## Dashboard implementation

The shared React Sidebar serves the library, reader, collections and account pages. All rows and controls have at least 48px touch targets. Desktop collapse uses the existing stored preference and GSAP movement; reduced motion disables movement. Mobile navigation keeps its pending feedback visible until the destination commits, then closes the drawer and restores background interaction. Escape is handled only by the active sidebar layer, preserving an open reader. At 761–1000px the reader uses the main area until closed.

The browser regression tests run on a disposable local backend. `dashboard-verification.json` records the final checks and `dashboard-deployment.json` records the web-only dev release. The earlier `deployment.json` and mobile-hamburger evidence describe the prototype releases.
