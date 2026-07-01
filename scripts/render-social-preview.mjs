// F1 slice 1 (#129) — T3: rasterize the committed social-preview SVG source to
// the emitted PNG, OFFLINE, using the already-present playwright devDependency.
// No runtime dependency and no new dependency: this is an authoring-time tool
// run by hand when the card art changes, never at build or runtime.
//
//   node scripts/render-social-preview.mjs
//
// It loads public/social-preview.svg into a headless Chromium page sized to the
// exact 1200x630 unfurl frame at deviceScaleFactor 1 (so the PNG is emitted at
// precisely 1200x630, matching og:image:width/height), screenshots the page,
// and writes public/social-preview.png. We ship the PNG (not the SVG) as the
// og:image because SVG og:image is unreliable across Facebook/X/LinkedIn/Slack
// crawlers; the SVG stays committed as the regenerable source.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const WIDTH = 1200;
const HEIGHT = 630;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const svgPath = resolve(repoRoot, "public/social-preview.svg");
const pngPath = resolve(repoRoot, "public/social-preview.png");

const svg = readFileSync(svgPath, "utf8");

// Zero all default page margins/scroll so the SVG fills the viewport 1:1 and
// the screenshot is exactly WIDTHxHEIGHT with no white gutter.
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0}
  html,body{width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden;background:transparent}
  svg{display:block}
</style></head><body>${svg}</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  await page.setContent(html, { waitUntil: "networkidle" });
  const buffer = await page.screenshot({
    type: "png",
    clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
  });
  writeFileSync(pngPath, buffer);
  console.log(`Wrote ${pngPath} (${WIDTH}x${HEIGHT}, ${buffer.length} bytes)`);
} finally {
  await browser.close();
}
