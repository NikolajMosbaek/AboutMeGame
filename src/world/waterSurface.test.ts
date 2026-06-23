import { describe, expect, it } from "vitest";
import {
  A1,
  A2,
  WATER_DEEP,
  WATER_SHALLOW,
  clamp01,
  smoothstep,
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
