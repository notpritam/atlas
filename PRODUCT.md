# FoundKeep

<!-- impeccable:product-schema 1 -->

## Platform

Web dashboard, Chromium browser extension, and an Expo iPhone app with a native iOS Share Extension.

## Purpose and operating context

FoundKeep is a customer capture product for saving readable pages, screenshots, highlights, bookmarks, images, posts on X, and notes with traceable source records, then finding them in a private library. It uses native HTML/CSS/JavaScript, a Chromium Manifest V3 extension, and a Bun/Hono/SQLite backend.

## Collections and navigation

FoundKeep does not offer workspaces or a workspace switcher. Personal and group sharing use collections. The selected sidebar direction is Library first: a small FoundKeep wordmark, the logo opening collapsed desktop navigation, and a hamburger opener in the mobile header, with the logo shown only inside the open mobile drawer. One collapse control is shown while expanded. The brand spelling is FoundKeep, with a capital K. The sidebar shows real collections and plan usage. New note belongs in the library header only, not the sidebar.

## Public collections

Public collections share selected links, notes, and ideas with a curator identity and explicit contribution rules. Visitors can browse and search without signing in; signed-in customers can follow or contribute when allowed. Collection owners choose private/public visibility, who can add, and whether submissions need approval. Public search, result counts, and tag choices exclude pending/private content. Explore provides topic navigation and collection search. Dev has dedicated, labeled demo collections and a repeatable additive seed command; see `docs/DEV_DEMO.md`.

## Customer flow

Customers sign in or create an account with an enabled provider (Google and Apple in production). Email/password is a secondary option and asks customers to save a recovery code. They install the extension and connect the browser from the dashboard. New captures save locally first and upload to that account when automatic sync is enabled. Existing local captures require explicit import consent. Website sessions and extension credentials are separate and revocable.

Each customer controls capture methods, readable bookmark extraction, page metadata, note source attachment, popup order, recent items, context menus, sync, OCR, summaries, tags, and success feedback from the dashboard. Preference changes do not require an extension release. Manifest permissions and executable features still do.

Every capture can retain the visited URL, canonical URL, title, description, site, authors, publication and modification dates, language, lead image, favicon, target URL, headings, capture method, capture and extraction times, extractor version, extraction status, and a content fingerprint. Raw page HTML is not stored.

## iPhone Gallery

The selected mobile direction is **02 / Gallery**: a virtualized image-led collection with a sticky header, search, folder/tag filter, and capture-type controls. Large accessibility text uses one column. The canonical folded-bookmark artwork is shared across the app and Share Extension. Loading cards use a restrained shimmer, real image-loading/error states, and Reduce Motion support.

Customers can save from the iOS Share menu, create notes in the app, view every item in a multi-item share, and edit titles/notes without replacing original provenance. Each save can belong to one optional folder and carry up to 20 personal tags. Reading, Projects, Inspiration, and starter tags are suggestions, created only when chosen. Folder names are account-owned and editable; deleting a folder keeps its captures. Personal tags remain separate from enrichment suggestions.

The same private backend stores app, browser, and dashboard captures. Native previews use owner-authenticated routes. The app supports backend-owned browser OAuth alongside email/password and recovery codes. Enabled providers are discovered from the backend. Supabase credentials and provider sessions stay server-side. The short legal footer is “By continuing, you agree to our Terms and Privacy Policy.”

Application version stays 1.0.0. Compatible JavaScript and assets can use Expo Updates; Swift Share Extension, entitlements, and other native changes require a new App Store/TestFlight binary. Queued uploads are bound to their account; unscoped legacy records are retained for recovery instead of being assigned to a new account.

## Account identity and customer web

A verified provider email can connect several provider subjects to one private FoundKeep account. Supabase's top-level email confirmation alone is insufficient: the selected provider must attest the same email. An existing password-only account requires its password once to connect its first provider. Legacy social mappings require a fresh verified login before authorizing another subject. Established subjects never move accounts when email changes. Different addresses, including Apple private relay emails, remain separate.

The web auth, library, setup, item detail and settings surfaces inherit the scenic landing's white/azure/sky/mint world with Clarity City and Geist. Social methods lead; email controls expand on request and remain available if providers cannot load. Support and policy pages share the web palette and typography. Native iPhone Gallery remains deep purple.

## Security and compatibility

Customer queries, images, preferences, and credentials are owner scoped. Local IndexedDB, existing records, the fixed extension ID, signing key, shortcuts, storage keys, message kinds, API routes, database tables, and header names remain compatible across the FoundKeep migration.

The primary origin is `https://foundkeep.app`. Human-facing requests to `https://atlas.notpritam.in` redirect to the matching FoundKeep path, while its API and relay endpoints remain a temporary compatibility origin for version 1.5 clients. Cross-domain website cookies cannot migrate, so existing customers sign in once on FoundKeep; their accounts and captures remain in the same database.

Customer agents connect through scoped, revocable MCP credentials. Free includes imports and MCP access; optional Pro adds consented managed processing. External agents own their model and schedule. Search remains keyword based, without an embedding or semantic-search claim. There is no advertising tracker or email reset delivery. Local capture remains available without an account. Cloud and local deletion are separate. Free allows 10,000 captures and 200 MiB; Pro allows 10,000 captures, 2 GiB and 500 managed-processing credits per UTC calendar month. Web Pro is USD $5/month via Stripe; native subscriptions use RevenueCat and Apple In-App Purchase.

## Evidence

The executable contract is in `docs/superpowers/specs/2026-09-07-foundkeep-launch-design.md`. Backend, extension, landing, and real Chromium customer-flow tests establish account security, data ownership, capture provenance, preference control, responsive UI, and upgrade compatibility.
