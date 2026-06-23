import { describe, expect, it } from "vitest";
import { resolveQuality, QUALITY_TIERS, type QualityConfig } from "./quality.ts";

describe("resolveQuality", () => {
  it("maps a forced setting straight to that tier, ignoring the device", () => {
    expect(resolveQuality("low", "high").tier).toBe("low");
    expect(resolveQuality("high", "low").tier).toBe("high");
  });

  it("uses the detected tier in auto mode", () => {
    expect(resolveQuality("auto", "medium").tier).toBe("medium");
    expect(resolveQuality("auto", "low").tier).toBe("low");
    expect(resolveQuality("auto", "high").tier).toBe("high");
  });

  // The acceptance bar: low must comfortably fit a mid-range phone — no shadows,
  // pixelRatio 1, meaningfully fewer props, and no water vertex displacement.
  it("the low tier fits the mobile budget", () => {
    const low = resolveQuality("low", "high");
    expect(low.maxPixelRatio).toBe(1);
    expect(low.shadows).toBe(false);
    expect(low.propDensity).toBeLessThanOrEqual(0.5);
    expect(low.waterDisplacement).toBe(false);
    expect(low.bloom).toBe(false);
  });

  it("the medium tier turns shadows on at a smaller map and caps DPR", () => {
    // Medium is only reachable via auto (the forced settings are low/high); auto
    // on a medium device yields the medium config.
    const med = resolveQuality("auto", "medium");
    expect(med.maxPixelRatio).toBe(1.5);
    expect(med.shadows).toBe(true);
    expect(med.shadowMapSize).toBe(1024);
    expect(med.propDensity).toBeGreaterThan(0.5);
    expect(med.propDensity).toBeLessThan(1);
    expect(med.waterDisplacement).toBe(true);
    expect(med.bloom).toBe(true);
  });

  it("the high tier is full quality", () => {
    const high = resolveQuality("high", "low");
    expect(high.maxPixelRatio).toBe(2);
    expect(high.shadows).toBe(true);
    expect(high.shadowMapSize).toBe(2048);
    expect(high.propDensity).toBe(1);
    expect(high.waterDisplacement).toBe(true);
    expect(high.bloom).toBe(true);
  });

  it("monotonically scales every cost knob across the tiers", () => {
    const order: Array<QualityConfig> = [
      QUALITY_TIERS.low,
      QUALITY_TIERS.medium,
      QUALITY_TIERS.high,
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i].maxPixelRatio).toBeGreaterThanOrEqual(order[i - 1].maxPixelRatio);
      expect(order[i].propDensity).toBeGreaterThanOrEqual(order[i - 1].propDensity);
    }
    // shadows are off only at the bottom tier.
    expect(QUALITY_TIERS.low.shadows).toBe(false);
    expect(QUALITY_TIERS.medium.shadows).toBe(true);
    expect(QUALITY_TIERS.high.shadows).toBe(true);
    // water vertex displacement is off only at the bottom tier (protects the
    // low tier's fill rate from the subdivided, animated water plane).
    expect(QUALITY_TIERS.low.waterDisplacement).toBe(false);
    expect(QUALITY_TIERS.medium.waterDisplacement).toBe(true);
    expect(QUALITY_TIERS.high.waterDisplacement).toBe(true);
    // the bloom post-pass is off only at the bottom tier (the full-screen
    // fill-rate spend is held off mobile to protect the low tier).
    expect(QUALITY_TIERS.low.bloom).toBe(false);
    expect(QUALITY_TIERS.medium.bloom).toBe(true);
    expect(QUALITY_TIERS.high.bloom).toBe(true);
  });
});
