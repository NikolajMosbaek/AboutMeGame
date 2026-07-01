import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { SOCIAL_PREVIEW_FILENAME } from "./socialMeta";

/*
 * F1 slice 1 (#129) — T3: the committed, rasterized social-preview PNG.
 *
 * public/social-preview.svg (T2) is the authored source; this test proves the
 * committed public/<SOCIAL_PREVIEW_FILENAME> binary that gets emitted as the
 * og:image actually exists AND is a real 1200x630 PNG — not a placeholder, an
 * empty file, or a mis-sized re-export. The filename is single-sourced from
 * socialMeta (T1) so a rename cannot silently stale this check against the emit
 * check.
 *
 * The PNG is rasterized OFFLINE from the SVG via the already-present playwright
 * devDependency (see scripts/render-social-preview.mjs) — no runtime dependency,
 * no new dep. We read the width/height straight from the PNG's IHDR chunk rather
 * than trusting any image library, so this verifies the committed bytes.
 */

const pngPath = resolve(process.cwd(), "public", SOCIAL_PREVIEW_FILENAME);

// A PNG begins with the 8-byte signature, then the IHDR chunk. IHDR's data
// starts at byte 16: width is a big-endian u32 at offset 16, height at 20.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPngIhdr(bytes: Buffer): { signatureOk: boolean; width: number; height: number } {
  const signatureOk = bytes.subarray(0, 8).equals(PNG_SIGNATURE);
  // Bytes 12-15 are the "IHDR" chunk type; width/height follow.
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return { signatureOk, width, height };
}

describe("public/social-preview.png — committed rasterized card", () => {
  it("exists as a sibling of favicon.svg under public/", () => {
    expect(existsSync(pngPath)).toBe(true);
  });

  it("is a real PNG (valid 8-byte signature)", () => {
    const bytes = readFileSync(pngPath);
    const { signatureOk } = readPngIhdr(bytes);
    expect(signatureOk).toBe(true);
  });

  it("is exactly the 1200x630 unfurl size (parsed from the PNG IHDR header)", () => {
    const bytes = readFileSync(pngPath);
    const { width, height } = readPngIhdr(bytes);
    expect(width).toBe(1200);
    expect(height).toBe(630);
  });

  it("stays a few tens of KB, so a bloated re-export fails independently of the 6 MB total cap", () => {
    // The flat, few-colour, low-poly card must rasterize to a small file. The
    // docs/perf-budget.md 6 MB total-payload gate will never trip on tens of KB
    // and so cannot protect this per-image target — this explicit upper bound
    // does. 96 KB gives comfortable headroom over the ~33 KB current export
    // while still failing any accidentally photographic / re-scaled re-export.
    const MAX_BYTES = 96 * 1024;
    const { size } = statSync(pngPath);
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThanOrEqual(MAX_BYTES);
  });
});
