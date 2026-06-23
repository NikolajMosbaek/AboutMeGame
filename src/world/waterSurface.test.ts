import { describe, expect, it } from "vitest";
import {
  A1,
  A2,
  FOAM_DEPTH_END,
  FOAM_DEPTH_START,
  WATER_DEEP,
  WATER_SHALLOW,
  clamp01,
  shorelineFoam,
  smoothstep,
  waterColor,
  waveHeight,
} from "./waterSurface.ts";

describe("smoothstep (GLSL-equivalent)", () => {
  it("clamps both tails", () => {
    // Below edge0 → 0, above edge1 → 1, exactly at the edges too.
    expect(smoothstep(2, 5, -10)).toBe(0);
    expect(smoothstep(2, 5, 2)).toBe(0);
    expect(smoothstep(2, 5, 5)).toBe(1);
    expect(smoothstep(2, 5, 100)).toBe(1);
  });

  it("is monotonic non-decreasing across the band", () => {
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const x = 2 + (5 - 2) * (i / 20);
      const v = smoothstep(2, 5, x);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("hits the cubic midpoint at the band centre", () => {
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 6);
  });
});

describe("clamp01", () => {
  it("pins out-of-range values to [0,1]", () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.42)).toBe(0.42);
    expect(clamp01(1)).toBe(1);
    expect(clamp01(7)).toBe(1);
  });
});

describe("waveHeight (two-sine swell)", () => {
  it("stays within |h| <= A1 + A2 over a sampled (x,z,t) grid", () => {
    const bound = A1 + A2;
    // Fractional and negative coords, several times — the construction bound
    // must hold everywhere.
    for (let xi = -4; xi <= 4; xi++) {
      for (let zi = -4; zi <= 4; zi++) {
        for (let ti = 0; ti <= 6; ti++) {
          const x = xi * 3.7 - 0.25;
          const z = zi * 2.9 + 0.5;
          const t = ti * 0.83;
          const h = waveHeight(x, z, t);
          expect(Number.isFinite(h)).toBe(true);
          expect(Math.abs(h)).toBeLessThanOrEqual(bound + 1e-9);
        }
      }
    }
  });

  it("varies across two distinct t at a fixed position", () => {
    const a = waveHeight(2.5, -1.3, 0);
    const b = waveHeight(2.5, -1.3, 1.7);
    expect(a).not.toBe(b);
  });

  it("varies across two distinct positions at a fixed t", () => {
    const a = waveHeight(1.1, 0.4, 0.9);
    const b = waveHeight(-2.3, 3.6, 0.9);
    expect(a).not.toBe(b);
  });

  it("is deterministic for identical args (incl. fractional/negative)", () => {
    expect(waveHeight(-3.14, 2.72, 0.5)).toBe(waveHeight(-3.14, 2.72, 0.5));
  });
});

describe("water palette", () => {
  it("WATER_SHALLOW is the #2e6f9e Water token in sRGB 0..1", () => {
    expect(WATER_SHALLOW[0]).toBeCloseTo(0x2e / 255, 6);
    expect(WATER_SHALLOW[1]).toBeCloseTo(0x6f / 255, 6);
    expect(WATER_SHALLOW[2]).toBeCloseTo(0x9e / 255, 6);
  });

  it("WATER_DEEP is darker than WATER_SHALLOW per channel", () => {
    expect(WATER_DEEP[0]).toBeLessThan(WATER_SHALLOW[0]);
    expect(WATER_DEEP[1]).toBeLessThan(WATER_SHALLOW[1]);
    expect(WATER_DEEP[2]).toBeLessThan(WATER_SHALLOW[2]);
  });

  it("both blues are in-gamut sRGB tuples", () => {
    for (const c of [...WATER_SHALLOW, ...WATER_DEEP]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});

describe("waterColor (art-direction depth/fresnel ramp)", () => {
  it("fresnel=0 (head-on) channel-equals WATER_SHALLOW", () => {
    const out: [number, number, number] = [0, 0, 0];
    waterColor(0, out);
    expect(out[0]).toBeCloseTo(WATER_SHALLOW[0], 6);
    expect(out[1]).toBeCloseTo(WATER_SHALLOW[1], 6);
    expect(out[2]).toBeCloseTo(WATER_SHALLOW[2], 6);
  });

  it("fresnel=1 (grazing) channel-equals WATER_DEEP", () => {
    const out: [number, number, number] = [0, 0, 0];
    waterColor(1, out);
    expect(out[0]).toBeCloseTo(WATER_DEEP[0], 6);
    expect(out[1]).toBeCloseTo(WATER_DEEP[1], 6);
    expect(out[2]).toBeCloseTo(WATER_DEEP[2], 6);
  });

  it("fresnel=0.5 is a monotonic blend strictly between the endpoints per channel", () => {
    const out: [number, number, number] = [0, 0, 0];
    waterColor(0.5, out);
    for (let c = 0; c < 3; c++) {
      const lo = Math.min(WATER_SHALLOW[c], WATER_DEEP[c]);
      const hi = Math.max(WATER_SHALLOW[c], WATER_DEEP[c]);
      expect(out[c]).toBeGreaterThan(lo);
      expect(out[c]).toBeLessThan(hi);
      // Linear mix at 0.5 is the exact per-channel midpoint.
      expect(out[c]).toBeCloseTo((WATER_SHALLOW[c] + WATER_DEEP[c]) / 2, 6);
    }
  });

  it("writes into and returns the caller-owned out (allocates nothing)", () => {
    const out: [number, number, number] = [9, 9, 9];
    const ret = waterColor(0.3, out);
    expect(ret).toBe(out);
  });

  it("is deterministic for identical args", () => {
    const a: [number, number, number] = [0, 0, 0];
    const b: [number, number, number] = [0, 0, 0];
    waterColor(0.37, a);
    waterColor(0.37, b);
    expect(a[0]).toBe(b[0]);
    expect(a[1]).toBe(b[1]);
    expect(a[2]).toBe(b[2]);
  });

  it("clamps out-of-range and degenerate fresnel to a finite, in-gamut colour", () => {
    const out: [number, number, number] = [0, 0, 0];
    for (const f of [-3, 7, NaN, Infinity, -Infinity]) {
      waterColor(f, out);
      for (let c = 0; c < 3; c++) {
        expect(Number.isFinite(out[c])).toBe(true);
        expect(out[c]).toBeGreaterThanOrEqual(0);
        expect(out[c]).toBeLessThanOrEqual(1);
      }
    }
    // Above-range fresnel clamps to the deep endpoint.
    waterColor(7, out);
    expect(out[0]).toBeCloseTo(WATER_DEEP[0], 6);
    // Below-range fresnel clamps to the shallow endpoint.
    waterColor(-3, out);
    expect(out[0]).toBeCloseTo(WATER_SHALLOW[0], 6);
  });
});

describe("shorelineFoam (1 - smoothstep(START, END, depth))", () => {
  it("uses the sanctioned edge order START < END (no reversed-edge form)", () => {
    expect(FOAM_DEPTH_START).toBeLessThan(FOAM_DEPTH_END);
  });

  it("is ~0 in deep/open water (depth >= FOAM_DEPTH_END)", () => {
    expect(shorelineFoam(FOAM_DEPTH_END)).toBe(0);
    expect(shorelineFoam(FOAM_DEPTH_END + 0.5)).toBe(0);
    expect(shorelineFoam(50)).toBe(0);
  });

  it("ramps to the foam value (1) at the shore (depth = FOAM_DEPTH_START)", () => {
    expect(shorelineFoam(FOAM_DEPTH_START)).toBe(1);
  });

  it("is monotonic non-decreasing as depth decreases toward shore", () => {
    // Walk from open water in toward the shore; foam must never drop.
    let prev = -Infinity;
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      // depth goes high → low across the band as i grows
      const depth = FOAM_DEPTH_END - (FOAM_DEPTH_END - FOAM_DEPTH_START) * (i / steps);
      const v = shorelineFoam(depth);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it("hits a partial foam value strictly between 0 and 1 inside the band", () => {
    const mid = (FOAM_DEPTH_START + FOAM_DEPTH_END) / 2;
    const v = shorelineFoam(mid);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
  });

  it("equals the clamped tails exactly beyond both edges", () => {
    // Past FOAM_DEPTH_END → exactly 0; at/under FOAM_DEPTH_START → exactly the
    // full foam value (1).
    expect(shorelineFoam(FOAM_DEPTH_END + 100)).toBe(0);
    expect(shorelineFoam(FOAM_DEPTH_START - 100)).toBe(1);
  });

  it("keeps degenerate/negative depth finite and in-gamut [0,1]", () => {
    for (const d of [-5, NaN, Infinity, -Infinity]) {
      const v = shorelineFoam(d);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic for identical args (incl. fractional)", () => {
    expect(shorelineFoam(0.73)).toBe(shorelineFoam(0.73));
  });
});
