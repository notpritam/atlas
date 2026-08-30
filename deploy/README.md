# Deploying Atlas on omni

The backend runs as a systemd service on omni; a Cloudflare Tunnel exposes it at
`atlas.notpritam.in` for the browser extension. The **bb plugin talks to the
backend over `localhost:8790`**, so it does not depend on the tunnel.

## Backend service (already installed)

```bash
sudo cp deploy/atlas-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now atlas-backend
systemctl status atlas-backend
```

- Port: `8790` (8787 is taken by the cutroom app).
- Data: `/home/pritam/.local/share/atlas` (`atlas.db` + `blobs/`).
- Logs: `sudo journalctl -u atlas-backend -f`.

## Device tokens

```bash
cd apps/backend
ATLAS_DATA_DIR=/home/pritam/.local/share/atlas bun run bin/atlas.ts devices add "Chrome — laptop" --scope ingest
ATLAS_DATA_DIR=/home/pritam/.local/share/atlas bun run bin/atlas.ts devices add "bb worker" --scope read,enrich
ATLAS_DATA_DIR=/home/pritam/.local/share/atlas bun run bin/atlas.ts devices list
```

Current tokens are in `/home/pritam/.local/share/atlas/tokens.txt` (chmod 600).

## Landing page

The **backend serves the static landing page** (`apps/web`) for any non-API path,
straight from the repo — so `atlas.notpritam.in/` shows the site and `/v1`,
`/admin` are the API, with caddy doing nothing but a plain `reverse_proxy
localhost:8790`. Edit `apps/web/*` and it's live immediately (no build, no sync,
no `/var/www`). Override the served dir with `ATLAS_WEB_DIR` if needed.
(`deploy/sync-web.sh` + `/var/www/atlas` are legacy and no longer required.)

## Public HTTPS — caddy + Vercel DNS (current setup)

notpritam.in's DNS is on Vercel, so we point the subdomain straight at omni's
public IP and terminate TLS with caddy (Let's Encrypt). No Cloudflare account
needed.

1. **Vercel DNS** (notpritam.in → DNS): add an **A** record
   `atlas` → `157.180.102.248` (a specific record overrides any `*` wildcard
   that points at Vercel). Optionally **AAAA** `atlas` → `2a01:4f9:3090:1055::2`.
2. **Firewall:** omni's ufw already allows 80/443. If a Hetzner *cloud*
   firewall is attached, allow inbound 80 + 443 there too.
3. **caddy** (already installed):
   ```bash
   sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
   sudo systemctl enable --now caddy
   sudo journalctl -u caddy -f      # watch the cert get issued
   ```

Result: `https://atlas.notpritam.in` → `http://localhost:8790`. caddy retries
issuance automatically until the A record resolves to omni.

### Alternative: Cloudflare Tunnel (only if DNS moves to Cloudflare)

Requires the zone's nameservers on Cloudflare (incompatible with Vercel DNS).
Then: `cloudflared tunnel login` and `./deploy/setup-tunnel.sh` (uses
`atlas-tunnel.service`). Advantage: no inbound ports / IP exposure.

## Wiring the bb plugin (already done)

```bash
bb plugin config tracker set atlasBaseUrl "http://localhost:8790"
bb plugin config tracker set atlasDeviceToken "<read,enrich token>"
bb plugin reload tracker
```

## Wiring the extension

Load `apps/extension` unpacked in Chrome, then in the popup Settings enter
`https://atlas.notpritam.in` and the **ingest** token.

## Releases & auto-update (GitHub Releases)

The extension auto-updates from **GitHub Releases** — no manual re-download ever.

- Extension ID: `mjfcgmboaijfcaanepdipbgmipnccnpn` (pinned by the signing key).
- Update manifest: `https://github.com/notpritam/atlas/releases/latest/download/updates.xml`
- Signed build: `.../releases/latest/download/atlas-extension.crx`

### Cutting a release

Automatic: bump `apps/extension/manifest.json` `version`, push to `main`, and the
**Release extension** GitHub Action signs the `.crx`, writes `updates.xml`, and
publishes a `ext-v<version>` release. Chrome picks it up within ~5h (or via
`chrome://extensions` → Update).

Manual from omni (needs `gh auth login` once):

```bash
bun run release:publish          # bump patch, sign, and publish the release
# or: node deploy/release-extension.mjs --version 0.4.0 --publish
```

### One-time setup

1. **CI signing key** — the Action needs the signing key as a secret so every
   build keeps the same extension ID:
   ```bash
   gh secret set EXTENSION_PEM --repo notpritam/atlas < deploy/keys/atlas-extension.pem.b64
   ```
   (The key lives only in `deploy/keys/` on omni — gitignored — and in the secret.)

2. **Force-install + auto-update policy** on each browser machine (this is what
   lets an off-store extension install and silently update):
   - **Linux (Chrome):** copy `deploy/policy/atlas-extension.json` to
     `/etc/opt/chrome/policies/managed/` (Chromium: `/etc/chromium/...`), restart Chrome.
   - **macOS (Chrome):**
     ```bash
     defaults write com.google.Chrome ExtensionInstallForcelist -array \
       "mjfcgmboaijfcaanepdipbgmipnccnpn;https://github.com/notpritam/atlas/releases/latest/download/updates.xml"
     ```
     then fully quit + reopen Chrome.

   Verify at `chrome://policy` (Reload policies) and `chrome://extensions` — Atlas
   installs itself and can't be removed by hand. That's the "force update" behavior.
