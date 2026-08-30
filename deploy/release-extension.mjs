#!/usr/bin/env node
// Release the Atlas extension for self-hosted auto-update.
//
// Bumps the version, signs a .crx with a stable key, writes updates.xml (the
// Chrome update manifest), refreshes the plain .zip, and drops everything into
// apps/web so caddy serves it at atlas.notpritam.in. Chrome, once told to trust
// this extension via a one-time policy, then auto-updates silently every ~5h.
//
//   node deploy/release-extension.mjs            # bump patch, build, publish
//   node deploy/release-extension.mjs --version 0.4.0
//   node deploy/release-extension.mjs --no-bump  # rebuild same version
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import writeCRX3File from "crx3";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXT_DIR = join(ROOT, "apps", "extension");
const WEB_DIR = join(ROOT, "apps", "web");
const KEY_PATH = join(ROOT, "deploy", "keys", "atlas-extension.pem");
// Auto-update is served from GitHub Releases (stable "latest" asset URLs).
const REPO = "notpritam/atlas";
const CRX_URL = `https://github.com/${REPO}/releases/latest/download/atlas-extension.crx`;
const UPDATE_URL = `https://github.com/${REPO}/releases/latest/download/updates.xml`;

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

// 1. Stable signing key. In CI it comes from the EXTENSION_PEM_B64 secret; locally
//    it's a file generated once and kept out of git. The key fixes the ID forever.
mkdirSync(dirname(KEY_PATH), { recursive: true });
if (process.env.EXTENSION_PEM_B64) {
  writeFileSync(KEY_PATH, Buffer.from(process.env.EXTENSION_PEM_B64, "base64"));
} else if (!existsSync(KEY_PATH)) {
  if (process.env.CI) throw new Error("EXTENSION_PEM_B64 secret is required in CI");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  writeFileSync(KEY_PATH, privateKey.export({ type: "pkcs8", format: "pem" }));
  console.log("• generated new signing key at deploy/keys/atlas-extension.pem");
}

// 2. Public key → manifest "key" (pins the extension ID) + the ID itself.
const der = createPublicKey(createPrivateKey(readFileSync(KEY_PATH))).export({
  type: "spki",
  format: "der",
});
const manifestKey = der.toString("base64");
const extId = [...createHash("sha256").update(der).digest().subarray(0, 16).toString("hex")]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16)))
  .join("");

// 3. Update manifest.json: version, key, update_url.
const manifestPath = join(EXT_DIR, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (opt("--version")) {
  manifest.version = opt("--version");
} else if (!flag("--no-bump")) {
  const p = manifest.version.split(".").map(Number);
  p[2] = (p[2] || 0) + 1;
  manifest.version = p.join(".");
}
manifest.key = manifestKey;
manifest.update_url = UPDATE_URL;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

// 4. Gather the extension's files (relative to EXT_DIR).
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
const files = walk(EXT_DIR)
  .filter((f) => !f.endsWith(".DS_Store"))
  .map((f) => relative(EXT_DIR, f));

// 5. Sign the .crx and write updates.xml.
mkdirSync(join(WEB_DIR, "ext"), { recursive: true });
const crxPath = join(WEB_DIR, "ext", "atlas-extension.crx");
const xmlPath = join(WEB_DIR, "updates.xml");

process.chdir(EXT_DIR);
await writeCRX3File(files, {
  keyPath: KEY_PATH,
  crxPath,
  xmlPath,
  crxURL: CRX_URL,
  appVersion: manifest.version,
});

console.log(`\n  Atlas extension released`);
console.log(`  ────────────────────────────────`);
console.log(`  version    : ${manifest.version}`);
console.log(`  extension  : ${extId}`);
console.log(`  crx        : ${CRX_URL}`);
console.log(`  updates    : ${UPDATE_URL}`);
console.log(`\n  Force-install policy value:`);
console.log(`    ${extId};${UPDATE_URL}\n`);

// 6. Emit ready-to-use policy files with the ID baked in.
const policyDir = join(ROOT, "deploy", "policy");
mkdirSync(policyDir, { recursive: true });
writeFileSync(
  join(policyDir, "atlas-extension.json"),
  JSON.stringify({ ExtensionInstallForcelist: [`${extId};${UPDATE_URL}`] }, null, 2) + "\n",
);
writeFileSync(join(policyDir, "extension-id.txt"), extId + "\n");

// 7. Refresh the plain .zip so the release carries it too.
execFileSync("bash", [join(ROOT, "deploy", "pack-extension.sh")], {
  cwd: ROOT,
  stdio: "inherit",
});

// 8. Optionally publish a GitHub Release (needs an authenticated `gh`).
if (flag("--publish")) {
  const tag = `ext-v${manifest.version}`;
  const title = `Atlas extension v${manifest.version}`;
  const assets = [crxPath, xmlPath, join(WEB_DIR, "atlas-extension.zip")];
  try {
    execFileSync(
      "gh",
      ["release", "create", tag, "--repo", REPO, "--title", title, "--notes", title, ...assets],
      { stdio: "inherit" },
    );
  } catch {
    // tag already exists — just replace the assets
    execFileSync("gh", ["release", "upload", tag, "--repo", REPO, "--clobber", ...assets], {
      stdio: "inherit",
    });
  }
  console.log(`\n  published GitHub release ${tag}`);
}
