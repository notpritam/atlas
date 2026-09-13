#!/usr/bin/env bash
# Regenerate the branded download plus the legacy update-compatible ZIP from
# apps/extension so both old links and the Foundkeep landing page stay valid.
# (zip isn't installed on omni, so this uses python's zipfile.)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 - "$ROOT" <<'PY'
import zipfile, os, sys, shutil, tempfile, json
root = sys.argv[1]
src = os.path.join(root, "apps", "extension")
include = json.load(open(os.path.join(root, "deploy", "extension-files.json")))
for archive, folder in [("foundkeep-extension.zip", "foundkeep-extension"), ("atlas-extension.zip", "atlas-extension")]:
    out = os.path.join(root, "apps", "web", archive)
    with tempfile.TemporaryDirectory() as tmp:
        stage = os.path.join(tmp, folder)
        os.makedirs(stage)
        for item in include:
            source, destination = os.path.join(src, item), os.path.join(stage, item)
            if not os.path.isfile(source):
                raise SystemExit(f"missing required extension file: {item}")
            os.makedirs(os.path.dirname(destination), exist_ok=True)
            shutil.copy2(source, destination)
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            for r, directories, fs in os.walk(stage):
                directories.sort()
                for f in sorted(fs):
                    full = os.path.join(r, f)
                    z.write(full, os.path.relpath(full, tmp))
    print("wrote", out, os.path.getsize(out), "bytes")
PY
