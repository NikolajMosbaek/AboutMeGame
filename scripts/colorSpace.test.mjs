// @vitest-environment node
import { describe, expect, it } from "vitest";
import { srgbToLinear, texelIndex } from "./colorSpace.mjs";

describe("srgbToLinear", () => {
  it("pins a known byte -> linear value (mid-grey, byte 128) against the IEC 61966-2-1 curve", () => {
    // 128/255 sRGB-encoded mid-grey. If this drifts, the atlas bake's
    // sRGB->linear conversion silently regressed.
    expect(srgbToLinear(128 / 255)).toBeCloseTo(0.21586050011389923, 12);
  });

  it("maps the endpoints identically (0 -> 0, 1 -> 1)", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBe(1);
  });

  it("uses the linear segment below the 0.04045 knee", () => {
    expect(srgbToLinear(0.02)).toBeCloseTo(0.02 / 12.92, 12);
  });

  it("is always darker than or equal to its sRGB input (the curve is concave)", () => {
    for (const c of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(srgbToLinear(c)).toBeLessThanOrEqual(c);
    }
  });
});

describe("texelIndex", () => {
  it("maps u=0 to texel 0", () => {
    expect(texelIndex(0, 64)).toBe(0);
  });

  it("clamps u=1 to the last texel instead of one past the end", () => {
    expect(texelIndex(1, 64)).toBe(63);
  });

  it("floors mid-texel UVs to the texel they fall inside (nearest-sampler convention)", () => {
    // 10.9 / 64 falls inside texel 10, not 11 — a round()-based formula would
    // have picked 11 here.
    expect(texelIndex(10.9 / 64, 64)).toBe(10);
  });
});
