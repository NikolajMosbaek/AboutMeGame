import { describe, expect, it } from "vitest";
import { makeNoise2D } from "./noise.ts";

describe("value noise", () => {
  it("is deterministic for a seed", () => {
    const a = makeNoise2D(42);
    const b = makeNoise2D(42);
    expect(a.value(1.3, 4.7)).toBe(b.value(1.3, 4.7));
    expect(a.fbm(2.1, -3.3, 4)).toBe(b.fbm(2.1, -3.3, 4));
  });

  it("differs across seeds", () => {
    expect(makeNoise2D(1).value(5, 5)).not.toBe(makeNoise2D(2).value(5, 5));
  });

  it("stays within [0,1]", () => {
    const n = makeNoise2D(7);
    for (let i = 0; i < 200; i++) {
      const v = n.fbm(i * 0.37, -i * 0.91, 5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("is continuous — neighbouring samples are close", () => {
    const n = makeNoise2D(7);
    const a = n.value(10.0, 10.0);
    const b = n.value(10.01, 10.0);
    expect(Math.abs(a - b)).toBeLessThan(0.05);
  });
});
