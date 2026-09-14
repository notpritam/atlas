import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  CLOUD_IMAGE_MIME_TYPES,
  cloudImageMime,
} from "../apps/extension/src/image-formats.js";

const exec = promisify(execFile);
const root = path.resolve(".");
const archive = path.join(root, "deploy/dist/foundkeep-store-1.0.1.zip");

test("cloud image capture accepts exactly the formats supported by the API", () => {
  assert.deepEqual(CLOUD_IMAGE_MIME_TYPES, [
    "image/png",
    "image/jpeg",
    "image/webp",
  ]);
  assert.equal(cloudImageMime(new Blob([], { type: "image/PNG" })), "image/png");
  assert.throws(
    () => cloudImageMime(new Blob([], { type: "image/gif" })),
    /unsupported format/i,
  );
  assert.throws(() => cloudImageMime(new Blob([])), /unsupported format/i);
});

test("Chrome Web Store package is a focused version 1.0.1 MV3 build", async () => {
  assert.equal(
    (await readFile("deploy/store-version.txt", "utf8")).trim(),
    "1.0.1",
  );
  await exec("bash", ["deploy/pack-store.sh"], { cwd: root });
  const firstHash = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  await exec("bash", ["deploy/pack-store.sh"], { cwd: root });
  const secondHash = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  assert.equal(firstHash, secondHash);
  const { stdout: listing } = await exec("unzip", ["-Z1", archive]);
  const files = listing.trim().split("\n");
  assert.ok(files.includes("manifest.json"));
  assert.ok(files.includes("src/background.js"));
  assert.ok(files.includes("src/popup.html"));
  assert.ok(files.includes("src/dashboard.html"));
  assert.ok(files.includes("icons/icon128.png"));
  assert.ok(files.every((file) => !file.startsWith("foundkeep/")));
  assert.ok(files.every((file) => !/(?:^|\/)(?:README\.md|.*\.(?:pem|key))$/i.test(file)));
  assert.ok(files.every((file) => !/(?:agent|companion|relay|control-bg)/i.test(file)));

  const { stdout: manifestText } = await exec("unzip", [
    "-p",
    archive,
    "manifest.json",
  ]);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "1.0.1");
  assert.ok(
    [...manifest.description].length <= 132,
    `manifest description is ${[...manifest.description].length} characters; Chrome Web Store allows 132`,
  );
  assert.equal(manifest.key, undefined);
  assert.equal(manifest.update_url, undefined);
  assert.deepEqual(manifest.permissions, [
    "activeTab",
    "scripting",
    "contextMenus",
    "storage",
    "alarms",
    "sidePanel",
  ]);
  assert.deepEqual(manifest.optional_permissions, ["bookmarks"]);
  assert.equal(manifest.side_panel.default_path,"src/library.html");
  assert.ok(files.includes("src/bookmark-import.js"));
  assert.deepEqual(manifest.host_permissions, ["https://foundkeep.app/*"]);
  assert.equal(manifest.action.default_popup, undefined);
  assert.ok(files.includes("src/sidebar-capture.js"));
  assert.ok(files.includes("src/sidebar-local.js"));
  assert.deepEqual(manifest.optional_host_permissions, [
    "<all_urls>",
    "http://*/*",
    "https://*/*",
  ]);
  assert.equal(JSON.stringify(manifest).includes("debugger"), false);

  const source = (
    await Promise.all(
      files
        .filter((file) => /\.(?:js|html|css|json|md)$/i.test(file))
        .map(async (file) =>
          (await exec("unzip", ["-p", archive, file])).stdout,
        ),
    )
  ).join("\n");
  assert.doesNotMatch(source, /\b(?:eval|Function)\s*\(/);
  assert.doesNotMatch(
    source,
    /(?:local[\s_-]*companion|atlas-agent|agentUrl|agentEnrich|relayToken|relayUrl|control-bg)/i,
  );
  assert.doesNotMatch(source, /importScripts\s*\(\s*["']https?:\/\//i);
  assert.doesNotMatch(source, /\bimport\s*\(\s*["']https?:\/\//i);
  assert.doesNotMatch(source, /<script[^>]+src=["']https?:\/\//i);
});

test("the assigned Store extension is pre-authorized without replacing the migration build", async () => {
  const storeId = "cficnecbdbiddngllpfbacabgbcjinmk";
  const migrationId = "mjfcgmboaijfcaanepdipbgmipnccnpn";
  const customerConfig = JSON.parse(
    await readFile("apps/web/customer-config.json", "utf8"),
  );
  assert.deepEqual(customerConfig.extensionIds, [storeId, migrationId]);
  assert.equal(
    customerConfig.storeUrl,
    `https://chromewebstore.google.com/detail/${storeId}`,
    "Send customers to the public Store listing",
  );
  const backendConfig = await readFile("apps/backend/src/config.ts", "utf8");
  assert.match(backendConfig, new RegExp(storeId));
  assert.match(backendConfig, new RegExp(migrationId));
});
