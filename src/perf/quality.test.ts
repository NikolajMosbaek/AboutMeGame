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
    // Low still gets the env-light IBL (all tiers), just never regenerates.
    expect(low.envDynamic).toBe(false);
    // Low gets NO terrain textures at all — the plain vertex-colour terrain,
    // unchanged from before this slice (the render gate's own finding:
    // CI's software-GL runner, the low tier's real ≤2-core-device stand-in,
    // timed out on even the albedo-only splat path).
    expect(low.terrainDetail).toBe("none");
    // Low ships byte-identical water to before this slice: no ripple normal
    // maps, no depth absorption, no foam breakup (visual-overhaul slice 4).
    expect(low.waterDetail).toBe("none");
    // Low gets no cloud layer at all — zero extra draw call (visual-overhaul
    // slice 5). The sky dome atmosphere + starfield are NOT gated, so they're
    // not asserted here (every tier gets them).
    expect(low.cloudDetail).toBe("none");
    // Low never upgrades to the CC0 flora models / grass layer (visual-
    // overhaul slice 6) — the exact pre-slice-6 procedural vegetation forever.
    expect(low.floraDetail).toBe("none");
    // Low gets no ambient-mote/leaf layer either (visual-overhaul slice 7) —
    // zero extra draw calls, same shape as terrainDetail/cloudDetail.
    expect(low.ambientParticles).toBe("none");
    // Low never upgrades the man-made objects to the CC0 camp/canoe/ruin
    // models (Objects slice 1) — the exact procedural sites forever.
    expect(low.objectDetail).toBe("none");
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
    expect(med.envDynamic).toBe(true);
    // Medium runs N8AO at its cheapest preset.
    expect(med.ao.qualityMode).toBe("Performance");
    // Medium gets full terrain detail (normal maps) at a modest anisotropy.
    expect(med.terrainDetail).toBe("full");
    expect(med.textureAnisotropy).toBe(4);
    // Medium also gets the water ripple/depth-absorption detail (needs
    // waterDisplacement, which is also on here).
    expect(med.waterDetail).toBe("full");
    // Medium gets the drifting cloud layer (visual-overhaul slice 5).
    expect(med.cloudDetail).toBe("full");
    // Medium upgrades flora to the CC0 models + grass layer (slice 6).
    expect(med.floraDetail).toBe("full");
    // Medium gets the ambient-mote/leaf layer too (visual-overhaul slice 7).
    expect(med.ambientParticles).toBe("full");
    // Medium upgrades the man-made objects to the CC0 models (Objects slice 1).
    expect(med.objectDetail).toBe("full");
  });

  it("the high tier is full quality", () => {
    const high = resolveQuality("high", "low");
    expect(high.maxPixelRatio).toBe(2);
    expect(high.shadows).toBe(true);
    expect(high.shadowMapSize).toBe(2048);
    expect(high.propDensity).toBe(1);
    expect(high.waterDisplacement).toBe(true);
    expect(high.bloom).toBe(true);
    expect(high.envDynamic).toBe(true);
    // High runs a sharper N8AO preset than medium.
    expect(high.ao.qualityMode).toBe("Medium");
    // High gets full terrain detail at the sharpest anisotropy.
    expect(high.terrainDetail).toBe("full");
    expect(high.textureAnisotropy).toBe(8);
    expect(high.waterDetail).toBe("full");
    expect(high.cloudDetail).toBe("full");
    expect(high.floraDetail).toBe("full");
    // High gets the ambient-mote/leaf layer (visual-overhaul slice 7).
    expect(high.ambientParticles).toBe("full");
    expect(high.objectDetail).toBe("full");
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
    // The env-light IBL regen (envDynamic) is off only at the bottom tier —
    // low still gets the environment map itself, just baked once.
    expect(QUALITY_TIERS.low.envDynamic).toBe(false);
    expect(QUALITY_TIERS.medium.envDynamic).toBe(true);
    expect(QUALITY_TIERS.high.envDynamic).toBe(true);
    // Terrain textures (albedo + normal-map splat) are off entirely only at
    // the bottom tier; anisotropy scales monotonically too.
    expect(QUALITY_TIERS.low.terrainDetail).toBe("none");
    expect(QUALITY_TIERS.medium.terrainDetail).toBe("full");
    expect(QUALITY_TIERS.high.terrainDetail).toBe("full");
    expect(order[1].textureAnisotropy).toBeGreaterThanOrEqual(order[0].textureAnisotropy);
    expect(order[2].textureAnisotropy).toBeGreaterThanOrEqual(order[1].textureAnisotropy);
    // Water ripple/depth-absorption detail (visual-overhaul slice 4) is off
    // only at the bottom tier, same shape as terrainDetail.
    expect(QUALITY_TIERS.low.waterDetail).toBe("none");
    expect(QUALITY_TIERS.medium.waterDetail).toBe("full");
    expect(QUALITY_TIERS.high.waterDetail).toBe("full");
    // Every tier that has waterDetail:"full" also has waterDisplacement:true —
    // the patch's own defensive AND-gate assumes this pairing.
    for (const cfg of order) {
      if (cfg.waterDetail === "full") expect(cfg.waterDisplacement).toBe(true);
    }
    // Cloud layer detail (visual-overhaul slice 5) is off only at the bottom
    // tier, same shape as terrainDetail/waterDetail.
    expect(QUALITY_TIERS.low.cloudDetail).toBe("none");
    expect(QUALITY_TIERS.medium.cloudDetail).toBe("full");
    expect(QUALITY_TIERS.high.cloudDetail).toBe("full");
    // Flora model detail (visual-overhaul slice 6) is off only at the bottom
    // tier, same shape as terrainDetail/waterDetail/cloudDetail.
    expect(QUALITY_TIERS.low.floraDetail).toBe("none");
    expect(QUALITY_TIERS.medium.floraDetail).toBe("full");
    expect(QUALITY_TIERS.high.floraDetail).toBe("full");
    // Ambient particles (visual-overhaul slice 7) are off only at the bottom
    // tier, same shape as terrainDetail/waterDetail/cloudDetail/floraDetail.
    expect(QUALITY_TIERS.low.ambientParticles).toBe("none");
    expect(QUALITY_TIERS.medium.ambientParticles).toBe("full");
    expect(QUALITY_TIERS.high.ambientParticles).toBe("full");
    // Man-made object model detail (Objects slice 1) is off only at the
    // bottom tier, same shape as floraDetail/ambientParticles.
    expect(QUALITY_TIERS.low.objectDetail).toBe("none");
    expect(QUALITY_TIERS.medium.objectDetail).toBe("full");
    expect(QUALITY_TIERS.high.objectDetail).toBe("full");
  });

  it("N8AO's artistic look (radius/falloff/intensity) is identical on medium and high", () => {
    // Only the quality PRESET and half-res should differ by tier — the actual
    // grounding look must not shift when the graphics setting changes.
    const { medium, high } = QUALITY_TIERS;
    expect(medium.ao.aoRadius).toBe(high.ao.aoRadius);
    expect(medium.ao.distanceFalloff).toBe(high.ao.distanceFalloff);
    expect(medium.ao.intensity).toBe(high.ao.intensity);
    // Tuned for this world's scale (520-unit island, 1.7-unit eye height).
    expect(medium.ao.aoRadius).toBeGreaterThanOrEqual(1.5);
    expect(medium.ao.aoRadius).toBeLessThanOrEqual(3);
  });
});
