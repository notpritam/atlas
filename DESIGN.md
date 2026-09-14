---
name: FoundKeep
description: Scenic customer web with a shared bookmark identity and a distinct native Gallery.
colors:
  landing-blue: "#086ca8"
  landing-blue-hover: "#075888"
  landing-scenic-blue: "#0577b9"
  landing-sky: "#e0f0fc"
  landing-mint: "#d5f8cf"
  landing-white: "#ffffff"
  landing-ground: "#f1f4f4"
  landing-ink: "#182b30"
  landing-muted: "#596a6e"
  landing-line: "#dfe8e9"
  customer-input-line: "#708f9a"
typography:
  customer-heading:
    fontFamily: "Clarity City, Geist, sans-serif"
    fontWeight: 500
  customer-body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "14px"
    lineHeight: 1.5
rounded:
  customer-control: "12px"
  customer-card: "20px"
  customer-dialog: "24px"
  customer-pill: "999px"
---

# FoundKeep Design System

The current web conventions are recorded in [the September 14 interface update](docs/design/2026-09-14-interface.md). That update supersedes the earlier web typography, blue control palette, account disclosure and side-pane navigation described below. Native platform identities remain separate.

## Overview

The marketing landing follows the user's scenic reference: an azure mountain horizon, spacious white ground, rounded sky and mint product panels, soft glass mini-controls, and scenic closing sections. The scenic color tokens also apply to customer auth, dashboard, support and policy pages; [its surface brief](apps/web/.impeccable/surfaces/index-html.md) records the page contract.

Customer web extends the landing world through focused white forms, azure controls, sky notes and mint highlights. The browser extension retains its incumbent theme. The iPhone app retains the approved deep-purple Gallery and floating dock. Scenic scenery supports auth; saved customer content leads the library.

The canonical mark remains a source point inside a folded bookmark and protected dark frame: a saved item whose origin stays attached. Preserve its geometry from small extension icons through social artwork.

## Colors

Landing blue drives actions and links; scenic blue backs the mountain imagery. Sky and mint alternate behind product illustrations. White carries the reading surface; dark teal ink, muted gray-teal copy, and pale rules maintain hierarchy. Translucent blue glass and darker image overlays protect white text. Values come from the actual controls in [landing.css](apps/web/landing.css).

Extension guidance remains warm paper (`#f3f3f0`), near-black (`#171917`), vermilion (`#c63b23`), and muted moss (`#6b7553`), with distinguishable semantic success and error colors. Web input borders use the darker customer-input-line token. Semantic success and error remain distinguishable. Preserve the mobile app's existing deep-purple palette.

## Typography

Self-hosted Clarity City and Geist connect the surfaces. The landing loads Clarity City Medium/Semibold and variable Geist with font swapping. Its centered hero uses weight 500, `clamp(46px, 5.6vw, 80px)`, 1.02 line height, and tight tracking. Left-aligned section titles use `clamp(34px, 3.9vw, 53px)` with 1.08 line height. Geist carries body text and controls; base body text is 15px/1.6, with paragraphs capped at 68 characters. Customer web uses Clarity City Medium/Semibold headings and Geist controls: auth heading 36px desktop/30px phone, library heading 44px desktop/36px phone, body 14px and metadata 11–13px. Reading pages retain their spacious document hierarchy.

## Layout

The landing has a white shell capped at 1600px, main content capped at 1100px, and generous section gaps (116px by default). Desktop capture and setup panels are paired, the collection has three examples, and platforms use two columns. Breakpoints at 1100px, 800px, and 540px progressively reduce gutters and stack content; the surface brief specifies 1440px, 768px, 390px, and 320px behavior.

`index.html` keeps separate `landing.css`. Auth, dashboard, support, privacy and terms load `styles.css` followed by `customer.css`, whose shared tokens match the landing. Auth pairs a scenic panel and account form at a maximum 1180px; below 680px it becomes a compact scenic masthead above the form. The dashboard uses the approved Library first sidebar: 286px desktop, 250px tablet, and a collapsible 76px icon rail. The smaller FoundKeep wordmark is 18px (17px inside the mobile drawer); the collapsed desktop logo expands navigation without changing the page. At 760px and below, a hamburger-only header opens the drawer, whose branding and single collapse control remain inside. Use real collection links, separated management links, quiet plan usage, and an account disclosure menu. New note appears only in the library header. When a capture is open at 761–1000px, the reader uses the main area until closed so cards are not squeezed beside it. Type filters scroll horizontally; the gallery becomes one column below 420px.

Public collections extend this palette through prominent curator introductions, locally authored topic artwork, a ruled reading list, and an optional grid. Desktop places contribution rules beside the feed; phones surface contribution actions directly below the introduction. Explore uses responsive topic-cover cards with actual curator/count data. The [public collection surface brief](apps/site/.impeccable/surfaces/app-public-collections.md) records the contract.

## Elevation & Depth

Landscape imagery and tonal layering carry depth. Platform cards use a soft shadow (`0 8px 24px #1b476013`) and fine border; mini-windows and stickers overlap with small static rotations. Hero glass combines translucent fills, light borders, and restrained backdrop blur. The closing CTA and footer reuse local mountain imagery with readable white text over darker overlays.

## Shapes

Landing actions are pills; mini-controls are circles. Broad scenic corners (27px hero), nested platform corners (23px card, 17px art), and smaller demo/collection corners establish hierarchy. Customer actions are pills; provider controls use 14px corners, cards 20px and native dialogs 24px. Input boundaries use a darker 1px stroke. Extension shapes remain independent.

## Components

Landing actions are blue on white and white over scenery, with a glass secondary hero action. The highlight demo exposes saved/reset states, item count, source label, and an announced status explaining that the real library is unchanged. The collection is visibly labeled illustrative; the actual browser-library screenshot sits behind a native details disclosure. Decorative platform diagrams are hidden from assistive technology and accompanied by accurate feature and beta text.

Customer auth displays enabled provider methods first, with native email disclosure and an email fallback if discovery fails. The library keeps saved text before a collapsed native Source details record. Loading provider slots and gallery cards shimmer. Dashboard interactions share GSAP: short page and dialog entrances, card lifts and transform-based masonry reflow, and usage-meter fills. Navigation, refresh, save, and data loaders follow real pending work; background refresh retains readable cards. Reduced motion removes spatial movement and shimmer while keeping static progress feedback. Looping indicators pause offscreen and in hidden tabs, and component cleanup cancels animations. Keep native scrolling and server-rendered library content available without JavaScript. Dialogs, source links, recovery controls and account boundaries remain functional.

The extension still leads with Save page, configurable secondary captures, a compact note composer, and a fixed Open library footer inside Chromium's 600px popup limit. Libraries retain search, filters, readable cards, provenance, account controls, and explicit local/sync, empty, and error states.

Preserve keyboard navigation, visible focus, semantic headings, native disclosures, and the skip link. Landing motion uses short scenic and saved-card arrivals plus gentle hover lifts; reduced motion disables animations, transitions, and smooth scrolling. Landing and reading-page content remain available without JavaScript; account and library pages explain their JavaScript requirement.

## Do's and Don'ts

Carry the scenic direction through customer web, while preserving the approved native Gallery and extension themes. Keep the bookmark mark unchanged; do not add gradients, sparkles, orbit symbols, religious imagery, or generic cloud/magnifying-glass substitutions to it.

The Chrome Web Store listing is live; iPhone access is TestFlight beta. Retain demo/collection disclosures, the actual browser screenshot, support, legal, and manual installation links. Do not invent App Store availability, Android/native desktop apps, unapproved pricing, metrics, testimonials, tracking, or unsupported claims. Core setup asks for an account and browser connection. Apps & devices manages devices; the prominent Agents destination opens a separate Agent connections page with visible setup, scoped access, existing connections, and instructions; Plans & usage shows account usage before comparing Free and the approved $5/month Pro plan. Settings has Account, Capture, and Processing routes, as recorded in the [account-page surface brief](apps/site/.impeccable/surfaces/app-dashboard.md); operator credentials and relay configuration never appear in customer setup.

### Apps and devices

Browser installation and iPhone access share the incumbent scenic card and action vocabulary across marketing, auth, support, and library setup. Keep availability badges explicit, browser and iPhone setup paths distinct, and contextual device suggestions dismissible. Connection labels describe the signed-in account’s confirmed devices. iPhone access remains a private TestFlight invitation request until distribution configuration enables a public destination. Preserve readable white labels on azure primary actions in both resting and hover states, including support links styled as buttons.
