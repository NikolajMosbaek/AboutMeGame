import { describe, expect, it } from "vitest";
import { WATER_DEEP, WATER_SHALLOW } from "./waterSurface.ts";
import { FOAM_COLOR, srgbTupleToLinear } from "./waterUniforms.ts";

// T1 — colour-space transport. The renderer outputs SRGBColorSpace with
// ACESFilmicToneMapping, so MeshStandard fragment math runs in LINEAR before
// the output encoding. The sRGB-authored palette tuples in waterSurface.ts must
// therefore be gamma-decoded to linear before they are fed as shader uniforms.
// `srgbTupleToLinear` is that single transport step (a THREE.Color sRGB->linear
// decode), so boundaries.ts re-uses — never re-declares — the palette.

describe("srgbTupleToLinear (sRGB -> linear transport)", () => {
  it("gamma-decodes WATER_SHALLOW strictly below its raw sRGB channels", () => {
    const lin = srgbTupleToLinear(WATER_SHALLOW);
    // Decoding sRGB (which is brighter than linear above black) lowers every
    // mid-tone channel; the blues are all > 0, so each must drop.
    for (let c = 0; c < 3; c++) {
      expect(lin[c]).toBeLessThan(WATER_SHALLOW[c]);
    }
  });

  it("gamma-decodes WATER_DEEP strictly below its raw sRGB channels", () => {
    const lin = srgbTupleToLinear(WATER_DEEP);
    for (let c = 0; c < 3; c++) {
      expect(lin[c]).toBeLessThan(WATER_DEEP[c]);
    }
  });

  it("keeps every decoded channel finite and in-gamut [0,1]", () => {
    for (const tuple of [WATER_SHALLOW, WATER_DEEP, FOAM_COLOR]) {
      const lin = srgbTupleToLinear(tuple);
      for (let c = 0; c < 3; c++) {
        expect(Number.isFinite(lin[c])).toBe(true);
        expect(lin[c]).toBeGreaterThanOrEqual(0);
        expect(lin[c]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("round-trips the known reference 0.5 sRGB -> ~0.214 linear", () => {
    const lin = srgbTupleToLinear([0.5, 0.5, 0.5]);
    for (let c = 0; c < 3; c++) {
      expect(lin[c]).toBeCloseTo(0.214, 3);
    }
  });

  it("maps the gamut endpoints to themselves (0->0, 1->1)", () => {
    const black = srgbTupleToLinear([0, 0, 0]);
    const white = srgbTupleToLinear([1, 1, 1]);
    for (let c = 0; c < 3; c++) {
      expect(black[c]).toBeCloseTo(0, 6);
      expect(white[c]).toBeCloseTo(1, 6);
    }
  });

  it("is deterministic and allocation-disjoint per call", () => {
    const a = srgbTupleToLinear(WATER_SHALLOW);
    const b = srgbTupleToLinear(WATER_SHALLOW);
    expect(a).not.toBe(b); // fresh tuple each call — no shared scratch leak
    for (let c = 0; c < 3; c++) {
      expect(a[c]).toBe(b[c]);
    }
  });
});

describe("FOAM_COLOR (soft tone-mapped off-white)", () => {
  it("is an off-white sRGB tuple, in-gamut and not clipped pure white", () => {
    for (let c = 0; c < 3; c++) {
      expect(FOAM_COLOR[c]).toBeGreaterThan(0);
      expect(FOAM_COLOR[c]).toBeLessThanOrEqual(1);
    }
    // Off-white, not a pure-white rim (AC3): at least one channel below 1.
    expect(Math.min(...FOAM_COLOR)).toBeLessThan(1);
  });
});
