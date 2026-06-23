import { describe, expect, it } from "vitest";
import { KEYFRAMES, dayPalette } from "./dayCycle.ts";

// T1's first test: dayPalette() returns each keyframe's EXACT tuple/scalars at
// its keyframe `t` — the f==0 early-return that backs the bit-exact noon and the
// keyframe-exactness guarantees. The full T2 suite (continuity, seamless wrap,
// no-night floor, noon==sky.ts, degenerate inputs, static guards) lands next.
describe("dayPalette — keyframe exactness (f==0 early-return)", () => {
  it("returns each keyframe's exact palette at its keyframe t", () => {
    // The closing row (t=1) is the seam-repeat of dawn (t=0): dayPalette(1)
    // wraps to t=0, so it yields dawn's azimuth (DAWN_AZIMUTH), not the closing
    // row's DAWN_AZIMUTH+2π. Assert exactness only for the authored interior
    // keyframes; the seam is the T2 wrap test's job.
    for (const k of KEYFRAMES.filter((kf) => kf.t < 1)) {
      const p = dayPalette(k.t);
      expect(p.sunColor).toEqual(k.sunColor);
      expect(p.sunIntensity).toBe(k.sunIntensity);
      expect(p.sunElevation).toBe(k.sunElevation);
      expect(p.sunAzimuth).toBe(k.sunAzimuth);
      expect(p.domeTop).toEqual(k.domeTop);
      expect(p.domeBottom).toEqual(k.domeBottom);
      expect(p.fogColor).toEqual(k.fogColor);
    }
  });
});
