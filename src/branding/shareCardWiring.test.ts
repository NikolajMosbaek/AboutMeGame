import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * T4 regression lock for the end-to-end share-card wiring (#54 follow-up).
 *
 * The sibling suites guard each piece in isolation: shareCardPng.test.ts proves
 * the real PNG pixels are 1200x630, and shareMeta.test.ts proves index.html
 * declares og:image:width/height/type. Neither asserts the two AGREE with each
 * other — the drift this task exists to catch: a regen that resizes the PNG (or
 * a hand-edited width/height) would leave the markup lying to every scraper
 * while both isolated suites stay green.
 *
 * This suite closes that seam. It reads the real IHDR header bytes AND the
 * declared meta, then asserts the declared og:image:width/height equal the
 * pixels and og:image:type is the format the bytes actually are (PNG). It also
 * consolidates the meta string invariants so the social wiring is locked in one
 * place: og:image + twitter:image point at the asset, twitter:card is the large
 * card, and the stale "No og:image is referenced" comment is gone.
 */

const pngPath = resolve(process.cwd(), "public/share-card.png");
const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

/** Parse width/height + color-type from a PNG's IHDR chunk, proving the bytes are PNG. */
function readPng(buf: Buffer): { width: number; height: number } {
  // PNG signature (8 bytes) then the IHDR chunk: 4-byte length, 4-byte type,
  // then data starting with 4-byte width and 4-byte height (big-endian).
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(buf.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const metaProp = (prop: string): string | undefined =>
  html.match(
    new RegExp(`<meta\\s+property="${prop}"\\s+content="([^"]*)"`),
  )?.[1];

const metaName = (name: string): string | undefined =>
  html.match(new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`))?.[1];

describe("share-card wiring (IHDR ⇄ meta agreement)", () => {
  const pixels = readPng(readFileSync(pngPath));

  it("declares og:image:width equal to the PNG's real IHDR width", () => {
    expect(pixels.width).toBe(1200);
    expect(metaProp("og:image:width")).toBe(String(pixels.width));
  });

  it("declares og:image:height equal to the PNG's real IHDR height", () => {
    expect(pixels.height).toBe(630);
    expect(metaProp("og:image:height")).toBe(String(pixels.height));
  });

  it("declares og:image:type as the format the committed bytes actually are (PNG)", () => {
    // readPng() already asserted the 8-byte PNG signature on the real file;
    // the markup must agree with that ground truth.
    expect(metaProp("og:image:type")).toBe("image/png");
  });
});

describe("share-card wiring (meta string invariants)", () => {
  it("points og:image and twitter:image at the committed share-card.png", () => {
    expect(metaProp("og:image")).toBe("%BASE_URL%share-card.png");
    expect(metaName("twitter:image")).toBe("%BASE_URL%share-card.png");
  });

  it("upgrades twitter:card to summary_large_image", () => {
    expect(metaName("twitter:card")).toBe("summary_large_image");
  });

  it("drops the stale 'No og:image is referenced' comment", () => {
    expect(html).not.toMatch(/No og:image is referenced/);
  });
});
