#!/usr/bin/env bash
# Build the CHROME WEB STORE upload zip from apps/extension.
#
# Unlike pack-extension.sh (self-hosted: keeps `key` + `update_url` for the
# GitHub-releases auto-update), the store build STRIPS both — the Web Store
# assigns the extension id and manages updates. Version is single-sourced from
# apps/extension/manifest.json. Output: deploy/dist/atlas-store-<version>.zip
# (gitignored — it's an upload artifact, and must never contain the signing key).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 - "$ROOT" <<'PY'
import zipfile, os, sys, json, shutil, tempfile
root = sys.argv[1]
src = os.path.join(root, "apps", "extension")
manifest = json.load(open(os.path.join(src, "manifest.json")))
version = manifest["version"]

# Store manifest = source manifest minus self-hosting fields.
manifest.pop("key", None)
manifest.pop("update_url", None)

outdir = os.path.join(root, "deploy", "dist")
os.makedirs(outdir, exist_ok=True)
out = os.path.join(outdir, f"atlas-store-{version}.zip")
include = ["icons", "assets", "src", "README.md"]  # manifest written fresh below
with tempfile.TemporaryDirectory() as tmp:
    stage = os.path.join(tmp, "atlas")
    os.makedirs(stage)
    json.dump(manifest, open(os.path.join(stage, "manifest.json"), "w"), indent=2)
    for item in include:
        s, d = os.path.join(src, item), os.path.join(stage, item)
        if os.path.isdir(s):
            shutil.copytree(s, d)
        elif os.path.exists(s):
            shutil.copy2(s, d)
    # Belt & braces: never ship a private key.
    for r, _, fs in os.walk(stage):
        for f in fs:
            if f.endswith(".pem") or f.endswith(".key"):
                os.remove(os.path.join(r, f))
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for r, _, fs in os.walk(stage):
            for f in fs:
                full = os.path.join(r, f)
                z.write(full, os.path.relpath(full, stage))  # flat root, no wrapper dir
print(f"wrote {out} ({os.path.getsize(out)} bytes) — Chrome Web Store ready (no key/update_url)")
PY
