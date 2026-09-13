# Public and group collections

Build a complete collection flow in the existing Foundkeep app. A collection is a curated page with a stable, globally unique URL `/collection/:slug`, title, description, topic tags and contribution rules. Default visibility is private. Existing private folders and captures are unchanged.

## Product decisions

Personal collections are Free. Pro owners can create group collections and invite existing Foundkeep accounts as viewers, contributors or moderators. Invitations appear in the recipient's collections page and require acceptance. Following public collections and accepting invitations are Free. Existing groups remain readable and usable if the owner returns to Free; creating groups and inviting new members requires active Pro. No billing price changes.

Contribution policy is owner only, invited contributors, or any signed-in visitor (the last requires public visibility). Approval defaults on for contributors/visitors. Owner and moderators can publish directly, approve or reject pending submissions, and remove entries. Approval buttons work directly in the queue, with no forced separate review step. Pending entries are visible only to their submitter and collection moderators. Owner can change rules and visibility, remove members and delete a collection. Private collection requests by non-members return the same 404 as a missing collection.

## Sharing and organization

A public entry is an explicit copy of a chosen title, source URL, description/quote and tags. A source capture ID can link the entry to the submitter's own capture. Private annotations, article bodies, OCR, processing metadata, account emails, original file paths and private media endpoints never appear automatically. Users see and can edit exactly the text they are sharing. Saved raster images may be included explicitly; image access rechecks collection visibility and approval on every request. Removing the source capture removes its entries.

People can add a link/note directly on a collection, add an existing library capture through its detail view, or submit the current tab/from the extension library. A target picker shows owned, joined and followed collections in which the current account can contribute. Moving an entry is transactional and re-applies the destination's permissions and review rule; contributors move only their own entries, and may not move other people's content to another audience. Duplicate retries do not create multiple entries.

Public collection pages are readable without signing in, with follow and contribute actions for signed-in accounts. The public directory supports search. The dashboard has Collections navigation with owned, joined, followed and invitation views. Collections use the current Foundkeep typography, color, card and motion conventions.

## Implementation and security

Append a SQLite migration for collections, accepted/pending members, followers and entries. Implement bounded reads, indexed access, validation, unique slugs and submission identifiers, existing origin checks, account-bound session checks, rate limits and transactions. Reauthenticate after awaiting request bodies. Public reads expose an explicit DTO and never use private capture DTOs. No email is sent. Native and browser connection tokens can use fixed collection endpoints; neither caller chooses arbitrary upstream URLs nor obtains credentials.

Next collection pages use request-time rendering and uncached backend reads. Only public collections supply indexable title/description; inaccessible private collections return a generic not-found page. Public media is uncached so changing privacy is effective immediately. Existing static homepage remains static.

## Verification and deployment

Exercise owner, contributor, moderator, follower, anonymous and unrelated accounts; approval, visibility changes, membership acceptance/removal, source deletion, moving, retries, account switching and Pro expiry. Test extension route allowlists and selection controls. Browser-test public/private flows and responsive layouts against a disposable database. Build dev site and extension artifacts; back up the dev database with SQLite backup, then deploy additive migration/backend, website and dev extension. Preserve production and existing dev data.
