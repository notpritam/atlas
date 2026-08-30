#!/usr/bin/env bash
# Regenerate apps/web/atlas-extension.zip from apps/extension so the landing
# page's "Download the extension" button ships the current code.
# (zip isn't installed on omni, so this uses python's zipfile.)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 - "$ROOT" <<'PY'
import zipfile, os, sys, shutil, tempfile
root = sys.argv[1]
src = os.path.join(root, "apps", "extension")
out = os.path.join(root, "apps", "web", "atlas-extension.zip")
include = ["manifest.json", "icons", "src", "README.md"]
with tempfile.TemporaryDirectory() as tmp:
    stage = os.path.join(tmp, "atlas-extension")
    os.makedirs(stage)
    for item in include:
        s, d = os.path.join(src, item), os.path.join(stage, item)
        shutil.copytree(s, d) if os.path.isdir(s) else shutil.copy2(s, d)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for r, _, fs in os.walk(stage):
            for f in fs:
                full = os.path.join(r, f)
                z.write(full, os.path.relpath(full, tmp))
print("wrote", out, os.path.getsize(out), "bytes")
PY
