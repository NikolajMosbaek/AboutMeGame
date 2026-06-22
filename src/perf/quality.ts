// Quality scaling (#47, #48).
//
// One typed `QualityConfig` per device tier, and a pure `resolveQuality` that
// turns the player's `quality` setting into the effective config: "auto" defers
// to the detected device tier (deviceCapability.ts), "low"/"high" force that
// tier. The config is the single source the renderer, world, props and sky read
// their cost knobs from — so "make the low tier fit a mid-range phone" is one
// table here, asserted in quality.test.ts and documented in docs/perf-budget.md.

import type { DeviceTier } from "./deviceCapability.ts";

/** The render budget for one tier. Every cost knob the scaler controls. */
export interface QualityConfig {
  /** Which tier this config is. */
  tier: DeviceTier;
  /** Cap on `renderer.setPixelRatio` — the biggest fill-rate lever on mobile. */
  maxPixelRatio: number;
  /** Whether the sun casts real-time shadows (off entirely on low). */
  shadows: boolean;
  /** Shadow-map resolution when `shadows` is on. Ignored when off. */
  shadowMapSize: number;
  /** 0..1 multiplier on the tree/rock counts — fewer instances, fewer tris. */
  propDensity: number;
  /** Whether atmospheric fog is drawn. Cheap, but the low tier drops it so the
   *  shorter draw distance reads cleanly rather than fading to haze. */
  fog: boolean;
}

/**
 * The tier table. Low is tuned to comfortably clear the mobile budget
 * (`docs/perf-budget.md`): pixelRatio 1, shadows off, ~40% of the props. Medium
 * turns shadows on at a small map and a 1.5 DPR cap. High is full quality.
 */
export const QUALITY_TIERS: Record<DeviceTier, QualityConfig> = {
  low: {
    tier: "low",
    maxPixelRatio: 1,
    shadows: false,
    shadowMapSize: 1024,
    propDensity: 0.4,
    fog: false,
  },
  medium: {
    tier: "medium",
    maxPixelRatio: 1.5,
    shadows: true,
    shadowMapSize: 1024,
    propDensity: 0.7,
    fog: true,
  },
  high: {
    tier: "high",
    maxPixelRatio: 2,
    shadows: true,
    shadowMapSize: 2048,
    propDensity: 1,
    fog: true,
  },
};

/** The player's graphics setting (mirrors `settingsStore.Quality`). */
export type QualitySetting = "auto" | "low" | "high";

/**
 * Resolve the effective config from the setting and the detected tier. "auto"
 * follows the device; an explicit "low"/"high" forces it. Pure — no globals.
 */
export function resolveQuality(setting: QualitySetting, detected: DeviceTier): QualityConfig {
  const tier: DeviceTier = setting === "auto" ? detected : setting;
  return QUALITY_TIERS[tier];
}
