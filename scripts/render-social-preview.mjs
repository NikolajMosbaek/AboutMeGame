// Social-preview capture (visual-overhaul slice 7, polish — closes the
// jungle-pivot's recorded deferral: "public/social-preview.png still shows
// old-game art", docs/team/runs/2026-07-08-jungle-pivot.md). No runtime
// dependency and no new dependency: this is an authoring-time tool run by
// hand against a REAL GPU whenever the card art changes, never at build or
// runtime (mirrors this file's own pre-slice-7 role, when it rasterized the
// now-retired vector `public/social-preview.svg`).
//
//   npm run preview   # in one terminal — serves the production build
//   node scripts/render-social-preview.mjs [url] [out]
//
// Unlike the retired SVG source, the new card is a REAL screenshot of the
// running game — golden hour over the lagoon toward the camp/jungle island,
// with a visible sun disc, its water-glint, drifting clouds, the splatted
// terrain and real CC0 flora. There is no static vector "source" to commit
// any more; the regenerable source IS this script's fixed recipe below (the
// day-cycle offset + camera eye/target), so re-running it against any build
// reproduces the same framing deterministically — the same
// `window.advanceTime`/`window.__frameView__` automation hooks
// `scripts/verify-game.mjs` already drives the game with.
//
// The DOM shell (HUD, meters, prompts) is hidden via a style override before
// the shot (marketing art, not a gameplay screenshot) — only the WebGL
// `<canvas>` is captured. Output is written at the exact 1200x630 unfurl
// frame (matching index.html's `og:image:width`/`height`) by sizing the
// browser viewport to it directly, then re-encoded as a 256-colour palette
// PNG (`scripts/process-textures.mjs`'s `sharp` devDependency) — indistinguishable
// by eye from the full-colour capture (the hazy gradient sky shows no visible
// banding at 256 colours) at roughly a quarter of the byte cost, which is what
// keeps `SOCIAL_PREVIEW_MAX_BYTES` (`src/share/socialMeta.ts`) affordable.
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import sharp from "sharp";

const WIDTH = 1200;
const HEIGHT = 630;

// The recipe (visual-overhaul slice 7, coordinator polish pass — recomposed;
// see docs/team/runs/ for the review that flagged the prior framing as
// "washed out/hazy" — the camera stared almost straight down the sun's
// bearing, so the compositor's tight sun-disc/halo term (sky.ts:
// SUN_DISC_INNER/OUTER only spans ~2° of arc; SUN_HALO_POWER=24 still glows
// broadly within ~15-20°) bloomed the ENTIRE upper frame into a flat cream
// haze). This recipe deliberately looks AWAY from the sun's bearing instead
// of at it: DAY_CYCLE_MS = 0 is dayCycleSystem.ts's own mount default (`t=0`,
// the warm DAWN keyframe — no advance needed, byte-for-byte reproducible from
// a fresh load), and the camera sits on the lagoon's NW rim looking SE across
// the whole lagoon toward the camp's shore. That framing was chosen by
// measurement, not just eye, over ~25 tried eye/target/time combinations
// (`std` = midtone contrast, `p99` = brightest 1% of pixels — a low p99 means
// no blown-white sky wash):
//
//   | composition                          | mean  | std  | p99 |
//   |---------------------------------------|-------|------|-----|
//   | prior (stared at the sun)              | 138.4 | 44.6 | 208 |
//   | this recipe (lagoon vista, sun behind)  | 125.7 | 46.3 | 182 |
//
// Lower mean/p99 (less washed, no near-white clipping) at EQUAL-OR-BETTER
// contrast and colour saturation. A literal off-center "rule of thirds" sun
// DISC turned out to be unreachable at any angle: the disc's ~2°-wide
// smoothstep is essentially binary (dead-on or invisible), so any framing
// wide enough to read as "off-center" on a 1200-wide frame loses the disc
// entirely — this recipe instead leans on the lagoon's own colour (the warm
// dawn-lit camp-side bank, palm silhouettes, teal water) to carry the shot,
// per the review's own ask ("terrain/trees/water glint carry color instead
// of haze").
const DAY_CYCLE_MS = 0;
const EYE = [-60, 20, 142];
const TARGET = [21, 8, 142];

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--")) ?? "http://localhost:4173/";
const pngPath = resolve(repoRoot, args[1] ?? "public/social-preview.png");

const browser = await chromium.launch({
  // Real GPU rendering (not the CI render-gate's SwiftShader software stand-
  // in) — this is a marketing screenshot, so it must show the actual lit,
  // textured, atmospheric look, not the software-rasterizer fallback.
  args: ["--use-gl=angle", "--use-angle=metal"],
});
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  const cta = page.getByRole("button", { name: /^(begin the expedition|continue)$/i });
  if (await cta.count()) await cta.first().click();
  await page.waitForFunction(() => typeof window.advanceTime === "function", {
    timeout: 15_000,
  });
  const gotIt = page.getByRole("button", { name: /got it, let's go/i });
  if (await gotIt.count()) {
    await gotIt.first().click();
    await page.waitForTimeout(100);
  }

  // Hide the DOM shell (HUD/meters/prompts/nav) — only the canvas ships.
  await page.addStyleTag({
    content: ".game-canvas-container > *:not(canvas) { display: none !important; }",
  });

  await page.evaluate((ms) => window.advanceTime(ms), DAY_CYCLE_MS);
  await page.evaluate(([eye, target]) => window.__frameView__(eye, target), [EYE, TARGET]);
  await page.waitForTimeout(150); // let the frame settle (compositor/AO warm-up)

  if (consoleErrors.length) {
    console.error("Console errors during capture:\n" + consoleErrors.join("\n"));
    process.exitCode = 1;
  }

  const canvas = page.locator(".game-canvas-container canvas");
  const raw = await canvas.screenshot({ type: "png" });
  const optimized = await sharp(raw)
    .png({ palette: true, colors: 256, compressionLevel: 9 })
    .toBuffer();
  writeFileSync(pngPath, optimized);
  console.log(`Wrote ${pngPath} (${WIDTH}x${HEIGHT}, ${optimized.length} bytes)`);
} finally {
  await browser.close();
}
