import { describe, expect, it } from "vitest";
import { dayPalette, MIN_SUN_INTENSITY } from "./dayCycle.ts";
import {
  MAX_ENV_INTENSITY,
  MIN_ENV_INTENSITY,
  environmentIntensityForSunIntensity,
} from "./envIntensity.ts";

describe("environmentIntensityForSunIntensity", () => {
  it("returns MAX_ENV_INTENSITY at the NOON sun intensity (1.6)", () => {
    expect(environmentIntensityForSunIntensity(1.6)).toBeCloseTo(MAX_ENV_INTENSITY, 10);
  });

  it("returns MIN_ENV_INTENSITY at the dimmest sun intensity (MIN_SUN_INTENSITY, 0.9)", () => {
    expect(environmentIntensityForSunIntensity(MIN_SUN_INTENSITY)).toBeCloseTo(
      MIN_ENV_INTENSITY,
      10,
    );
  });

  it("is monotone increasing with sun intensity", () => {
    const a = environmentIntensityForSunIntensity(1.0);
    const b = environmentIntensityForSunIntensity(1.2);
    const c = environmentIntensityForSunIntensity(1.5);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  it("clamps below the floor instead of going darker (total function)", () => {
    expect(environmentIntensityForSunIntensity(0)).toBe(MIN_ENV_INTENSITY);
    expect(environmentIntensityForSunIntensity(-5)).toBe(MIN_ENV_INTENSITY);
  });

  it("clamps above the ceiling instead of going overbright (total function)", () => {
    expect(environmentIntensityForSunIntensity(3)).toBe(MAX_ENV_INTENSITY);
  });

  it("never returns NaN or Infinity for degenerate input", () => {
    expect(Number.isFinite(environmentIntensityForSunIntensity(NaN))).toBe(true);
    expect(Number.isFinite(environmentIntensityForSunIntensity(Infinity))).toBe(true);
    expect(Number.isFinite(environmentIntensityForSunIntensity(-Infinity))).toBe(true);
  });

  it("stays within [MIN_ENV_INTENSITY, MAX_ENV_INTENSITY] across the whole real day-cycle sweep", () => {
    // Swept against the ACTUAL dayPalette (allowed here — this is a test file,
    // exempt from dayCycle.ts's locked single-production-importer guard).
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      const intensity = environmentIntensityForSunIntensity(dayPalette(t).sunIntensity);
      expect(intensity).toBeGreaterThanOrEqual(MIN_ENV_INTENSITY);
      expect(intensity).toBeLessThanOrEqual(MAX_ENV_INTENSITY);
    }
  });
});
