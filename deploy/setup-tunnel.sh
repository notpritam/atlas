#!/usr/bin/env bash
# Bring up the atlas.notpritam.in Cloudflare tunnel on omni.
#
# PREREQUISITE (interactive, run once): authorize cloudflared for the
# notpritam.in zone — opens a browser URL, pick the zone:
#
#     cloudflared tunnel login
#
# Then run this script. It is idempotent.
set -euo pipefail

TUNNEL=atlas
HOSTNAME=atlas.notpritam.in
PORT=8790
CFDIR="$HOME/.cloudflared"

if [ ! -f "$CFDIR/cert.pem" ]; then
  echo "!! $CFDIR/cert.pem not found. Run:  cloudflared tunnel login" >&2
  exit 1
fi

# 1. Create the tunnel if it doesn't exist.
if ! cloudflared tunnel list 2>/dev/null | awk '{print $2}' | grep -qx "$TUNNEL"; then
  cloudflared tunnel create "$TUNNEL"
fi
TID="$(cloudflared tunnel list | awk -v n="$TUNNEL" '$2==n{print $1}')"
echo "tunnel id: $TID"

# 2. Point the DNS record at the tunnel.
cloudflared tunnel route dns "$TUNNEL" "$HOSTNAME" || true

# 3. Write the ingress config.
cat > "$CFDIR/config.yml" <<CFG
tunnel: $TID
credentials-file: $CFDIR/$TID.json
ingress:
  - hostname: $HOSTNAME
    service: http://localhost:$PORT
  - service: http_status:404
CFG
echo "wrote $CFDIR/config.yml"

# 4. Install + start the systemd service (uses deploy/atlas-tunnel.service).
HERE="$(cd "$(dirname "$0")" && pwd)"
sudo cp "$HERE/atlas-tunnel.service" /etc/systemd/system/atlas-tunnel.service
sudo systemctl daemon-reload
sudo systemctl enable --now atlas-tunnel
sleep 3
systemctl is-active atlas-tunnel && echo "tunnel up → https://$HOSTNAME"
