import { describe, expect, it } from "vitest";
import { WIND_SPEED, WIND_WRAP_PERIOD, windOffset, windPhase } from "./windSway.ts";

describe("windPhase", () => {
  it("returns a value in [0, 2π)", () => {
    for (let x = -500; x <= 500; x += 37) {
      for (let z = -500; z <= 500; z += 53) {
        const p = windPhase(x, z);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(Math.PI * 2);
        expect(Number.isFinite(p)).toBe(true);
      }
    }
  });

  it("is deterministic for the same position", () => {
    expect(windPhase(12.5, -7.25)).toBe(windPhase(12.5, -7.25));
  });

  it("spreads across many positions rather than collapsing to one value", () => {
    const values = new Set<number>();
    for (let i = 0; i < 200; i++) {
      values.add(Math.round(windPhase(i * 3.1, i * -1.7) * 1000));
    }
    // A real spread, not every position landing on the same bucket.
    expect(values.size).toBeGreaterThan(100);
  });
});

describe("windOffset", () => {
  it("is exactly zero at the base (height01 = 0), regardless of time/phase", () => {
    for (const t of [0, 1.3, 50]) {
      // `height01 * height01 === 0` at the base zeroes the product regardless
      // of sign, so `-0`/`0` are both an acceptable "no offset" (Object.is
      // distinguishes them; a plain equality/absolute check does not).
      expect(Math.abs(windOffset(0, t, 1.234, 0.5))).toBe(0);
    }
  });

  it("clamps height01 outside [0,1] the same as the clamped endpoints", () => {
    expect(windOffset(-1, 2, 0.5, 0.4)).toBe(windOffset(0, 2, 0.5, 0.4));
    expect(windOffset(2, 2, 0.5, 0.4)).toBe(windOffset(1, 2, 0.5, 0.4));
  });

  it("scales with strength linearly", () => {
    const a = windOffset(1, 0.4, 0.2, 1);
    const b = windOffset(1, 0.4, 0.2, 3);
    expect(b).toBeCloseTo(a * 3, 10);
  });

  it("never exceeds |strength| in magnitude", () => {
    for (let t = 0; t < 20; t += 0.37) {
      const v = windOffset(1, t, 0.9, 0.5);
      expect(Math.abs(v)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it("the height ramp is gentler near the base than the tip (squared, not linear)", () => {
    // At a phase/time where sin(...) is comfortably positive, offset(0.5) should
    // be a QUARTER (0.5^2) of offset(1), not a HALF (a linear ramp).
    const t = 0.1;
    const phase = Math.PI / 2 - WIND_SPEED * t; // sin(t*speed + phase) = 1
    const top = windOffset(1, t, phase, 1);
    const mid = windOffset(0.5, t, phase, 1);
    expect(mid).toBeCloseTo(top * 0.25, 10);
  });
});

describe("WIND_WRAP_PERIOD", () => {
  it("closes the sine argument on an exact 2π cycle", () => {
    // sin(t*speed) and sin((t+WRAP)*speed) must match for any phase/time.
    const phase = 0.77;
    const t = 3.3;
    const before = Math.sin(t * WIND_SPEED + phase);
    const after = Math.sin((t + WIND_WRAP_PERIOD) * WIND_SPEED + phase);
    expect(after).toBeCloseTo(before, 9);
  });

  it("is a small, positive, finite period", () => {
    expect(WIND_WRAP_PERIOD).toBeGreaterThan(0);
    expect(Number.isFinite(WIND_WRAP_PERIOD)).toBe(true);
  });
});
