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

## Cloudflare tunnel (needs a one-time interactive login)

```bash
cloudflared tunnel login        # opens a browser; authorize the notpritam.in zone
./deploy/setup-tunnel.sh        # creates tunnel, routes DNS, installs the service
```

Result: `https://atlas.notpritam.in` → `http://localhost:8790`, no inbound ports
opened. Logs: `sudo journalctl -u atlas-tunnel -f`.

## Wiring the bb plugin (already done)

```bash
bb plugin config tracker set atlasBaseUrl "http://localhost:8790"
bb plugin config tracker set atlasDeviceToken "<read,enrich token>"
bb plugin reload tracker
```

## Wiring the extension

Load `apps/extension` unpacked in Chrome, then in the popup Settings enter
`https://atlas.notpritam.in` and the **ingest** token.
