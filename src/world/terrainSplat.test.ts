import { describe, expect, it } from "vitest";
import {
  computeSplatWeights,
  slopeFromNormalY,
  packSplatWeights,
  SPLAT_CHANNELS,
} from "./terrainSplat.ts";

// The pure CPU-side splat-weight signal (visual-overhaul slice 3). One vertex's
// {height, slope, noise} in, a 4-channel weight-set out — the same signals
// `colorForHeight` already reads (elevation bands + noise mottling), plus slope
// (from the smooth vertex normal) which the flat-shaded vertex-colour terrain
// never needed. Packed into a vec4 attribute for the fragment shader to blend
// 4 albedo textures by; the sum-to-1 and per-regime-dominance properties are
// exactly what the shader assumes (weights read as blend fractions).

describe("computeSplatWeights", () => {
  it("always sums to (approximately) 1, across a spread of height/slope/noise", () => {
    for (const height of [-3, 0, 0.3, 2, 6, 12, 16, 20, 28]) {
      for (const slope of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
        for (const noise of [0, 0.25, 0.5, 0.75, 1]) {
          const w = computeSplatWeights(height, slope, noise);
          const sum = w.jungleFloor + w.leafLitter + w.rock + w.sand;
          expect(sum).toBeCloseTo(1, 5);
          // Every channel weight is a valid blend fraction.
          for (const v of [w.jungleFloor, w.leafLitter, w.rock, w.sand]) {
            expect(v).toBeGreaterThanOrEqual(-1e-9);
            expect(v).toBeLessThanOrEqual(1 + 1e-9);
          }
        }
      }
    }
  });

  it("rock dominates a steep slope regardless of height band", () => {
    for (const height of [0.3, 6, 16, 25]) {
      const w = computeSplatWeights(height, 0.95, 0.5);
      expect(w.rock).toBeGreaterThan(0.9);
    }
  });

  it("sand dominates at shore/riverbed elevations on flat ground", () => {
    const w = computeSplatWeights(0.2, 0, 0.5);
    expect(w.sand).toBeGreaterThan(w.jungleFloor);
    expect(w.sand).toBeGreaterThan(w.leafLitter);
    expect(w.sand).toBeGreaterThan(w.rock);
  });

  it("jungle floor dominates mid-elevation flat ground", () => {
    const w = computeSplatWeights(6, 0, 0.5);
    expect(w.jungleFloor).toBeGreaterThan(w.sand);
    expect(w.jungleFloor).toBeGreaterThan(w.leafLitter);
    expect(w.jungleFloor).toBeGreaterThan(w.rock);
  });

  it("leaf litter dominates the upper jungle band on flat ground", () => {
    const w = computeSplatWeights(16, 0, 0.5);
    expect(w.leafLitter).toBeGreaterThan(w.sand);
    expect(w.leafLitter).toBeGreaterThan(w.jungleFloor);
    expect(w.leafLitter).toBeGreaterThan(w.rock);
  });

  it("rock dominates the highland band on flat ground (above the treeline)", () => {
    const w = computeSplatWeights(26, 0, 0.5);
    expect(w.rock).toBeGreaterThan(0.9);
  });

  it("noise mottles jungleFloor/leafLitter without changing their combined weight or any other channel", () => {
    const lo = computeSplatWeights(6, 0, 0);
    const hi = computeSplatWeights(6, 0, 1);
    expect(lo.jungleFloor + lo.leafLitter).toBeCloseTo(hi.jungleFloor + hi.leafLitter, 5);
    expect(lo.sand).toBeCloseTo(hi.sand, 5);
    expect(lo.rock).toBeCloseTo(hi.rock, 5);
    // And it actually moves something between the two (not a no-op).
    expect(lo.jungleFloor).not.toBeCloseTo(hi.jungleFloor, 3);
  });

  it("is deterministic (pure function of its inputs)", () => {
    const a = computeSplatWeights(9.5, 0.4, 0.6);
    const b = computeSplatWeights(9.5, 0.4, 0.6);
    expect(a).toEqual(b);
  });
});

describe("slopeFromNormalY", () => {
  it("is 0 for a perfectly flat (up-facing) normal", () => {
    expect(slopeFromNormalY(1)).toBe(0);
  });

  it("is 1 for a vertical (horizon-facing) normal", () => {
    expect(slopeFromNormalY(0)).toBe(1);
  });

  it("clamps out-of-range inputs into [0,1]", () => {
    expect(slopeFromNormalY(-0.2)).toBeLessThanOrEqual(1);
    expect(slopeFromNormalY(1.2)).toBeGreaterThanOrEqual(0);
  });
});

describe("packSplatWeights", () => {
  it("packs in SPLAT_CHANNELS order (jungleFloor, leafLitter, rock, sand)", () => {
    expect(SPLAT_CHANNELS).toEqual(["jungleFloor", "leafLitter", "rock", "sand"]);
    const w = { jungleFloor: 0.1, leafLitter: 0.2, rock: 0.3, sand: 0.4 };
    expect(packSplatWeights(w)).toEqual([0.1, 0.2, 0.3, 0.4]);
  });
});
