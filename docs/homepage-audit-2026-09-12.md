# Homepage audit fixes

Scope: first-party application changes for the audit of `https://foundkeep.app/`. Existing styling is preserved. No third-party scripts, TLS, headers or reverse-proxy configuration were changed.

- Informative collection images have descriptive alternatives. Decorative scenery and repeated marks use empty alternatives and explicit `aria-hidden="true"`, so screen readers skip them. A scanner that treats every empty alternative as missing will still flag those intentionally decorative images.
- Touch targets have a 48 × 48 CSS pixel minimum, including mobile navigation, text links, the capture demo, disclosures and footer links.
- Homepage metadata explicitly permits indexing, defines absolute Open Graph and Twitter URLs, uses a large-image Twitter card and includes the existing 1200 × 630 preview image. Organization, WebSite and SoftwareApplication JSON-LD describes the visible product without invented reviews or offers.
- The generated web manifest and existing 180 × 180 Apple icon are linked from the document. This adds install metadata; it does not introduce offline storage or a service worker.
- Landing and account styles load from their relevant routes. Next's documented `experimental.inlineCss` option removes the initial stylesheet request. Initial homepage CSS is approximately 44 KB, down from the audited 116 KB bundle. This option applies globally: styles are also included in the initial React server-component payload, and external stylesheet caching remains preferable for some repeat-visit workloads. Check production builds when changing it; development mode does not inline CSS.
- The reported `0cz1d0mv5g_q7.js` is Next's `nomodule` compatibility polyfill. Chromium does not request it. Application scripts are already asynchronous; the framework polyfill is preserved for compatibility rather than patched in generated output.
- The homepage uses `/api/auth/session`, which returns HTTP 200 with `account: null` for absent, invalid, expired or revoked sessions, and only the account ID for a valid website session. It inherits existing private/no-store handling. `/api/me` remains protected and returns 401 to anonymous requests. Concurrent tab-return events share a pending discovery request.

Validation: `tests/next-home-audit.mjs` checks prerendered metadata, image alternatives, asset dimensions, inline CSS, actual browser requests, touch targets at 320/390/768/1440px, demo/navigation behavior, request deduplication and session transitions. `apps/backend/test/customer.test.ts` covers session discovery and retained authentication boundaries. Existing web, auth and account-page suites cover routes affected by CSS separation.

Deploy the additive backend route before the site release. Use the permanent dev environment for testing; production promotion remains a separate action.
