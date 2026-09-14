# Foundkeep project memory

## Development and user testing

Pritam's standing preference (2026-09-12): Foundkeep already has a permanent dev environment. Deploy changes there for user testing and share its URL instead of creating a separate preview environment.

- Dev: **https://dev.foundkeep.app**.
- Website: system service `foundkeep-site-dev.service`, loopback port `8891`, release symlink `/home/pritam/.local/share/foundkeep-site-dev/current`.
- Backend: system service `foundkeep-backend-dev.service`, loopback port `8890`, separate data directory `/home/pritam/.local/share/foundkeep-dev`.
- The dev backend now runs an immutable release selected by `/etc/systemd/system/foundkeep-backend-dev.service.d/foundkeep-media-release.conf`. Inspect `systemctl show foundkeep-backend-dev.service -p WorkingDirectory` before updating it; restarting alone does not deploy checkout changes. Package reviewed backend source, its Python helper and matching dependencies into a new release, preserve the prior release, and verify after switching. The media runtime uses `PrivateTmp=yes`; see `docs/beta/media-runtime.md`.
- Preserve existing dev accounts, data, authentication, and Paddle sandbox configuration. Do not reset the dev database for tests.
- Web builds must use `FOUNDKEEP_BACKEND_URL=http://127.0.0.1:8890`, `NEXT_PUBLIC_PADDLE_ENV=sandbox`, and the existing public client token from `/home/pritam/.config/foundkeep/paddle.dev.client-token.txt`. Never include backend secrets in the website build or logs.
- Package with `scripts/package-site.mjs` into a new dev release directory, verify it, switch `current` atomically, restart only `foundkeep-site-dev.service` for web-only changes, and verify the public dev URL. Retain the previous release for rollback.
- Production at `https://foundkeep.app` is separate. Promote to production only when requested.

See [customer web deployment](deploy/NEXT_WEB.md) for packaging and verification details.

Pritam's preference (2026-09-13): keep dev populated and ready for independent testing. `bun run dev:seed` adds dedicated demo accounts, three public collections, a private scratchpad, starter notes, and a pending submission. Reruns preserve existing data and recorded tester changes. Keep credentials/bookkeeping outside the checkout at `~/.local/share/foundkeep-dev-demo`; never seed production or reset dev. See [demo setup](docs/DEV_DEMO.md).

## Browser extension environments

Pritam requested separate dev and production extensions (2026-09-12). Use `bun run extension:build:dev` for **Foundkeep Dev**, stable ID `fngoidplpdpoamenhgpabbheghpkdkcb`, fixed to `https://dev.foundkeep.app`. Use `bun run extension:build:prod` for the existing production identity. Both must coexist with separate local databases, credentials, and upload queues. Never convert an installed production extension into dev or migrate customer data between environments.

Dev static downloads/config are served from `/home/pritam/.local/share/foundkeep-dev-web/current`. The dev backend's `ATLAS_CUSTOMER_EXTENSION_IDS` must contain only the dev ID. The complete configuration and update instructions are in [extension environments](docs/extension-configuration-and-updates.md#separate-development-and-production).

## Friends beta and mobile release

Pritam clarified 2026-09-13: dev is for Pritam only. Friends receive the **production** app and APIs at `https://foundkeep.app`, using the existing app identities. iOS is distributed through the existing TestFlight app; Android through a manually installed APK or Google Play beta. A public App Store/Play rollout comes after beta testing and requires a later release request. Prepare and verify changes in dev before production beta promotion; do not seed demo accounts/content into production. Reuse iOS `app.foundkeep.ios`, Android `app.foundkeep.android`, and `foundkeep` links. Pritam's dev binary keeps environment-specific credential services, queues, caches and update channel inside the same app identity. Never copy data between environments. Friends builds use production APIs and a production-beta update channel.

2026-09-14 friends release: production AI is enabled using the existing provider credential, in a server-only file `/home/pritam/.config/foundkeep/ai.prod.env`. Dev and production still have separate data and auth sessions. Preserve each service's `foundkeep-friends-beta.conf`: `FOUNDKEEP_BETA_PRO=true` grants complimentary Pro (2 GiB storage, 500 monthly processing credits) without creating subscription records. User consent remains required. Production live billing is not configured; never copy Paddle sandbox keys into live billing. The server-wide storage cap is 20 GiB and the production AI budget is 2,000 attempts per day.

Production static downloads have their own immutable release selected by `atlas-backend.service.d/zz-foundkeep-static.conf`; deploying backend code alone does not change those downloads. Production has migrated to schema 29. The original schema-28 production binary cannot be directly restored against it. The verified fallback is `/home/pritam/.local/share/foundkeep-backend/releases/20260914-library-media-1.7.12`, which understands the media tables and cleanup rules. It preserves saves but lacks the complimentary Pro flag. Never roll back by restoring an old database over newer customer data.
