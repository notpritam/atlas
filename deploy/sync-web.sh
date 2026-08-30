#!/usr/bin/env bash
# Publish the landing page (and the freshly-packed extension zip) to the caddy
# web root at /srv/atlas-web. Run after changing apps/web or the extension.
# caddy serves atlas.notpritam.in/ from here; /home is 700 so it can't read
# apps/web directly.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# refresh the downloadable extension zip first
"$ROOT/deploy/pack-extension.sh"

sudo mkdir -p /var/www/atlas
sudo cp -rT "$ROOT/apps/web" /var/www/atlas
sudo chmod -R a+rX /var/www/atlas
echo "published $ROOT/apps/web -> /var/www/atlas  (https://atlas.notpritam.in/)"
