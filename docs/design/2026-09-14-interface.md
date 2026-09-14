# FoundKeep interface conventions

- Display name: FoundKeep, including page metadata, auth, extension and mobile labels. Lowercase URLs and installed app identities remain stable.
- Typography: self-hosted Inter variable, one `--fk-font-sans` family for marketing, auth, the dashboard, and public collections. Heading weight 550, body/control weight 400–500.
- Colors: `appearance.css` owns paper, surface, ink, muted, line, accent and on-accent values for light and dark. Collection controls consume these same tokens.
- Shapes: shared control, card and dialog radii are 10, 20 and 24px. Captures float in a native dialog, preserve the library underneath, and can expand to their saved route.
- Navigation: dashboard layout owns the persistent sidebar, session, query cache and shared dialogs. Pages receive authenticated server data. URL parameters own library searches and collection filters; browser history remains functional. Auth entry establishes a protected document; navigation inside the dashboard stays client-side.
- Filtering: `SegmentedControl` is shared by Library, owned collections, collection sections, public topics and discovery.
- Public collection search, view controls and topics stay together below the sticky header. The header height is measured for responsive layouts; changing topics preserves the scroll position.
- Pricing: landing and account plans share `PlanCard` and `PlanHighlights`. Matching storage, processing and collection rows explain Free versus Pro; Pro uses a distinct surface, accent outline and primary action in both themes.
- Apps & devices: inline addresses and status badges use theme surface/ink tokens, with readable accent links in both themes.
- External links: no underline, with a small outgoing arrow. `ExternalLink` owns the explicit variant; existing outgoing text links receive the same icon. Options are in `external-link-options.html`.
- Loading: page/content skeletons; no sidebar navigation spinner. Reduced motion disables shimmer and spatial motion.
- Global search: cmdk, opened with Cmd/Ctrl+K or the sidebar Search control. Searches captures, collections and pages; aborts superseded requests and clears private results when leaving the window.
- Landing: Features / Explore / Pricing, one compact Start collecting action, honest Chrome/iOS-beta/Android-beta availability, Free and $5/month Pro plans, animated native FAQ, compact legal/footer links.
- Auth: the FoundKeep wordmark lives within the scenic card; the outer promotional header is removed.

Verification uses the disposable backend in `tests/next-interface-refresh.mjs`, `tests/next-collection-pricing.mjs`, and the existing authentication/session suite. Dev deployment retains accounts, data and Paddle sandbox settings.
