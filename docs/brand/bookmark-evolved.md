# Bookmark Evolved

Selected by Pritam on 2026-09-13 from [concept A](icon-exploration-2026-09-12/a-bookmark.png).

The production vector preserves the concept's softened paper bookmark, shallow notch, folded upper-right corner, red dot, and charcoal tile. Small-size assets use solid fills for clear edges.

## Source and exports

Edit `apps/web/assets/mark.svg`, then run `bun run brand:assets`. This regenerates the website's `studio-mark.svg` compatibility alias, extension SVG and 16/32/48/128px toolbar icons, web 192/512px icons, 512px maskable icon, 180px Apple touch icon, and mobile mark, app icon, and splash image. Individual groups can be rendered with `node scripts/render-brand-assets.mjs web`, `extension`, or `mobile`.

The mobile app and iOS share extension both consume `apps/mobile/assets/images/mark.png`. The app icon, Apple touch icon, and maskable web icon have opaque square backgrounds so the operating system supplies the corner mask. Other PNG marks retain transparent outer corners for light and dark interfaces.

Web references use `?v=bookmark-evolved-1` to refresh previously cached brand assets. Update that revision when changing this identity again.

Generate environment-specific extension packages with `bun run extension:build:dev` and `bun run extension:build:prod`. Deploy the website and dev extension downloads to the existing dev environment. Mobile app icons require a new native build; source asset changes do not update an already installed app.

## Dev deployment

Deployed and verified at https://dev.foundkeep.app on 2026-09-13. The dev extension download contains the updated icons. Website build and six extension packaging/environment checks passed. Dashboard rendering was verified with a disposable local account; existing dev accounts and data were preserved. Production promotion and native mobile distribution remain separate.
