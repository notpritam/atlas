# Public collections — September 13, 2026

The user requested a more considered public collection experience and a populated permanent dev environment. The latest direction uses compact controls, Inter typography and true-black dark surfaces while preserving account, sharing, moderation, privacy, group, and extension boundaries. Public browsing is an Operate/Read surface: find a useful save, open its full published context, then optionally visit the original source or contribute.

The full-width introduction contains the title, description, curator identity, real counts and follow/share actions. The default feed uses dashboard-style masonry with natural image and note heights; list view is available. Topic and layout controls use neutral rounded rails with inset selected pills. Contribution rules are collapsed below the introduction. Card images, titles and bodies open a complete published-snapshot reader; the separate source icon opens the original website. The dialog preserves keyboard focus, Escape dismissal and mobile scrolling without requesting private capture data. Explore retains responsive cards, search and honest empty states.

Latest density and reader implementation: [compact interface](../compact-reader.md). Prior screenshots below document the earlier iteration; current local evidence is in `.impeccable/review/compact-reader/live/`.

Search and exact topic filtering run across permitted entries before pagination. Anonymous visitors cannot see pending/private entries, counts, or tags. Server-rendered reading and GET search work without JavaScript. Clipboard denial exposes a selectable link. Mutations retain their account guard; refresh preserves loaded pages.

## Verification

- Next production build and TypeScript passed against disposable and dev backend configurations.
- Backend collection suite: 9 tests, 175 assertions; queries, exact tags, escaping, pagination, private visibility, and pending-entry boundaries.
- Collection browser suites: 5 tests covering publication, following, approvals, privacy revocation, selective capture sharing, refresh, account changes, Pro group membership/moves, searching 27 entries, list/grid switching, clipboard fallback, no-JS search, responsive targets, and mobile form focus.
- Sidebar browser regressions: 2 tests passed.
- Seed guard and integration checks passed, including preserved edits, deletions, moderation, and unfollows. Read-only review resolved the credential-directory finding and reported no remaining material findings.
- Inspected desktop, tablet, and phone screenshots; overflow checks included 320px. Reduced motion and server-rendered content were checked. Native iOS was not exercised in this web task.

Evidence: [Explore desktop](explore-desktop.png), [Explore mobile](explore-mobile.png), [collection desktop](collection-desktop.png), [tablet](collection-tablet.png), [mobile](collection-mobile.png), [grid](collection-grid.png). These were captured against a disposable backend. See [demo setup](../../DEV_DEMO.md) and `deployment.json` for the permanent dev release.
