# Customer web deployment

`apps/site` is the customer React/Next website. Public content is pre-rendered; account and library routes use request-scoped server rendering. `apps/backend` continues to own authentication, sessions, storage, captures, OAuth and device configuration. No Supabase SDK or credential is present in the website bundle.

## Build and package

### Existing development environment

Use **https://dev.foundkeep.app** for user testing. Its system services are `foundkeep-site-dev.service` (site on `8891`) and `foundkeep-backend-dev.service` (backend on `8890`). The dev database and existing accounts live under `/home/pritam/.local/share/foundkeep-dev`; preserve them during deployments.

For dev builds set `FOUNDKEEP_BACKEND_URL=http://127.0.0.1:8890`, `NEXT_PUBLIC_PADDLE_ENV=sandbox`, and load `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` from `/home/pritam/.config/foundkeep/paddle.dev.client-token.txt` without logging its value. Backend payment secrets are in a separate environment file and must not be passed to the website build.

Package into a new directory under `/home/pritam/.local/share/foundkeep-site-dev/releases`. Verify the standalone server before atomically changing `/home/pritam/.local/share/foundkeep-site-dev/current`, then restart `foundkeep-site-dev.service`. Web-only deployments do not require restarting the backend. Retain the prior release for rollback. User-facing testing should use this existing dev environment instead of an additional preview deployment.

### Production build

From a checkout with installed workspace dependencies:

```sh
cd apps/site
FOUNDKEEP_BACKEND_URL=http://127.0.0.1:8790 node ../../node_modules/next/dist/bin/next build
cd ../..
node scripts/package-site.mjs /home/pritam/.local/share/foundkeep-site/releases/RELEASE_ID
```

The backend URL is a private loopback service address, not a credential. Set it for both build and runtime: compatibility rewrites are compiled into the artifact. Never pass a Supabase secret as a `NEXT_PUBLIC_` variable.

The package contains traced runtime dependencies, static chunks and dereferenced first-party assets. Set `current` to the new release using an atomic symlink rename. `deploy/foundkeep-site.service` starts its standalone server on loopback port8791. The service has no access to backend credential environment files.

## Verification

Use a separate Bun backend and empty data directory for mutating browser tests. Allow the exact test Next origin in `ATLAS_CUSTOMER_ORIGIN`. Build with that test backend address before starting the standalone server. The tests refuse production account mutations except the existing explicit opt-in customer-flow harness.

```sh
FOUNDKEEP_WEB_TEST_URL=http://127.0.0.1:18791 CHROMIUM_PATH=/path/to/chromium node --test tests/next-web.mjs tests/next-auth.mjs tests/next-home-audit.mjs
BASE_URL=http://127.0.0.1:18791 CHROMIUM_PATH=/path/to/chromium node tests/next-dashboard.mjs
FOUNDKEEP_NEXT_WEB=1 ATLAS_CUSTOMER_SITE_URL=http://127.0.0.1:18791 CHROMIUM_PATH=/path/to/chromium node --test tests/customer-flow.mjs
bun test --timeout 120000
```

After testing, build again for the production backend address. Install the service and modify only the Foundkeep block in the shared Caddyfile using `deploy/Caddyfile` as the reference. API/upload/relay/native and extension compatibility paths stay on8790; customer web traffic uses8791. Validate Caddy configuration before reload.

Check the new service directly before changing public routing. Then verify public HTML, unauthenticated `/dashboard` redirect, legacy `.html` redirects, private no-store headers, CSP, assets, `/healthz`, Apple association and extension downloads through the live domain.

## Rollback

Retain the previous `current` symlink destination and a backup of `/etc/caddy/Caddyfile`. For subsequent web releases, atomically point `current` back and restart `foundkeep-site`. For the first Next rollout, restoring Foundkeep's previous `reverse_proxy localhost:8790` block and reloading Caddy restores the existing static website immediately. Keep the backend running; the preview endpoint is additive and requires no database migration.
