// Instrumented frame-cost measurement (docs/perf-budget.md's method, scripted
// — jungle-density epic 2026-07-19). `Engine`'s render_game_to_text reads
// three's `renderer.info`, which the medium/high EffectComposer RESETS on
// every internal render pass — the last being the full-screen output triangle
// — so on compositor tiers that field reads a useless "1 draw / 1 triangle".
// This wraps the raw WebGL2 draw calls instead (renderer-agnostic, survives
// any number of composer passes) and tallies triangles per RAF frame.
//
//   npm run build && npm run preview &
//   node scripts/measure-frame-cost.mjs http://localhost:4173/ high
//
// Tier is forced through the persisted settings key; only "low"/"high" can be
// forced ("medium" is auto-detect-only — see resolveQuality). Reports the
// spawn camp-vista average (the doc's reference vantage — measured MAX, it
// faces the palm shore + animated water) and a jungle-interior vantage via
// the __frameView__ automation hook.
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:4173/";
const tier = process.argv[3] ?? "high";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript((q) => {
  localStorage.setItem(
    "aboutmegame.settings.v1",
    JSON.stringify({ muted: true, quality: q, reducedMotion: false }),
  );
  window.__glStats = { frames: [], current: { draws: 0, tris: 0 } };
  const tri = (mode, count, inst = 1) =>
    mode === 4 ? (count / 3) * inst : mode === 5 || mode === 6 ? Math.max(0, count - 2) * inst : 0;
  const wrap = (name, calc) => {
    const proto = WebGL2RenderingContext.prototype;
    const orig = proto[name];
    proto[name] = function (...args) {
      window.__glStats.current.draws++;
      window.__glStats.current.tris += calc(args);
      return orig.apply(this, args);
    };
  };
  wrap("drawElements", (a) => tri(a[0], a[1]));
  wrap("drawArrays", (a) => tri(a[0], a[2]));
  wrap("drawElementsInstanced", (a) => tri(a[0], a[1], a[4]));
  wrap("drawArraysInstanced", (a) => tri(a[0], a[2], a[3]));
  const origRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) =>
    origRaf((t) => {
      const c = window.__glStats.current;
      if (c.draws > 0) {
        window.__glStats.frames.push({ ...c });
        if (window.__glStats.frames.length > 400) window.__glStats.frames.shift();
      }
      window.__glStats.current = { draws: 0, tris: 0 };
      cb(t);
    });
}, tier);

await page.goto(url);
const cta = page.getByRole("button", { name: /^(begin the expedition|continue)$/i });
if (await cta.count()) await cta.first().click();
await page.waitForFunction(() => typeof window.advanceTime === "function", { timeout: 20000 });
const gotIt = page.getByRole("button", { name: /got it, let's go/i });
if (await gotIt.count()) await gotIt.first().click();
await page.waitForTimeout(8000); // let the lazy flora GLB swap land
await page.evaluate(() => window.advanceTime(3000));

const avg = async (label, settleMs = 2000) => {
  await page.evaluate(() => (window.__glStats.frames = []));
  await page.waitForTimeout(settleMs);
  const r = await page.evaluate(() => {
    const f = window.__glStats.frames;
    if (!f.length) return null;
    return {
      n: f.length,
      draws: Math.round(f.reduce((s, x) => s + x.draws, 0) / f.length),
      tris: Math.round(f.reduce((s, x) => s + x.tris, 0) / f.length),
    };
  });
  console.log(
    r
      ? `${label}: avg draws=${r.draws} avg tris=${r.tris} (${r.n} frames)`
      : `${label}: no frames rendered in the window (vantage hook halted the loop?)`,
  );
};

await avg("spawn (camp vista)");
await page.waitForFunction(() => typeof window.__frameView__ === "function", { timeout: 10000 });
await page.evaluate(() => window.__frameView__([70, 6, 20], [84, 5, 26]));
await avg("jungle interior (near ruin)", 1500);
await browser.close();
