import { describe, expect, it } from "vitest";
import { detectTier, type CapabilityEnv } from "./deviceCapability.ts";

/** A baseline desktop-ish env; tests override one field at a time. */
function env(overrides: Partial<CapabilityEnv> = {}): CapabilityEnv {
  return {
    hardwareConcurrency: 8,
    deviceMemory: 8,
    devicePixelRatio: 1,
    coarsePointer: false,
    maxTouchPoints: 0,
    ...overrides,
  };
}

describe("detectTier", () => {
  it("rates a strong desktop high", () => {
    expect(detectTier(env({ hardwareConcurrency: 12, deviceMemory: 16 }))).toBe("high");
  });

  it("rates a mid laptop medium", () => {
    expect(detectTier(env({ hardwareConcurrency: 4, deviceMemory: 4 }))).toBe("medium");
  });

  it("rates a low-core / low-memory device low", () => {
    expect(detectTier(env({ hardwareConcurrency: 2, deviceMemory: 2 }))).toBe("low");
  });

  it("treats a touch device with many cores as no better than medium", () => {
    // A phone may report 8 cores but cannot match a desktop GPU; the coarse
    // pointer caps it so we never push a high-tier load onto mobile.
    expect(detectTier(env({ hardwareConcurrency: 8, deviceMemory: 8, coarsePointer: true, maxTouchPoints: 5 }))).toBe(
      "medium",
    );
  });

  it("rates a weak phone low", () => {
    expect(
      detectTier(env({ hardwareConcurrency: 4, deviceMemory: 2, coarsePointer: true, maxTouchPoints: 5, devicePixelRatio: 3 })),
    ).toBe("low");
  });

  it("falls back gracefully when signals are missing", () => {
    // Older browsers omit deviceMemory; an unknown env should not crash and
    // should land on a safe middle tier rather than assuming a powerful device.
    expect(detectTier(env({ hardwareConcurrency: undefined, deviceMemory: undefined }))).toBe("medium");
  });

  it("is a pure function of its env argument (no globals read)", () => {
    const e = env({ hardwareConcurrency: 1, deviceMemory: 1 });
    expect(detectTier(e)).toBe(detectTier(e));
  });
});
