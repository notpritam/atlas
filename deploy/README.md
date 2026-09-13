# Deploying Foundkeep on omni

Foundkeep runs through the existing internal `atlas-backend` systemd service on port 8790 and the existing SQLite data directory at `/home/pritam/.local/share/atlas`. These internal names stay unchanged to protect production data and installed integrations.

The primary public origin is `https://foundkeep.app`. Human-facing requests on `https://atlas.notpritam.in` redirect permanently to the matching Foundkeep path. Its API, relay, health, and package routes remain an exact compatibility origin for version 1.5 clients during the migration.

## Backend

```bash
sudo cp deploy/atlas-backend.service /etc/systemd/system/
sudo mkdir -p /etc/systemd/system/atlas-backend.service.d
sudo cp deploy/foundkeep-origin.conf /etc/systemd/system/atlas-backend.service.d/
sudo systemctl daemon-reload
sudo systemctl enable --now atlas-backend
systemctl status atlas-backend
```

- Port: `8790`
- Data: `/home/pritam/.local/share/atlas`
- Logs: `sudo journalctl -u atlas-backend -f`
- Customer origins: `https://foundkeep.app,https://atlas.notpritam.in`

## DNS and HTTPS

Register `foundkeep.app` before applying DNS. Point apex `A` to `157.180.102.248` and apex `AAAA` to `2a01:4f9:3090:1055::2`. Point `www` to the apex. Production uses Cloudflare proxying: Cloudflare presents the public edge certificate and Caddy's `tls internal` certificate encrypts the origin connection. Keep Cloudflare SSL/TLS mode on Full for this configuration.

Copy the Foundkeep blocks from `deploy/Caddyfile` into the shared `/etc/caddy/Caddyfile` without replacing other products, then validate and reload:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo journalctl -u caddy -f
```

The backend serves `apps/web` for non-API paths. Foundkeep proxies to `127.0.0.1:8790`; the legacy hostname proxies only compatibility routes and redirects ordinary website requests. The `.app` top-level domain is HSTS-preloaded. Verify Cloudflare's public HTTPS response before publishing the extension.

## Releases and auto-update

- Fixed extension ID: `mjfcgmboaijfcaanepdipbgmipnccnpn`
- Update manifest: `https://github.com/notpritam/foundkeep/releases/latest/download/updates.xml`
- Branded CRX: `https://github.com/notpritam/foundkeep/releases/latest/download/foundkeep-extension.crx`
- Compatibility CRX: `https://github.com/notpritam/foundkeep/releases/latest/download/atlas-extension.crx`

Version 1.5 clients request the old GitHub repository path and `atlas-extension.crx`. GitHub repository redirects plus the retained asset name carry them into the Foundkeep 1.6 update. Do not remove the compatibility asset.

Extension changes pushed to `main` run backend, extension, landing, and customer verification. Publishing is separate: manually dispatch the Release extension workflow only when production promotion is requested. That run builds the CRX with the existing `EXTENSION_PEM` secret, checks the fixed ID/signature, and publishes `ext-v<version>`. Merging dev work does not publish an extension update to production clients.

Manual build and verification on omni:

```bash
node deploy/release-extension.mjs --no-bump
node deploy/verify-release.mjs
bash deploy/pack-store.sh
```

Manual publishing requires an authenticated `gh` session:

```bash
node deploy/release-extension.mjs --no-bump --publish
```

The local key remains at the gitignored `deploy/keys/atlas-extension.pem`; its filename is a compatibility detail. Never create a replacement key. A different key changes the extension ID and disconnects the update path.

## Deploying a tested revision

1. Verify the feature worktree and review its diff.
2. Back up and integrity-check the SQLite database.
3. Fast-forward `/home/pritam/personal/apps/atlas` on `main` to the tested commit and push.
4. Install the dual-origin systemd override and restart the backend before enabling the new domain.
5. Add/validate the shared Caddy blocks after DNS resolves.
6. Verify `/`, `/support.html`, `/privacy.html`, `/foundkeep-extension.zip`, `/healthz`, `/signup`, `/login`, and `/dashboard` on `foundkeep.app`.
7. When production extension promotion is requested, dispatch the GitHub release workflow, then verify the downloaded CRX, update XML, version, signature, ID, and both artifact aliases.
8. Run `ATLAS_SITE_URL=https://foundkeep.app bun run test:web` and the disposable live customer flow.

See [customer operations](CUSTOMER_LAUNCH.md) for account security, migration behavior, backups, and Chrome Web Store steps.
