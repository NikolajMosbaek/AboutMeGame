import { describe, expect, it } from "vitest";
import {
  FOG_DENSITY_BASE,
  FOG_DENSITY_LOW_SUN_BOOST,
  HAZE_STRENGTH,
  fogDensityForElevation,
  hazeFactor,
  lowSunFactor,
  sunDiscFactor,
  sunHaloFactor,
} from "./skyAtmosphere.ts";

describe("hazeFactor (horizon haze band)", () => {
  it("peaks at HAZE_STRENGTH exactly at the horizon (h = 0)", () => {
    expect(hazeFactor(0)).toBeCloseTo(HAZE_STRENGTH, 10);
  });

  it("falls off toward 0 away from the horizon, symmetric above/below", () => {
    expect(hazeFactor(1)).toBeLessThan(hazeFactor(0.2));
    expect(hazeFactor(0.5)).toBeCloseTo(hazeFactor(-0.5), 10);
  });
});

describe("sunDiscFactor (sharp disc rim)", () => {
  it("is 0 well outside the disc and 1 once fully inside", () => {
    expect(sunDiscFactor(0.9)).toBe(0);
    expect(sunDiscFactor(1)).toBe(1);
  });

  it("is a smooth partial value inside the thin rim", () => {
    const mid = sunDiscFactor(0.99955); // midway between INNER/OUTER
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});

describe("sunHaloFactor (broad Mie-style glow)", () => {
  it("is 1 looking straight at the sun, 0 looking away", () => {
    expect(sunHaloFactor(1)).toBeCloseTo(1, 10);
    expect(sunHaloFactor(0)).toBe(0);
    expect(sunHaloFactor(-1)).toBe(0); // clamped, never negative/NaN
  });

  it("is broader (higher at a given angle) than the sharp disc factor", () => {
    // At an angle well outside the disc rim, the halo still glows softly.
    expect(sunHaloFactor(0.95)).toBeGreaterThan(0);
    expect(sunDiscFactor(0.95)).toBe(0);
  });
});

describe("lowSunFactor (dawn/dusk warmth driver)", () => {
  it("is 0 once the sun is at/above half its own zenith height", () => {
    expect(lowSunFactor(0.5)).toBe(0);
    expect(lowSunFactor(1)).toBe(0);
  });

  it("is 1 at/below the horizon", () => {
    expect(lowSunFactor(0)).toBe(1);
    expect(lowSunFactor(-0.2)).toBe(1);
  });

  it("is monotonically decreasing as the sun climbs", () => {
    expect(lowSunFactor(0.1)).toBeGreaterThan(lowSunFactor(0.3));
  });
});

describe("fogDensityForElevation (per-phase haze agreement, item 5)", () => {
  const NOON_ELEVATION = Math.atan2(1, Math.hypot(0.6, 0.4));

  it("reproduces the shipped 0.0022 bit-exact at/above a comfortably high noon sun", () => {
    expect(fogDensityForElevation(NOON_ELEVATION)).toBeCloseTo(FOG_DENSITY_BASE, 10);
  });

  it("is denser at low dawn/dusk elevations than at noon, within the bounded boost", () => {
    const dawn = fogDensityForElevation(0.12);
    const noon = fogDensityForElevation(NOON_ELEVATION);
    expect(dawn).toBeGreaterThan(noon);
    expect(dawn).toBeLessThanOrEqual(FOG_DENSITY_BASE + FOG_DENSITY_LOW_SUN_BOOST + 1e-9);
  });

  it("never drops below the base density (a sunk-below-noon elevation is still bounded)", () => {
    expect(fogDensityForElevation(Math.PI / 2)).toBeCloseTo(FOG_DENSITY_BASE, 10);
  });
});
