#!/usr/bin/env bash
# Build the CHROME WEB STORE upload zip from apps/extension.
#
# Unlike pack-extension.sh (self-hosted: keeps `key` + `update_url` for the
# GitHub-releases auto-update), the store build STRIPS both — the Web Store
# assigns the extension id and manages updates. The store channel has its own
# monotonic version in deploy/store-version.txt because the established
# self-hosted channel already has a different version history.
# Output: deploy/dist/foundkeep-store-<version>.zip
# (gitignored — it's an upload artifact, and must never contain the signing key).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
python3 - "$ROOT" <<'PY'
import zipfile, os, sys, json, re, shutil, tempfile
root = sys.argv[1]
src = os.path.join(root, "apps", "extension")
manifest = json.load(open(os.path.join(src, "manifest.json")))
version = open(os.path.join(root, "deploy", "store-version.txt")).read().strip()
if not re.fullmatch(r"(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}", version):
    raise SystemExit(f"invalid Chrome Web Store version: {version!r}")
description = manifest.get("description")
if not isinstance(description, str) or not description.strip():
    raise SystemExit("Chrome Web Store manifest description is required")
if len(description) > 132:
    raise SystemExit(
        f"Chrome Web Store manifest description is {len(description)} characters; maximum is 132"
    )

# Store manifest = source manifest minus self-hosting fields.
manifest["version"] = version
manifest.pop("key", None)
manifest.pop("update_url", None)

outdir = os.path.join(root, "deploy", "dist")
os.makedirs(outdir, exist_ok=True)
out = os.path.join(outdir, f"foundkeep-store-{version}.zip")
include = json.load(open(os.path.join(root, "deploy", "extension-files.json")))
include = [item for item in include if item not in ["manifest.json", "README.md"]]
with tempfile.TemporaryDirectory() as tmp:
    stage = os.path.join(tmp, "foundkeep")
    os.makedirs(stage)
    with open(os.path.join(stage, "manifest.json"), "w") as manifest_file:
        json.dump(manifest, manifest_file, indent=2)
        manifest_file.write("\n")
    for item in include:
        source, destination = os.path.join(src, item), os.path.join(stage, item)
        if not os.path.isfile(source):
            raise SystemExit(f"missing required extension file: {item}")
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        shutil.copy2(source, destination)
    with zipfile.ZipFile(out, "w") as z:
        for r, ds, fs in os.walk(stage):
            ds.sort()
            for f in sorted(fs):
                full = os.path.join(r, f)
                rel = os.path.relpath(full, stage)
                info = zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                with open(full, "rb") as source_file:
                    z.writestr(info, source_file.read(), compresslevel=9)
print(f"wrote {out} ({os.path.getsize(out)} bytes) — Chrome Web Store ready (no key/update_url)")
PY
