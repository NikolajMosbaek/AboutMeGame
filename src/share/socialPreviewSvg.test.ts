import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * F1 slice 1 (#129) — T2: the committed, regenerable source of the social card.
 *
 * public/social-preview.svg is the single authored source that gets rasterized
 * (offline, via the already-present playwright devDependency) to the emitted
 * public/social-preview.png. This is a PURE-STRING proof over the committed SVG
 * text — no DOM, no build, no rasterization — mirroring tokens.css.test.ts and
 * safe to run in every `npm test` lane.
 *
 * It pins: the 1200x630 unfurl-card frame (viewBox + width + height), the exact
 * brand-token palette reused from favicon.svg (so the card stays on-brand and
 * regenerable), and that the card carries NO photographic content — no <image>,
 * no href-to-raster, no embedded base64 bitmap — because the card must stay a
 * flat, few-colour, low-poly vector so the rasterized PNG holds at tens of KB.
 */

const svg = readFileSync(resolve(process.cwd(), "public/social-preview.svg"), "utf8");

// The exact brand tokens, single-sourced from the favicon vocabulary:
// bg, amber accent, the two island greens, and the warm lamp core.
const BRAND_TOKENS = {
  bg: "#14121f",
  amber: "#ffcb47",
  greenLight: "#5b8f4a",
  greenDark: "#49753c",
  lamp: "#fff3d4",
} as const;

describe("public/social-preview.svg — 1200x630 brand card frame", () => {
  it("declares a 1200x630 viewBox", () => {
    expect(svg).toMatch(/viewBox\s*=\s*"0 0 1200 630"/);
  });

  it("declares width=1200 and height=630 so the rasterizer emits the exact unfurl size", () => {
    expect(svg).toMatch(/\bwidth\s*=\s*"1200"/);
    expect(svg).toMatch(/\bheight\s*=\s*"630"/);
  });
});

describe("public/social-preview.svg — brand-token palette (reused favicon vocabulary)", () => {
  it("uses the deep-indigo brand background #14121f", () => {
    expect(svg).toContain(BRAND_TOKENS.bg);
  });

  it("uses the amber beacon accent #ffcb47", () => {
    expect(svg).toContain(BRAND_TOKENS.amber);
  });

  it("uses both island greens #5b8f4a and #49753c", () => {
    expect(svg).toContain(BRAND_TOKENS.greenLight);
    expect(svg).toContain(BRAND_TOKENS.greenDark);
  });

  it("uses the warm lamp core #fff3d4", () => {
    expect(svg).toContain(BRAND_TOKENS.lamp);
  });
});

describe("public/social-preview.svg — flat vector only, no photographic content", () => {
  it("has no <image> element (no raster embedded as an SVG image node)", () => {
    expect(svg).not.toMatch(/<image\b/i);
  });

  it("has no href/xlink:href pointing at a raster asset", () => {
    // Any href that references a bitmap (png/jpg/jpeg/gif/webp) — or a data URI —
    // would mean the "vector" card is really a smuggled photo.
    expect(svg).not.toMatch(/(?:xlink:)?href\s*=\s*"[^"]*\.(?:png|jpe?g|gif|webp|bmp|avif)"/i);
  });

  it("embeds no base64 bitmap data URI", () => {
    expect(svg).not.toMatch(/data:image\/[a-z+]+;base64/i);
  });
});
