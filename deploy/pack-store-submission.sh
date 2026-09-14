#!/usr/bin/env bash
# Assemble the non-secret Chrome Web Store submission handoff.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(tr -d '[:space:]' < "$ROOT/deploy/store-version.txt")"
"$ROOT/deploy/pack-store.sh"

python3 - "$ROOT" "$VERSION" <<'PY'
import hashlib
import json
import os
import shutil
import struct
import sys
import tempfile
import zipfile

root, version = sys.argv[1:]
dist = os.path.join(root, "deploy", "dist")
store_zip = os.path.join(dist, f"foundkeep-store-{version}.zip")
assets = os.path.join(dist, f"store-assets-{version}")
required_assets = [
    "native-sidebar.png",
    "save-review.png",
    "local-library.png",
    "promo-small.png",
    "promo-marquee.png",
    "icon128.png",
]
missing = [name for name in required_assets if not os.path.isfile(os.path.join(assets, name))]
if missing:
    raise SystemExit(f"missing current {version} store assets in {assets}: " + ", ".join(missing))

with zipfile.ZipFile(store_zip) as archive:
    manifest = json.loads(archive.read("manifest.json"))
    if manifest.get("version") != version or "key" in manifest or "update_url" in manifest:
        raise SystemExit("Store upload version/signing fields are incorrect")
with open(store_zip, "rb") as handle:
    archive_hash = hashlib.sha256(handle.read()).hexdigest()
with open(os.path.join(assets, "ASSET_PROVENANCE.json")) as handle:
    provenance = json.load(handle)
if (provenance.get("storeVersion") != version or
        provenance.get("storeItem") != "cficnecbdbiddngllpfbacabgbcjinmk" or
        provenance.get("archiveSha256") != archive_hash or
        provenance.get("accountData") is not False):
    raise SystemExit("Store screenshot provenance does not match the upload")
for name in required_assets:
    expected = {"promo-small.png": (440, 280), "promo-marquee.png": (1400, 560), "icon128.png": (128, 128)}.get(name, (1280, 800))
    with open(os.path.join(assets, name), "rb") as handle:
        header = handle.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n" or struct.unpack(">II", header[16:24]) != expected:
        raise SystemExit(f"incorrect Store image dimensions: {name}")

output = os.path.join(dist, f"foundkeep-cws-submission-kit-{version}.zip")
with tempfile.TemporaryDirectory() as temporary:
    stage = os.path.join(temporary, f"foundkeep-cws-{version}")
    os.makedirs(os.path.join(stage, "assets"))
    files = [
        (store_zip, f"foundkeep-store-{version}.zip"),
        (os.path.join(root, "deploy", "STORE_LISTING.md"), "STORE_LISTING.md"),
        (os.path.join(root, "deploy", "STORE_REVIEWER_GUIDE.md"), "STORE_REVIEWER_GUIDE.md"),
        (os.path.join(root, "deploy", "STORE_RELEASE_AUDIT.md"), "STORE_RELEASE_AUDIT.md"),
        (os.path.join(assets, "ASSET_PROVENANCE.json"), "ASSET_PROVENANCE.json"),
    ]
    files += [(os.path.join(assets, name), os.path.join("assets", name)) for name in required_assets]
    for source, relative in files:
        destination = os.path.join(stage, relative)
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        shutil.copyfile(source, destination)

    hashes = []
    for directory, subdirs, names in os.walk(stage):
        subdirs.sort()
        for name in sorted(names):
            full = os.path.join(directory, name)
            relative = os.path.relpath(full, stage)
            with open(full, "rb") as handle:
                digest = hashlib.sha256(handle.read()).hexdigest()
            hashes.append(f"{digest}  {relative}")
    with open(os.path.join(stage, "SHA256SUMS"), "w") as handle:
        handle.write("\n".join(hashes) + "\n")

    with zipfile.ZipFile(output, "w") as archive:
        for directory, subdirs, names in os.walk(stage):
            subdirs.sort()
            for name in sorted(names):
                full = os.path.join(directory, name)
                relative = os.path.relpath(full, temporary)
                info = zipfile.ZipInfo(relative, date_time=(2026, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                with open(full, "rb") as source:
                    archive.writestr(info, source.read(), compresslevel=9)
print(f"wrote {output} ({os.path.getsize(output)} bytes) — no credentials included")
PY
