// Encode responsive web assets and render the native HTML social preview.
import { readFile, writeFile } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright-core"
);
const dir = new URL("../apps/web/assets/", import.meta.url);
const mark = await readFile(new URL("mark.svg", dir), "utf8");
const photo = await readFile(new URL("studio-architecture.png", dir));
const font = await readFile(new URL("fonts/ClarityCity-Bold.woff2", dir));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  for (const width of [640, 1024]) {
    const data = await page.evaluate(
      async ({ source, width }) => {
        const img = new Image();
        img.src = source;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = Math.round((width * img.height) / img.width);
        canvas
          .getContext("2d")
          .drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/webp", 0.85).split(",")[1];
      },
      { source: "data:image/png;base64," + photo.toString("base64"), width },
    );
    await writeFile(
      new URL(`studio-architecture-${width}.webp`, dir),
      Buffer.from(data, "base64"),
    );
  }
  const compact = await readFile(new URL("studio-architecture-640.webp", dir));
  await page.setContent(
    `<!doctype html><style>@font-face{font-family:Clarity;src:url(data:font/woff2;base64,${font.toString("base64")})}*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;background:#f3f3f0;color:#171917;font-family:Clarity,Arial,sans-serif;padding:44px 48px;position:relative}.brand{display:flex;gap:12px;align-items:center;font-size:29px}.brand svg{width:40px;height:40px}h1{margin:48px 0 22px;font-size:116px;letter-spacing:-6px;line-height:1.01}p{font:24px/1.5 Arial,sans-serif;margin:0;max-width:560px}.photo{position:absolute;right:48px;top:44px;width:400px;height:470px;object-fit:cover;border:8px solid #f3f3f0;outline:2px solid #c63b23}.footer{position:absolute;bottom:38px;left:48px;right:48px;padding-top:20px;border-top:1px solid #cdd0c6;display:flex;justify-content:space-between;font:16px Arial,sans-serif}.footer b{color:#c63b23}</style><div class="brand">${mark}Foundkeep</div><h1>Found it?<br>Keep it.</h1><p>Screenshots, highlights and stray ideas.<br>One library for your next good find.</p><img class="photo" src="data:image/webp;base64,${compact.toString("base64")}" alt=""><div class="footer"><b>Save a little curiosity.</b><span>foundkeep.app</span></div>`,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.locator("img").evaluate((img) => img.decode());
  await page.screenshot({ path: new URL("foundkeep-social.png", dir).pathname });
  console.log("Prepared responsive WebP images and 1200×630 social preview.");
} finally {
  await browser.close();
}
