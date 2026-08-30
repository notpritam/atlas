# Atlas

A fabric.so-style "capture everything, let the agent organize it" knowledge system.

- **`apps/backend`** — the canonical store. A self-hosted Bun + Hono + `bun:sqlite`
  service that runs on omni behind `atlas.notpritam.in`. Ingests captures from the
  browser extension, stores blobs + FTS-searchable text, and exposes a queue the bb
  agent drains to enrich each capture (OCR, tags, category, summary). **bb-independent
  by design** — the future website consumes the same API.
- **`apps/extension`** — Chrome MV3 extension. Region/full-page screenshots, text
  highlights, bookmarks, image grabs, and quick notes → POSTed to the backend.
- **`apps/web`** — the future standalone website (scaffold only for now).
- **`packages/shared`** — zod DTOs + the API contract shared by backend and extension.

The **bb plugin** that drives enrichment and provides the "Library" viewing surface
lives separately at `~/personal/extensions/workflow/bb-plugin-tracker` (Atlas). It is
a *client* of this backend, not part of this repo.

See `~/.claude/plans/typed-hatching-quilt.md` for the full architecture and phasing.

## Backend quickstart

```bash
cd apps/backend
bun install
# mint a device token (writes the DB directly; prints the token ONCE)
bun run bin/atlas.ts devices add "Chrome — laptop" --scope ingest
bun run bin/atlas.ts devices add "bb worker (omni)" --scope read,enrich
# run the service
ATLAS_PORT=8787 bun run src/index.ts
```
