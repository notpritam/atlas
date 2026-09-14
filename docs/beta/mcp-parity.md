# MCP early access

The September 14 release expands the authenticated MCP endpoint at
`https://dev.foundkeep.app/api/mcp`. Existing agent tokens continue to work;
clients should reconnect or refresh `tools/list` to discover the new schemas.
Server protocol identity is `FoundKeep` version `1.1.0`.

## Editing generated tags

Read the save first, then pass its `capture.updatedAt` as `expectedRevision`:

```json
{
  "id": "<save UUID>",
  "expectedRevision": 123456789,
  "tags": []
}
```

Both `update_save` and `organize_save` accept this input. `tags` edits generated
tags; `userTags` edits personal tags. Empty arrays clear the selected set;
omitted fields are preserved. Explicit generated-tag edits cancel stale hosted
jobs so their results cannot overwrite the correction. No processing credit or
AI consent is needed for a direct edit. Basic processing that is actively
editing the save must finish before substantive edits are accepted.

`update_save` also edits titles, source URLs, notes, selected/article/OCR text,
summary, category, and folder. `link_saves` supports `replace: "all"` to replace
generated and agent links together; its default preserves generated links.

## Capability coverage

| Area | Available operations |
| --- | --- |
| Library | Search/filter, read/create/edit/delete, folders, both tag sets, relationships, graph, change polling |
| Files | Upload originals, read originals/previews/compact copies/preserved assets, paginated account export |
| Collections | Discover, create/edit/delete, follow, invitations, roles, submit/moderate/remove/move entries, read shared images |
| Imports | Preview and commit bookmark batches with folders, tags, provenance and retry IDs |
| Processing | Consent/settings/schedules, status, request processing, preservation status and retry |
| Preferences | Revision-checked capture, organization, extension, sync and feedback preferences |
| Connections | List/create/revoke agent connections, trusted instructions, extension pairing, device revocation, registered-device notification settings |
| Account/billing | Account/plan, checkout and portal links, billing sync, mobile purchase checks, password change, provider reauthentication and account deletion |

The fixed tool catalog dispatches to the app's existing authenticated handlers.
It cannot call arbitrary URLs, select another account, or turn an MCP token
into an HTTP session. Ownership, collection roles and token scopes still apply.
Use `tools/list` as the exact schema reference.

Binary reads require `files:read`. Sharing an image, making a collection public,
approving entries, moving entries, and inviting collection readers also require
that scope because they can expose existing images. Metadata-only collection
edits and text-only submissions remain available to library writers. Creating
device credentials, account reauthentication/deletion, password changes, and
writing trusted instructions require full scopes. New agent connections cannot
receive permissions absent from their creator's token.

Provider identity verification, payment confirmation, and initial mobile OS push
permission still use the provider/browser/device. MCP can initiate or manage
those workflows but does not bypass the human authentication step.

## Temporary feature policy

`accountPlan` reports `earlyAccess: true` and enables MCP, bookmark imports,
group collections and managed processing on Free and Pro. Hosted processing
has a 500-credit monthly allowance on either plan, still bounded by the user's
chosen cap, explicit consent, provider availability, and the global budget.
The actual subscription and payment state remain unchanged. Free storage stays
200 MiB; Pro storage stays 2 GiB. Future feature gating can be centralized in
`customer-plans.ts` rather than scattered through MCP tools.

## Upload and export behavior

Use `begin_file_upload`, `append_file_upload`, then `finish_file_upload`.
Uploads require a declared size and SHA-256 checksum, allow files up to 50 MiB,
and accept canonical base64 chunks up to 256 KiB. Chunk offsets are exact;
replaying identical bytes is safe. Use `cancel_file_upload` to discard staging.

Staging is private to the database, account and agent credential, expires after
30 minutes, and has per-account/global concurrency and byte limits. Server
restarts discard unfinished staging; retry from the start with the same
`clientId` to avoid duplicating a previously committed save. Account deletion
also removes its staging. Finishing uses the normal file-ingestion validation,
quota and durable storage path.

`export_account` returns a live, paginated metadata export and file manifests.
Follow `next` until null, and read binary chunks separately. It is not an atomic
snapshot and does not include credential secrets.

## Verification and deployment

Unit coverage lives in `apps/backend/test/customer-mcp-parity.test.ts`, alongside
the tag/revision, processing, collection, OAuth and write suites. The real HTTP
client check is `tests/next-mcp-parity.mjs`; it creates and deletes only its own
temporary account. It refuses production and requires `FOUNDKEEP_ALLOW_DEV_TEST=1`
when `BASE_URL=https://dev.foundkeep.app`. `FOUNDKEEP_TEST_SITE=1` also checks the
Free-account settings and plan UI with Playwright.

The backend dev package is `20260914-mcp-parity-1.7.11`, with matching installed
dependencies and the preserved media helper. The website package has the same
release name. Keep the previous backend drop-in and website symlink target for
rollback; do not replace or reset the dev database. Follow [web deployment](../../deploy/NEXT_WEB.md)
and [media runtime](media-runtime.md). Production promotion is separate.

Mobile processing controls consume the new `canProcess` flag with compatibility
fallback, but this backend/site release does not publish a mobile binary or
change the extension package.
