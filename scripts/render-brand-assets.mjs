import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const mode = process.argv[2] || "all";
// Bookmark Evolved: one vector source for every first-party surface.
const source = path.join(root, "apps/web/assets/mark.svg");
const groups = [
  {
    name: "extension",
    alias: "apps/extension/assets/mark.svg",
    targets: [16, 32, 48, 128].map((size) => ({
      size,
      file: `apps/extension/icons/icon${size}.png`,
    })),
  },
  {
    name: "web",
    alias: "apps/web/assets/studio-mark.svg",
    targets: [
      { size: 192, file: "apps/web/assets/mark-192.png" },
      { size: 512, file: "apps/web/assets/mark-512.png" },
      { size: 512, file: "apps/web/assets/mark-maskable-512.png", square: true },
      { size: 180, file: "apps/web/assets/apple-touch-icon.png", square: true },
    ],
  },
  {
    name: "mobile",
    targets: [
      { size: 512, file: "apps/mobile/assets/images/mark.png" },
      { size: 1024, file: "apps/mobile/assets/images/icon.png", square: true },
      { size: 1024, file: "apps/mobile/assets/images/splash-icon.png" },
    ],
  },
].filter((group) => mode === "all" || mode === group.name);

if (!groups.length) throw new Error("Use extension, web, mobile, or all.");

const svg = await readFile(source, "utf8");
// Native launchers and maskable PWA icons supply their own corner mask.
const squareSvg = svg.replace('rx="11"', 'rx="0"');

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--no-sandbox"],
});

try {
  for (const group of groups) {
    if (group.alias) await copyFile(source, path.join(root, group.alias));
    for (const target of group.targets) {
      const imageSource = `data:image/svg+xml;base64,${Buffer.from(target.square ? squareSvg : svg).toString("base64")}`;
      const page = await browser.newPage({
        viewport: { width: target.size, height: target.size },
        deviceScaleFactor: 1,
      });
      await page.setContent(
        `<style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}img{display:block;width:100%;height:100%}</style><img src="${imageSource}" alt="">`,
      );
      await page.locator("img").evaluate((image) => image.decode());
      await page.screenshot({ path: path.join(root, target.file), omitBackground: !target.square });
      await page.close();
      console.log(`rendered ${target.file} (${target.size}x${target.size})`);
    }
  }
} finally {
  await browser.close();
}
