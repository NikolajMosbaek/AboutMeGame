import { statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { SOCIAL_PREVIEW_FILENAME, SOCIAL_PREVIEW_MAX_BYTES } from "./socialMeta";

/*
 * F1 slice 1 (#129) — T4: the explicit per-image byte-bound guard.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE 6 MB TOTAL-PAYLOAD CAP.
 * The docs/perf-budget.md total-download gate (maxInitialDownloadKb = 6 MB,
 * enforced by `npm run check:bundle`) sums the WHOLE built payload. A social
 * card that bloated from ~193 KB (the visual-overhaul slice 7 in-game
 * screenshot, palette-quantized) to, say, 3 MB (an accidental full-colour
 * re-export, a lost `--palette`, a PNG saved uncompressed) would still leave
 * the total comfortably under 6 MB — the current dist baseline is ~3.8 MB, so
 * the total cap has multi-MB of headroom and can NEVER trip on a per-image
 * regression at this scale. The total cap therefore cannot protect the
 * per-image target; only an explicit upper bound on this one file can. This
 * guard is that bound: a bloated re-export of public/social-preview.png fails
 * HERE, loudly and independently, long before it would ever move the
 * total-payload needle.
 *
 * The ceiling is single-sourced in socialMeta (SOCIAL_PREVIEW_MAX_BYTES) so this
 * guard and the T3 identity test (socialPreviewPng.test.ts) cannot drift apart.
 */

const pngPath = resolve(process.cwd(), "public", SOCIAL_PREVIEW_FILENAME);

describe("public/social-preview.png — per-image byte bound", () => {
  it("is non-empty (a zero-byte file would pass a total-payload cap but is not a real card)", () => {
    const { size } = statSync(pngPath);
    expect(size).toBeGreaterThan(0);
  });

  it("stays at or under the documented ceiling, independent of the 6 MB total cap", () => {
    const { size } = statSync(pngPath);
    expect(size).toBeLessThanOrEqual(SOCIAL_PREVIEW_MAX_BYTES);
  });
});
