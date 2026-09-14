// Exercise the real MV3 background worker and IndexedDB in a temporary profile.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright-core"
);

test("extension presents the FoundKeep identity while preserving its signed ID", async () => {
  const manifest = JSON.parse(await readFile("apps/extension/manifest.json", "utf8"));
  assert.equal(manifest.name, "FoundKeep — Save what matters");
  assert.equal(manifest.action.default_title, "FoundKeep");
  assert.deepEqual(manifest.externally_connectable.matches, [
    "https://foundkeep.app/*",
    "https://atlas.notpritam.in/*",
  ]);
  assert.ok(Object.values(manifest.commands).every((command) => command.description.includes("FoundKeep")));
  assert.equal(manifest.key.startsWith("MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A"), true);

  for (const file of ["src/popup.html", "src/dashboard.html"]) {
    const source = await readFile(`apps/extension/${file}`, "utf8");
    assert.match(source, /FoundKeep/);
    assert.doesNotMatch(source, />\s*Atlas(?:\s|<)/);
  }
  for (const size of [16, 32, 48, 128]) {
    const png = await readFile(`apps/extension/icons/icon${size}.png`);
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});

test(
  "installed extension captures selected text, a link, screenshots, and a note into its shared library",
  { timeout: 30000 },
  async () => {
    const profile = await mkdtemp(
      path.join(os.tmpdir(), "atlas-extension-test-"),
    );
    // Headless Chromium cannot click the browser toolbar action that grants
    // activeTab. Use a byte-for-byte source copy with only the equivalent
    // captureVisibleTab test permission added; the real manifest is checked
    // separately and keeps its narrow production permissions.
    const extension = await mkdtemp(path.join(os.tmpdir(), "foundkeep-smoke-build-"));
    await cp(path.resolve("apps/extension"), extension, { recursive: true });
    const testManifestPath = path.join(extension, "manifest.json");
    const testManifest = JSON.parse(await readFile(testManifestPath, "utf8"));
    testManifest.host_permissions.push("<all_urls>");
    await writeFile(testManifestPath, JSON.stringify(testManifest));
    const source = "https://foundkeep.app/__extension-test-fixture";
    const fixture = '<!doctype html><html lang="en"><head><title>Capture fixture</title><link rel="canonical" href="/original"/><meta name="author" content="Mina Rao"/><meta name="description" content="A fixture worth preserving."/><style>body{margin:40px;background:#f3f3f0;font:24px system-ui}article{height:400px}</style></head><body><article><h1>Good things worth keeping</h1><p id="selection">A good collection starts with noticing.</p></article></body></html>';
    let context;
    try {
      context = await chromium.launchPersistentContext(profile, {
        channel: "chromium",
        headless: true,
        executablePath: process.env.CHROMIUM_PATH || undefined,
        args: [
          "--no-sandbox",
          `--disable-extensions-except=${extension}`,
          `--load-extension=${extension}`,
        ],
      });
      await context.route(source, (route) => route.fulfill({
        status: 200,
        contentType: "text/html",
        body: fixture,
      }));
      const worker =
        context.serviceWorkers()[0] ||
        (await context.waitForEvent("serviceworker"));
      const id = new URL(worker.url()).host;
      const web = await context.newPage();
      await web.goto(source);
      await web.evaluate(() => {
        const range = document.createRange();
        range.selectNodeContents(document.querySelector("#selection"));
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      });
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${id}/src/popup.html`);
      await web.bringToFront();
      await popup.evaluate(() => {
        window.close = () => {};
      });
      // This test opens the popup as a tab; capture messages target the active fixture tab.
      const count = async (n) =>
        popup.waitForFunction(
          (n) =>
            document.querySelector("#savedCount").textContent === `${n} saved`,
          n,
        );
      await count(0);
      await popup.evaluate(() =>
        chrome.runtime.sendMessage({ kind: "capture", action: "highlight" }),
      );
      await count(1);
      let captures = await popup.evaluate(async () => {
        const db = await import("./db.js");
        return db.listCaptures();
      });
      assert.equal(
        captures[0].selectionText,
        "A good collection starts with noticing.",
      );
      assert.equal(captures[0].sourceUrl, source);
      await popup.evaluate(() =>
        chrome.runtime.sendMessage({ kind: "capture", action: "savepage" }),
      );
      await count(2);
      captures = await popup.evaluate(async () => {
        const db = await import("./db.js");
        return db.listCaptures();
      });
      const bookmark = captures.find((capture) => capture.type === "bookmark");
      assert.match(bookmark.articleText, /Good things worth keeping/);
      assert.equal(bookmark.provenance.pageUrl, source);
      assert.equal(bookmark.provenance.canonicalUrl, "https://foundkeep.app/original");
      assert.deepEqual(bookmark.provenance.authors, ["Mina Rao"]);
      assert.match(bookmark.provenance.contentHash, /^[A-Za-z0-9_-]{43}$/);
      const highlight = captures.find((capture) => capture.type === "highlight");
      assert.equal(highlight.provenance.pageUrl, source);
      assert.equal(highlight.provenance.captureMethod, "popup-highlight");
      await popup.evaluate(() =>
        chrome.runtime.sendMessage({ kind: "capture", action: "fullpage" }),
      );
      await count(3);
      // Chrome limits captureVisibleTab to two calls per second.
      await web.waitForTimeout(600);
      await popup.evaluate(() =>
        chrome.runtime.sendMessage({ kind: "capture", action: "region" }),
      );
      await web.getByText("Drag to capture · Esc to cancel").waitFor();
      await web.mouse.move(50, 70);
      await web.mouse.down();
      await web.mouse.move(250, 210);
      await web.mouse.up();
      await count(4);
      const shots = await popup.evaluate(async () => {
        const db = await import("./db.js");
        return (await db.listCaptures())
          .filter((c) => c.type === "screenshot")
          .map((c) => ({
            width: c.width,
            height: c.height,
            bytes: c.blob.size,
          }));
      });
      assert.equal(shots.length, 2);
      assert.ok(shots.every((c) => c.bytes > 0));
      assert.ok(shots.some((c) => c.width === 200 && c.height === 140));
      await popup.locator("#note").fill("Actual extension note");
      await popup.locator("#save").click();
      await popup.waitForFunction(() => document.querySelector('#saveFeedback').textContent.includes('Choose where'));
      const reviewed = await popup.evaluate(async () => {
        const { id: windowId } = await chrome.windows.getCurrent();
        const { draft } = await chrome.runtime.sendMessage({ kind: 'save-review-get', windowId });
        return chrome.runtime.sendMessage({ kind: 'save-review-confirm', windowId, id: draft.id, choice: { kind: 'local' } });
      });
      assert.equal(reviewed.ok, true, reviewed.error);
      await count(5);
      await worker.evaluate(async () => {
        const preferences = {
          version: 1,
          capture: { region: true, fullPage: true, highlight: false, bookmark: true, image: true, tweet: true, note: true },
          bookmark: { readableText: false, extendedMetadata: false, headings: false },
          notes: { attachSource: true },
          popup: { actionOrder: ["bookmark", "highlight", "region", "fullPage"], showRecent: true, recentCount: 3 },
          sync: { automatic: true },
          organization: { ocr: true, summaries: true, tags: true },
          feedback: { success: true },
          contextMenus: true,
        };
        await chrome.storage.local.set({
          atlasCustomer: {
            account: { id: "account-a", email: "person@example.test", name: "Person" },
            connection: { id: "connection-a" },
            token: "t".repeat(43),
            status: "connected",
          },
          atlasPreferenceCache: {
            accountId: "account-a",
            preferences,
            revision: 3,
            updatedAt: Date.now(),
            fetchedAt: Date.now(),
          },
        });
      });
      await web.bringToFront();
      const disabled = await popup.evaluate(() =>
        chrome.runtime.sendMessage({ kind: "capture", action: "highlight" }),
      );
      assert.equal(disabled.ok, false);
      assert.match(disabled.error, /disabled/i);
      await popup.evaluate(() =>
        chrome.runtime.sendMessage({ kind: "capture", action: "savepage" }),
      );
      await count(6);
      const minimalBookmark = await popup.evaluate(async () => {
        const db = await import("./db.js");
        return (await db.listCaptures()).find((capture) => capture.type === "bookmark" && capture.cloudAccountId);
      });
      assert.equal(minimalBookmark.articleText, null);
      assert.deepEqual(minimalBookmark.provenance.authors, []);
      assert.equal(minimalBookmark.processingOptions.ocr, true);
      const lib = await context.newPage();
      await lib.goto(`chrome-extension://${id}/src/dashboard.html`);
      await lib.waitForSelector(".capture-card");
      assert.equal(await lib.locator(".capture-card").count(), 6);
      assert.equal(await lib.locator("#settings").isVisible(), false);
      const finalCaptures = await popup.evaluate(async () => {
        const db = await import("./db.js");
        return db.listCaptures();
      });
      assert.ok(finalCaptures.every((capture) => capture.provenance?.schemaVersion === 1));
      assert.ok(finalCaptures.every((capture) => capture.provenance?.pageUrl === source));
    } finally {
      await context?.close();
      await rm(profile, { recursive: true, force: true });
      await rm(extension, { recursive: true, force: true });
    }
  },
);
