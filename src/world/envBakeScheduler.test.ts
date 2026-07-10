import { describe, expect, it } from "vitest";
import { dayPalette } from "./dayCycle.ts";
import { PERIOD_SECONDS } from "./dayCycleSystem.ts";
import {
  DEFAULT_ENV_BAKE_CONFIG,
  paletteDelta,
  shouldRebake,
  type EnvColorSample,
} from "./envBakeScheduler.ts";

// This test file is exempt from `dayCycle.ts`'s locked single-production-
// importer guard (dayCycle.test.ts only walks non-test source files), so it
// can freely import the real `dayPalette` to sweep realistic samples — the
// module under test (`envBakeScheduler.ts`) itself stays import-free.

const RED: EnvColorSample = { sunColor: [1, 0, 0], domeTop: [1, 0, 0], domeBottom: [1, 0, 0] };
const SAME_AS_RED: EnvColorSample = { sunColor: [1, 0, 0], domeTop: [1, 0, 0], domeBottom: [1, 0, 0] };

describe("paletteDelta", () => {
  it("is 0 for identical samples (even distinct object instances)", () => {
    expect(paletteDelta(RED, SAME_AS_RED)).toBe(0);
  });

  it("sums absolute per-channel drift across sunColor + domeTop + domeBottom", () => {
    const a: EnvColorSample = { sunColor: [0, 0, 0], domeTop: [0, 0, 0], domeBottom: [0, 0, 0] };
    const b: EnvColorSample = { sunColor: [0.1, 0, 0], domeTop: [0, 0.2, 0], domeBottom: [0, 0, 0.3] };
    // 0.1 (sunColor.r) + 0.2 (domeTop.g) + 0.3 (domeBottom.b) = 0.6
    expect(paletteDelta(a, b)).toBeCloseTo(0.6, 10);
  });

  it("is symmetric", () => {
    const a: EnvColorSample = { sunColor: [0.2, 0.1, 0], domeTop: [0, 0, 0], domeBottom: [0, 0, 0] };
    const b: EnvColorSample = { sunColor: [0, 0, 0], domeTop: [0, 0, 0], domeBottom: [0, 0, 0] };
    expect(paletteDelta(a, b)).toBeCloseTo(paletteDelta(b, a), 10);
  });
});

describe("shouldRebake", () => {
  const config = { minIntervalSeconds: 2, deltaThreshold: 0.05 };

  it("never rebakes before the minimum interval, however large the delta", () => {
    expect(shouldRebake(0, 999, config)).toBe(false);
    expect(shouldRebake(1.999, 999, config)).toBe(false);
  });

  it("past the interval, requires the delta to clear the threshold", () => {
    expect(shouldRebake(2, 0.049, config)).toBe(false);
    expect(shouldRebake(2, 0.05, config)).toBe(true); // boundary: >= threshold
    expect(shouldRebake(10, 0.05, config)).toBe(true);
  });

  it("never rebakes when the delta is 0, no matter how long it's been held", () => {
    expect(shouldRebake(1e6, 0, config)).toBe(false);
  });

  it("boundary: exactly at minIntervalSeconds counts as past the cap", () => {
    expect(shouldRebake(config.minIntervalSeconds, config.deltaThreshold, config)).toBe(true);
  });
});

describe("DEFAULT_ENV_BAKE_CONFIG against the real day-cycle pace", () => {
  // Sweeps the ACTUAL dayPalette across one full 180s loop at a steady 60 Hz
  // tick, feeding consecutive-frame deltas through the real scheduler — proves
  // the tuned defaults land close to "roughly every 2 seconds" during active
  // transitions (the design's stated cadence), not some far-off cadence that
  // would either thrash the GPU or barely ever refresh.
  it("rebakes at a cadence close to the minInterval cap across a full loop", () => {
    const dt = 1 / 60;
    let lastBaked = dayPalette(0);
    let sinceLast = 0;
    let regens = 0;
    const steps = Math.round(PERIOD_SECONDS / dt);

    for (let step = 0; step < steps; step++) {
      const t = (step * dt) / PERIOD_SECONDS;
      sinceLast += dt;
      const current = dayPalette(t);
      const delta = paletteDelta(current, lastBaked);
      if (shouldRebake(sinceLast, delta, DEFAULT_ENV_BAKE_CONFIG)) {
        regens++;
        lastBaked = current;
        sinceLast = 0;
      }
    }

    // Measured: ~88 regens over the 180s loop (~1 every 2.0-2.1s). Assert a
    // generous band around that so small keyframe-table edits don't spuriously
    // break this, while still catching a scheduler that regressed to
    // "every frame" or "almost never".
    const avgIntervalSeconds = PERIOD_SECONDS / regens;
    expect(avgIntervalSeconds).toBeGreaterThanOrEqual(DEFAULT_ENV_BAKE_CONFIG.minIntervalSeconds);
    expect(avgIntervalSeconds).toBeLessThan(3);
    expect(regens).toBeGreaterThan(50);
  });

  it("under a held (unchanging) palette — the reduced-motion golden-hour pin — rebakes exactly once", () => {
    // Mirrors what DayCycleSystem actually does under reduced motion: every
    // frame samples the SAME GOLDEN_T palette. The delta gate must fall out
    // naturally to "never again" with no special-case code in the caller.
    const held = dayPalette(0.5);
    let lastBaked = held; // the one bake that happened at construction
    let sinceLast = 0;
    let regens = 0;
    const dt = 1 / 60;

    for (let step = 0; step < 600; step++) {
      // 10 simulated seconds
      sinceLast += dt;
      const delta = paletteDelta(held, lastBaked);
      if (shouldRebake(sinceLast, delta, DEFAULT_ENV_BAKE_CONFIG)) {
        regens++;
        lastBaked = held;
        sinceLast = 0;
      }
    }

    expect(regens).toBe(0);
  });
});
