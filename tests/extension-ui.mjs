// Run with PLAYWRIGHT_MODULE and CHROMIUM_PATH overrides when using an existing browser install.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright-core"
);
const root = path.resolve("apps/extension");
let browser;
before(async () => {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox"],
  });
});
after(async () => {
  await browser?.close();
});
async function pageWithExtension(t, { saveFails = false, preferences = null } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  t.after(() => context.close());
  await context.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== "atlas.test") return route.abort();
    const file = path.join(root, decodeURIComponent(u.pathname));
    const contentType =
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".woff2": "font/woff2",
      }[path.extname(file)] || "application/octet-stream";
    try {
      await route.fulfill({ contentType, body: await readFile(file) });
    } catch {
      await route.fulfill({ status: 404, body: "Not found" });
    }
  });
  await context.addInitScript(
    ({ saveFails, preferences }) => {
      let settings = {};
      window.__closed = false;
      window.close = () => { window.__closed = true; };
      window.__captureRequests = [];
      window.__preferences = preferences || {
        version: 1,
        capture: { region: true, fullPage: true, highlight: true, bookmark: true, image: true, tweet: true, note: true },
        bookmark: { readableText: true, extendedMetadata: true, headings: true },
        notes: { attachSource: true },
        popup: { actionOrder: ["bookmark", "highlight", "region", "fullPage"], showRecent: true, recentCount: 3 },
        sync: { automatic: true },
        organization: { ocr: true, summaries: true, tags: true },
        feedback: { success: true },
        contextMenus: true,
      };
      window.__cloudStatus = {
        account: null,
        status: "disconnected",
        pending: 0,
        failed: 0,
        synced: 0,
        localOnly: 0,
        otherAccount: 0,
        error: null,
      };
      window.__imports = [];
      window.chrome = {
        storage: {
          local: {
            get: async () => settings,
            set: async (p) => {
              Object.assign(settings, p);
            },
          },
          onChanged: { addListener: () => {} },
        },
        runtime: {
          getManifest: () => ({ version: "9.8.7" }),
          getURL: (p) => "http://atlas.test/" + p,
          onMessage: { addListener: () => {}, removeListener: () => {} },
          sendMessage: async (m) => {
            if (m.kind === "preferences-status")
              return { ok: true, preferences: window.__preferences, revision: 1, source: "cache" };
            if (m.kind === "capture") {
              window.__captureRequests.push(m);
              await new Promise((resolve) => setTimeout(resolve, 60));
              return { ok: true, status: m.action === "region" ? "started" : "saved" };
            }
            if (m.kind === "cloud-status")
              return { ok: true, ...window.__cloudStatus };
            if (m.kind === "cloud-import") {
              window.__imports.push(m);
              return { ok: true, imported: window.__cloudStatus.localOnly };
            }
            if (m.kind === "cloud-retry") return { ok: true };
            if (m.kind === "cloud-disconnect") {
              window.__cloudStatus.account = null;
              window.__cloudStatus.status = "disconnected";
              return { ok: true };
            }
            if (m.kind === "saveNote") {
              if (saveFails) return { ok: false, error: "Disk full" };
              const db = await import("/src/db.js");
              await db.addCapture({
                type: "note",
                noteText: m.text,
                sourceTitle: m.source === "library" ? null : "Sample article",
                sourceUrl:
                  m.source === "library" ? null : "https://example.com/article",
              });
              return { ok: true };
            }
            return { relay: false, connected: false };
          },
        },
        tabs: {
          query: async () => [
            {
              id: 1,
              title: "Sample article",
              url: "https://example.com/article",
            },
          ],
          create: async (p) => {
            window.__opened = p.url;
          },
        },
      };
    },
    { saveFails, preferences },
  );
  return context.newPage();
}
test("library opens without hidden settings covering saved content", async (t) => {
  const page = await pageWithExtension(t);
  await page.goto("http://atlas.test/src/dashboard.html");
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator("#settings").isVisible(),
    false,
    "Settings must not cover the library on first load",
  );
});
test("failed note save retains the draft for retry", async (t) => {
  const page = await pageWithExtension(t, { saveFails: true });
  await page.goto("http://atlas.test/src/popup.html");
  await page.locator("#note").fill("This draft must survive a failed save.");
  await page.locator("#save").click();
  await page.waitForTimeout(100);
  assert.equal(
    await page.locator("#note").inputValue(),
    "This draft must survive a failed save.",
  );
});
async function seed(page, records) {
  return page.evaluate(async (records) => {
    const db = await import("/src/db.js");
    const ids = [];
    for (const record of records) {
      const c = await db.addCapture(record);
      await db.updateCapture(c.id, {
        tags: record.tags || [],
        category: record.category || null,
        createdAt: record.createdAt || Date.now(),
      });
      ids.push(c.id);
    }
    return ids;
  }, records);
}
test("successful note save persists locally, clears only the saved draft, and links to its detail", async (t) => {
  const page = await pageWithExtension(t);
  await page.goto("http://atlas.test/src/popup.html");
  await page.locator("#note").fill("A useful thought");
  await page.locator("#save").click();
  await page.waitForFunction(() =>
    document.querySelector("#saveFeedback").textContent.includes("Saved"),
  );
  assert.equal(await page.locator("#note").inputValue(), "");
  const notes = await page.evaluate(async () => {
    const db = await import("/src/db.js");
    return db.listCaptures();
  });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].noteText, "A useful thought");
  await page.locator(".recent-item").click();
  assert.equal(
    await page.evaluate(() => window.__opened),
    `http://atlas.test/src/dashboard.html#capture=${notes[0].id}`,
  );
});
test("keyword search, type/tag filters and sort preserve actual capture records", async (t) => {
  const page = await pageWithExtension(t);
  await page.goto("http://atlas.test/src/dashboard.html");
  await seed(page, [
    {
      type: "note",
      noteText: "Remember the copper door",
      tags: ["architecture"],
      category: "Design",
      createdAt: 1000,
    },
    {
      type: "highlight",
      selectionText: "The meaning of a quiet space",
      sourceTitle: "Quiet spaces",
      tags: ["reading"],
      createdAt: 2000,
    },
    { type: "bookmark", sourceTitle: "Copper colour study", createdAt: 3000 },
  ]);
  await page.reload();
  await page.waitForSelector(".capture-card");
  assert.equal(await page.locator(".capture-card").count(), 3);
  if (process.env.FOUNDKEEP_LIBRARY_SCREENSHOT) {
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.screenshot({ path: process.env.FOUNDKEEP_LIBRARY_SCREENSHOT });
  }
  await page.locator("#q").fill("copper");
  await page.waitForFunction(
    () => document.querySelectorAll(".capture-card").length === 2,
  );
  await page.locator('#typeFilters [data-type="note"]').click();
  await page.waitForFunction(
    () => document.querySelectorAll(".capture-card").length === 1,
  );
  assert.match(await page.locator(".card-title").textContent(), /copper door/);
  await page.locator("#resetFilters").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".capture-card").length === 3,
  );
  await page.locator("#sort").selectOption("oldest");
  await page.waitForFunction(() =>
    document.querySelector(".card-title").textContent.includes("copper door"),
  );
  await page
    .locator("#tagFilters button")
    .filter({ hasText: "reading" })
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll(".capture-card").length === 1,
  );
  assert.match(await page.locator(".card-title").textContent(), /quiet space/);
});
test("captured markup remains text and unsafe source URLs are not navigable", async (t) => {
  const page = await pageWithExtension(t);
  await page.goto("http://atlas.test/src/dashboard.html");
  await seed(page, [
    {
      type: "note",
      noteText: "Safe note",
      sourceUrl: "javascript:window.compromised=true",
      tags: ["<img src=x onerror=window.compromised=true>"],
      category: "<svg onload=window.compromised=true>",
    },
  ]);
  await page.reload();
  await page.waitForSelector(".capture-card");
  assert.equal(
    await page.locator("#tagFilters img, #facetFilters svg").count(),
    0,
  );
  await page.locator(".capture-card").click();
  assert.equal(await page.locator("#sourceLink").isVisible(), false);
  assert.equal(await page.evaluate(() => window.compromised), undefined);
});
test("keyboard focus survives filtering, refreshing an open detail, and closing settings", async (t) => {
  const page = await pageWithExtension(t);
  await page.goto("http://atlas.test/src/dashboard.html");
  await seed(page, [{ type: "highlight", selectionText: "Keep this line" }]);
  await page.reload();
  await page.waitForSelector(".capture-card");
  const filter = page.locator('#typeFilters [data-type="highlight"]');
  await filter.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => document.querySelector("#libraryTitle").textContent === "Highlights.",
  );
  assert.equal(
    await page.evaluate(() => document.activeElement.dataset.focusKey),
    "type:highlight",
  );
  const key = await page
    .locator(".capture-card")
    .getAttribute("data-focus-key");
  await page.locator(".capture-card").focus();
  await page.keyboard.press("Enter");
  await page.waitForSelector("#overlay[open]");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(100);
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(() => document.activeElement.dataset.focusKey),
    key,
  );
  await page.locator("#settingsBtn").click();
  await page.locator("#settingsClose").click();
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    "settingsBtn",
  );
});
test("customer settings expose account connection and local-library guidance only", async (t) => {
  const page = await pageWithExtension(t);
  await page.goto("http://atlas.test/src/dashboard.html");
  await page.locator("#settingsBtn").click();
  assert.equal(await page.locator("#relayUrl").count(), 0);
  assert.equal(await page.locator("#relayToken").count(), 0);
  assert.equal(await page.locator("#agentUrl").count(), 0);
  assert.equal(await page.locator("#enrichEnabled").count(), 0);
  await page.getByRole("heading", { name: "Local library" }).waitFor();
  await page.getByText("Copies stay in this browser.", { exact: false }).waitFor();
});
test("popup offers real account connection and preserves a local-library fallback while offline", async (t) => {
  const page = await pageWithExtension(t);
  await page.goto("http://atlas.test/src/popup.html");
  await page.locator("#popup-cloudAction").click();
  assert.equal(
    await page.evaluate(() => window.__opened),
    "https://foundkeep.app/dashboard.html",
  );
  await page.evaluate(() => {
    window.__cloudStatus = {
      account: { id: "account-a", email: "alice@example.test", name: "Alice" },
      status: "reconnect",
      pending: 2,
      failed: 0,
      localOnly: 1,
      synced: 0,
      otherAccount: 0,
      error: "Reconnect this browser to resume syncing.",
    };
    window.dispatchEvent(new Event("focus"));
  });
  await page.waitForFunction(() =>
    document
      .querySelector("#popup-cloudAction")
      .textContent.includes("Reconnect"),
  );
  assert.match(
    await page.locator("#popup-cloudStatus").textContent(),
    /Reconnect/,
  );
  await page.locator("#openLocalLib").click();
  assert.equal(
    await page.evaluate(() => window.__opened),
    "http://atlas.test/src/dashboard.html",
  );
});
test("historical import requires explicit confirmation showing the destination account", async (t) => {
  const page = await pageWithExtension(t);
  await page.goto("http://atlas.test/src/dashboard.html");
  await page.evaluate(() => {
    window.__cloudStatus = {
      account: { id: "account-a", email: "alice@example.test", name: "Alice" },
      status: "connected",
      pending: 0,
      failed: 0,
      synced: 0,
      localOnly: 3,
      otherAccount: 2,
      error: null,
    };
  });
  await page.locator("#settingsBtn").click();
  await page.locator("#cloudImport").click();
  assert.match(
    await page.locator("#cloudImportText").textContent(),
    /alice@example.test/,
  );
  assert.equal(await page.evaluate(() => __imports.length), 0);
  await page.locator("#cloudImportCancel").click();
  assert.equal(await page.evaluate(() => __imports.length), 0);
  await page.locator("#cloudImport").click();
  await page.locator("#cloudImportConfirm").click();
  assert.deepEqual(await page.evaluate(() => __imports), [
    { kind: "cloud-import", confirmed: true, accountId: "account-a" },
  ]);
});
test("mobile retains tag filtering and popup keeps Open library within Chrome height limit", async (t) => {
  const page = await pageWithExtension(t);
  await page.goto("http://atlas.test/src/dashboard.html");
  await seed(page, [
    { type: "note", noteText: "Mobile note", tags: ["mobile"] },
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForSelector(".capture-card");
  assert.equal(await page.locator("#tagFilters button").isVisible(), true);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.goto("http://atlas.test/src/popup.html");
  await page.waitForSelector(".recent-item");
  const b = await page.locator("#openLib").boundingBox();
  assert.ok(
    b.y + b.height <= 600,
    "Library shortcut must remain within the 600px Chrome action popup",
  );
  const saveButton = await page.locator("#save").boundingBox();
  const footer = await page.locator(".popup-foot").boundingBox();
  assert.ok(
    saveButton.y + saveButton.height <= footer.y,
    `Quick-note save remains visible above the popup footer (${JSON.stringify({ saveButton, footer })})`,
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "The popup must not overflow horizontally",
  );
  assert.equal(
    await page.locator("#recent").evaluate((node) => getComputedStyle(node).overflowY),
    "visible",
    "Recent captures must not create a nested scroll area",
  );
  if (process.env.ATLAS_POPUP_LANDING_SCREENSHOT)
    await page.locator("#view-main").screenshot({ path: process.env.ATLAS_POPUP_LANDING_SCREENSHOT });
});
test("popup follows customer action controls and reports capture progress without closing", async (t) => {
  const preferences = {
    version: 1,
    capture: { region: false, fullPage: true, highlight: true, bookmark: true, image: true, tweet: true, note: true },
    bookmark: { readableText: true, extendedMetadata: true, headings: true },
    notes: { attachSource: true },
    popup: { actionOrder: ["fullPage", "bookmark", "highlight", "region"], showRecent: false, recentCount: 0 },
    sync: { automatic: true },
    organization: { ocr: true, summaries: true, tags: true },
    feedback: { success: true },
    contextMenus: true,
  };
  const page = await pageWithExtension(t, { preferences });
  await page.setViewportSize({ width: 392, height: 600 });
  await page.goto("http://atlas.test/src/popup.html");
  await page.waitForFunction(() => document.body.dataset.preferencesReady === "true");
  assert.deepEqual(
    await page.locator("#secondaryActions [data-feature]:visible").evaluateAll((nodes) => nodes.map((node) => node.dataset.feature)),
    ["fullPage", "highlight"],
  );
  assert.equal(await page.locator('[data-feature="region"]').isHidden(), true);
  assert.equal(await page.locator("#recentSection").isHidden(), true);
  const capture = page.locator("#savePage");
  await capture.click({ noWaitAfter: true });
  await page.waitForFunction(() => document.querySelector("#savePage")?.getAttribute("aria-busy") === "true");
  await page.waitForFunction(() => document.querySelector("#captureFeedback")?.textContent.includes("Saved"));
  assert.equal(await capture.getAttribute("aria-busy"), null);
  assert.equal(await page.evaluate(() => window.__closed), false);
  assert.deepEqual(await page.evaluate(() => window.__captureRequests), [
    { kind: "capture", action: "savepage" },
  ]);
  const footer = await page.locator(".popup-foot").boundingBox();
  assert.ok(footer.y + footer.height <= 600);
  if (process.env.ATLAS_POPUP_SCREENSHOT)
    await page.screenshot({ path: process.env.ATLAS_POPUP_SCREENSHOT });
});
test("new library note saves and deletion requires confirmation", async (t) => {
  const page = await pageWithExtension(t);
  await page.goto("http://atlas.test/src/dashboard.html");
  await page.locator("#newNote").click();
  await page.locator("#libraryNote").fill("A library thought");
  await page.locator("#saveLibraryNote").click();
  await page.waitForSelector(".capture-card");
  assert.match(
    await page.locator(".card-title").textContent(),
    /A library thought/,
  );
  await page.locator(".capture-card").click();
  page.once("dialog", (d) => d.dismiss());
  await page.locator("#deleteCapture").click();
  assert.equal(await page.locator("#overlay").isVisible(), true);
  page.once("dialog", (d) => d.accept());
  await page.locator("#deleteCapture").click();
  await page.waitForSelector("#empty", { state: "visible" });
  assert.equal(await page.locator(".capture-card").count(), 0);
});
