---
version: 1
slug: "app-dashboard"
primary_target: "app/dashboard"
related_targets: ["app/dashboard/agents/page.tsx","components/dashboard/agents.tsx","components/dashboard/agents.css","route:/dashboard/agents","app/dashboard/apps/page.tsx","app/dashboard/plans/page.tsx","app/dashboard/settings/page.tsx","app/dashboard/settings/capture/page.tsx","app/dashboard/settings/processing/page.tsx","components/dashboard/account-pages.css","components/dashboard/sidebar.tsx","components/dashboard/plans.tsx","components/dashboard/settings.tsx","components/dashboard/devices.tsx","components/dashboard/collection-services.tsx","components/dashboard/dashboard.tsx","components/dashboard/account-page.tsx","components/dashboard/connections.tsx","components/dashboard/page-heading.tsx","route:/dashboard/apps","route:/dashboard/plans","route:/dashboard/settings","route:/dashboard/settings/capture","route:/dashboard/settings/processing"]
---

# Foundkeep account pages

## Scope and visitor mode

**Operate.** Signed-in customers manage their account, connected apps, capture preferences, processing, and subscription through dedicated dashboard URLs. The shared library shell provides a consistent route back to their saved content.

## Tasks and content

| Destination | Customer task and reading order |
| --- | --- |
| `/dashboard/apps` | Install or open the browser and iPhone apps, confirm account connections, and revoke device access. A link leads to the dedicated Agent connections page. iPhone visitors see the iPhone setup first. |
| `/dashboard/agents` | Create a scoped MCP connection from a visible setup form, copy its one-time configuration, review or revoke connected agents, and save instructions for their next check. Available on Free and Pro. |
| `/dashboard/plans` | Read the current account plan and actual storage, capture, and processing usage; refresh or manage the subscription; then compare Free and Pro and take the available plan action. |
| `/dashboard/settings` | Identify the signed-in account, inspect cloud usage, export captures, manage password and recovery, sign out, or delete the account. |
| `/dashboard/settings/capture` | Review grouped browser preferences and popup order, then explicitly save capture settings. |
| `/dashboard/settings/processing` | Inspect processing availability, grant or withdraw consent, choose processing options, and review recent activity. |

Workspace links are My library, Agents, Apps & devices, Plans & usage, and Settings. Agents appears directly below the library; it opens Agent connections at `/dashboard/agents`. Settings has Account, Capture, and Processing subnavigation. Active destinations use `aria-current="page"`; the account identity link opens Account settings. The sidebar has an explicit collapse/expand control. Desktop collapse retains an 80px icon rail with hover and keyboard-focus labels; phone collapse hides the navigation row while keeping the brand, toggle, and account control visible. The browser remembers the presentation preference across dashboard pages and refreshes, with a working in-memory fallback when storage is unavailable. Layout changes use a short GSAP transform transition and settle immediately with reduced motion.

## Chosen direction and memorable moment

Inherit the scenic customer web in root `DESIGN.md`: white surfaces, azure actions, sky emphasis, mint accents, Clarity City headings, and Geist body text and controls. The memorable sequence is personal usage before the plan comparison: customers understand their own collection before considering an upgrade. Free remains white; Pro uses the shared sky surface; current-plan badges use mint. This extension introduces no new raster assets or global visual tokens.

The account content uses a centered maximum width of 1060px within the existing shell. Clear headings, pale section rules, restrained rounded containers, and native disclosures keep longer settings legible. Desktop Plans presents three usage columns above two comparison cards with actions aligned at the bottom. Pro has more width, a sky surface, an azure price, and a clear processing label. At 760px and below, usage and plan cards stack and workspace navigation becomes compact; at 400px and below its labels remain visible without decorative icons. The phone navigation can scroll horizontally to keep all five destinations reachable. Account names and device labels wrap. Focus remains visible on links, controls, and disclosure summaries.

Plan copy distinguishes Free's working library and scoped own-agent control from Pro's Foundkeep-managed processing. Free agents can create folders, update tags, and connect related saves; model and hosting costs belong to the chosen agent. Pro explains image understanding, readable public-link context, summaries, tags, related saves, and consent controls with concrete benefits. The requested YouTube video processing and Instagram/X video downloads appear in a separate “Planned for Pro” section, explicitly unavailable and outside the current paid feature set. Do not present these video capabilities as available until their implementation is verified. Plan evidence is in repository-root `.impeccable/review/plans-clarity/`.

## Interaction and state constraints

Ordinary account navigation changes URLs. Sensitive consent, export, revocation, password, recovery, and deletion flows retain their existing dialogs. Legacy `panel=devices`, `panel=settings`, `#devices`, and `#extension-settings` links redirect to the corresponding pages; billing returns reach Plans & usage.

Render usage and plan state from the signed-in account. Checkout-return text may report pending verification; the URL alone never grants Pro. Expose pending, unavailable, error, and retry states in context. Prices and checkout availability follow the backend. Keep managed processing consent separate from Free/Pro MCP access, and preserve the distinction between cloud deletion and local captures. Device availability and connection copy must reflect the existing installation configuration and confirmed account connections.

## Agent connections

The Agents page separates setup from connection management. The visible setup form leads, with required library read access, optional file and organization permissions, a primary Create connection action, and Free & Pro availability. An adjacent guide explains the three setup steps; it stacks below the form on narrow screens. Connected agents show actual permissions, expiry, and last use. Instructions retain their pending status until an agent handles them.

Reuse the existing account-scoped APIs and confirmation for revocation. Generated credentials live only in component state, use the current environment’s MCP URL, and are cleared when acknowledged or when the page unmounts. Handle list and creation failures with visible retry paths. Processing preferences remain under Settings; Apps & devices and Plans link to Agents. Browser evidence is under `.impeccable/review/agents/`.

## Dashboard motion

Use the shared GSAP helpers in `components/dashboard/motion.ts` and loading components in `loading.tsx`. Page entrances and masonry reflow settle in about 320ms, dialogs in 240ms, hover lifts in 180ms, and usage meters in 500ms. Animate transforms and opacity; preserve native focus, scrolling, and account-scoped cleanup. Motion belongs to actual arrivals and state changes, so polling unchanged positions does not replay it.

`useLinkStatus` supplies pending route feedback. Module, library, plan, and preference fetches show contextual skeletons; saves and explicit refreshes show busy indicators. No artificial loading delays. Reduced motion uses static skeletons and clear busy text; looping indicators pause outside the viewport and when the document is hidden. Do not add a page-level Suspense loading boundary that makes server-rendered library content depend on JavaScript to become visible.

Motion evidence and browser regression screenshots are under `.impeccable/review/dashboard-motion/`.

## Finish evidence and open decisions

The implementation handoff records a **SHIP** review with all three findings resolved, plus passing typecheck, production build, account-route, billing, regression, and security tests. Desktop and phone evidence is under repository-root `.impeccable/review/account-pages/`: `-dashboard-{apps,plans,settings,settings-capture,settings-processing}-{1440,390}.png`.

No unresolved design decisions remain for this extension. Future changes inherit this route structure and the existing global system.
