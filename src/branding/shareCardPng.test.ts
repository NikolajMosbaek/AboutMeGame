import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * T2 regression lock for the rasterized social share card (#54 follow-up).
 *
 * The committed PNG at public/share-card.png is the asset Slack/iMessage/
 * LinkedIn/X/Discord actually unfurl (those scrapers silently drop SVG
 * og:images). This suite reads the real IHDR header bytes so the dimensions are
 * proven from the pixels, not asserted from metadata, and stay locked to the
 * 1200x630 Open Graph summary_large_image canvas.
 *
 * Regen (offline, no committed render dependency):
 *   npx @resvg/resvg-js-cli public/share-card.svg public/share-card.png
 */
const pngPath = resolve(process.cwd(), "public/share-card.png");

/** Parse the width/height from a PNG's IHDR chunk (first chunk after the 8-byte signature). */
function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // PNG signature: 8 bytes. Then a chunk: 4-byte length, 4-byte type ("IHDR"),
  // then IHDR data: 4-byte width, 4-byte height (big-endian).
  const signature = buf.subarray(0, 8).toString("hex");
  expect(signature).toBe("89504e470d0a1a0a");
  expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

describe("share-card.png", () => {
  it("exists as a committed raster asset", () => {
    expect(existsSync(pngPath)).toBe(true);
  });

  it("reports exactly 1200x630 in its real IHDR pixel dimensions", () => {
    const { width, height } = readPngDimensions(readFileSync(pngPath));
    expect(width).toBe(1200);
    expect(height).toBe(630);
  });
});
