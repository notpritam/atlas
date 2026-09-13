# Foundkeep project memory

## Development and user testing

Pritam's standing preference (2026-09-12): Foundkeep already has a permanent dev environment. Deploy changes there for user testing and share its URL instead of creating a separate preview environment.

- Dev: **https://dev.foundkeep.app**.
- Website: system service `foundkeep-site-dev.service`, loopback port `8891`, release symlink `/home/pritam/.local/share/foundkeep-site-dev/current`.
- Backend: system service `foundkeep-backend-dev.service`, loopback port `8890`, separate data directory `/home/pritam/.local/share/foundkeep-dev`.
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
