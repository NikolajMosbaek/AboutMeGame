// Quality scaling (#47, #48).
//
// One typed `QualityConfig` per device tier, and a pure `resolveQuality` that
// turns the player's `quality` setting into the effective config: "auto" defers
// to the detected device tier (deviceCapability.ts), "low"/"high" force that
// tier. The config is the single source the renderer, world, props and sky read
// their cost knobs from — so "make the low tier fit a mid-range phone" is one
// table here, asserted in quality.test.ts and documented in docs/perf-budget.md.

import type { DeviceTier } from "./deviceCapability.ts";

/** N8AO tuning for one tier (visual-overhaul slice 2) — only reached on the
 *  tiers that build a compositor (`bloom: true`); the low tier's `ao` value is
 *  otherwise inert (the compositor, and therefore N8AO, is never constructed
 *  there). `aoRadius`/`distanceFalloff`/`intensity` are the ARTISTIC look
 *  (same for every tier that runs AO — tuned once for this island's scale);
 *  `qualityMode`/`halfRes` are the per-tier cost/quality levers. */
export interface AOQualityConfig {
  /** World-unit AO radius (N8AO's `configuration.aoRadius`) — how far the
   *  occlusion reaches from a given surface. Tuned for this world's scale
   *  (520-unit island, 1.7-unit eye height): grounded contact darkening under
   *  trees/rocks/tent, not a dirty-corners look. */
  aoRadius: number;
  /** N8AO's `distanceFalloff` (post-1.7 API: a ratio of `aoRadius`, not an
   *  absolute distance). */
  distanceFalloff: number;
  /** Artistic AO strength (`pow(ao, intensity)`) — moderate, not a heavy
   *  black-crevice look. */
  intensity: number;
  /** N8AO's built-in quality preset — the sample-count/cost lever. */
  qualityMode: "Performance" | "Low" | "Medium" | "High" | "Ultra";
  /** Compute AO at half resolution, upscaled — a 2-4x speed win with
   *  negligible quality loss (N8AO's depth-aware upsampling); a deliberate
   *  mobile-fill-rate-first default on every tier that runs AO. */
  halfRes: boolean;
}

/** The render budget for one tier. Every cost knob the scaler controls. */
export interface QualityConfig {
  /** Which tier this config is. */
  tier: DeviceTier;
  /** Cap on `renderer.setPixelRatio` — the biggest fill-rate lever on mobile. */
  maxPixelRatio: number;
  /** Whether the sun casts real-time shadows (off entirely on low). */
  shadows: boolean;
  /** Blob grounding discs under solid props/landmarks (G5 #160) — ONLY for
   *  tiers without a real shadow pass, where objects would otherwise float;
   *  a blob under a shadow-mapped tree double-shadows. Build-time knob. */
  groundingShadows: boolean;
  /** Shadow-map resolution when `shadows` is on. Ignored when off. */
  shadowMapSize: number;
  /** 0..1 multiplier on the tree/rock counts — fewer instances, fewer tris. */
  propDensity: number;
  /** Whether atmospheric fog is drawn. Cheap, but the low tier drops it so the
   *  shorter draw distance reads cleanly rather than fading to haze. */
  fog: boolean;
  /** Whether the water plane animates with vertex displacement + a subdivided
   *  grid. A bake-at-mount knob (it changes the compiled program text via
   *  `customProgramCacheKey` and the geometry subdivision), so it applies on
   *  reload, not via the live `applyRendererQuality` path. Off on low to keep
   *  the subdivided, animated full-screen water plane off mobile fill rate. */
  waterDisplacement: boolean;
  /** Whether the bloom post-processing pass runs, so emissive landmarks
   *  (the site accents — journal page, statue eyes — and later fireflies) visibly glow. A FILL-RATE knob — a
   *  full-screen threshold + blur pass over the framebuffer, NOT a
   *  draw-call/triangle knob — so it is off on low to protect mobile fill rate.
   *  The actual EffectComposer pass lives behind the renderer seam, wired in a
   *  later G2 slice; this field is the cost-table source it reads from. */
  bloom: boolean;
  /** Whether the sky-driven IBL environment map (`EnvLightSystem`, visual-
   *  overhaul slice 2) regenerates as the day cycle moves. `false` (low) bakes
   *  ONCE at load (the golden-hour keyframe) and never regenerates — a free
   *  visual upgrade with zero steady-state cost. Every tier gets the
   *  environment light itself; this only gates whether it TRACKS the cycle. */
  envDynamic: boolean;
  /** N8AO ambient-occlusion tuning (medium/high only — see {@link AOQualityConfig}). */
  ao: AOQualityConfig;
  /** Terrain PBR splat detail (visual-overhaul slice 3): `"full"` (medium/high)
   *  fetches the 4 albedo + 4 normal ground textures and patches them into the
   *  terrain's `onBeforeCompile` (`terrainMaterialPatch.ts`) — a mid-boot
   *  shader recompile plus 8 texture samples/fragment steady-state. `"none"`
   *  (low) never fetches, never patches, never recompiles: the terrain keeps
   *  the plain vertex-colour `MeshStandardMaterial` exactly as it renders
   *  today. This is the render gate's own finding (CI's software-GL/SwiftShader
   *  runner, the low tier's real ≤2-core-device stand-in, timed out on the
   *  albedo path's texture fetches + mipmap generation + shader recompile) —
   *  the low tier's floor is "never slower than today", so it gets no terrain
   *  textures at all rather than a cheaper one. A bake-at-mount knob (it
   *  changes `customProgramCacheKey`/skips the fetch entirely), so it applies
   *  on reload like `shadowMapSize`/`fog`. */
  terrainDetail: "none" | "full";
  /** Water ripple-normal-map detail (visual-overhaul slice 4): `"full"`
   *  (medium/high) loads a single ripple-normal texture and patches the
   *  water's `onBeforeCompile` (`src/world/waterPatch.ts`) with two scrolling
   *  samples of it — combined with the existing analytic wave normal for
   *  per-fragment sparkle, a physically-plausible depth-based colour
   *  absorption term, and a raggedized foam edge. `"none"` (low) never
   *  fetches, never patches: the water stays byte-identical to the pre-slice-4
   *  look (following the `terrainDetail` precedent exactly — same low-tier
   *  floor, same bake-at-mount/"applies on reload" cost shape). Requires
   *  `waterDisplacement` to also be on (`boundaries.ts`/`waterPatch.ts` AND
   *  the two together defensively); every tier that has one has the other. */
  waterDetail: "none" | "full";
  /** Cloud layer detail (visual-overhaul slice 5): `"full"` (medium/high)
   *  constructs the drifting-cloud `InstancedMesh` (`src/world/clouds.ts`,
   *  `CloudSystem`) — one extra draw call, ~7 cheap billboard quads. `"none"`
   *  (low) never constructs it at all: zero extra draw call, zero extra
   *  triangles, following the `terrainDetail`/`waterDetail` precedent (a
   *  bake-at-mount knob, so it "applies on reload" like those). The sky dome's
   *  own atmosphere upgrade and the starfield are NOT gated by this — they run
   *  on every tier (a single shared dome shader patch and one cheap `Points`
   *  draw call respectively). */
  cloudDetail: "none" | "full";
  /** Anisotropic filtering level for every repeating-UV surface texture: the
   *  terrain's 4 splat textures (both albedo and, on `"full"`, normal maps)
   *  AND the water's ripple-normal detail map (visual-overhaul slice 4) — a
   *  cheap fill-rate knob (three clamps it to the device's real max at bind
   *  time, so requesting more than the GPU supports is always safe). Shared
   *  across both features rather than duplicated per-feature: the terrain and
   *  water grazing-angle viewing geometry both want the SAME filtering floor,
   *  so one tier value serves both. 4 on low/medium, 8 on high where the extra
   *  samples are affordable. */
  textureAnisotropy: number;
  /** Flora model detail (visual-overhaul slice 6): `"full"` (medium/high)
   *  asynchronously loads the CC0 low-poly tree/palm/understory/rock GLBs
   *  (`src/world/floraUpgrade.ts`, behind a LAZY dynamic import — see that
   *  module's own doc for why) and swaps them in at the SAME seeded
   *  `props.ts` placements, plus builds the wind-swayed grass layer
   *  (`src/world/grass.ts`). `"none"` (low) never imports the upgrade chunk,
   *  never fetches a model, never builds the grass layer: the world keeps the
   *  EXACT pre-slice-6 procedural cylinder/cross-plane vegetation forever —
   *  the same "low tier must not get slower than today" floor
   *  `terrainDetail`/`waterDetail`/`cloudDetail` already hold. A bake-at-mount
   *  knob (constructing the upgrade at all is the cost), so it "applies on
   *  reload" like those. */
  floraDetail: "none" | "full";
  /** Ambient particles (visual-overhaul slice 7, polish): `"full"` (medium/
   *  high) constructs `AmbientMotesSystem` (`src/fx/AmbientMotesSystem.ts`) —
   *  2 extra `Points` draw calls, ~250 total points, no triangles. `"none"`
   *  (low) never constructs it: zero extra draw calls, following the exact
   *  `cloudDetail`/`floraDetail` precedent (a bake-at-mount knob, "applies on
   *  reload"). Cheap enough that medium and high share the same value — there
   *  is no cost lever left to differ between them, unlike `shadowMapSize` or
   *  `ao.qualityMode`. */
  ambientParticles: "none" | "full";
  /** Man-made object model detail (Objects slice 1, "make the objects look
   *  like what they really are"): `"full"` (medium/high) asynchronously loads
   *  the CC0 camp/canoe/ruin object GLBs (`src/world/landmarksUpgrade.ts`,
   *  behind a LAZY dynamic import — the exact `floraDetail`/`floraUpgrade.ts`
   *  precedent) and swaps them into the SAME site anchors `landmarks.ts`
   *  already places. `"none"` (low) never imports the upgrade chunk, never
   *  fetches a model: the world keeps the EXACT procedural site geometry
   *  forever (including this slice's own unconditional, zero-cost procedural
   *  upgrades to the idol/overhang/fig/ruin-gaze-rig, which apply on EVERY
   *  tier since they cost nothing extra — only the literal Kenney-model
   *  swap-in is gated). A bake-at-mount knob, so it "applies on reload" like
   *  `floraDetail`. */
  objectDetail: "none" | "full";
}

/**
 * The tier table. Low is tuned to comfortably clear the mobile budget
 * (`docs/perf-budget.md`): pixelRatio 1, shadows off, ~40% of the props. Medium
 * turns shadows on at a small map and a 1.5 DPR cap. High is full quality.
 */
/** AO's artistic look (radius/falloff/intensity) is the SAME on every tier
 *  that runs it — only the cost levers (`qualityMode`/`halfRes`) scale. Named
 *  here so the two tiers that build a compositor share one source instead of
 *  hand-repeating the tuned constants. */
const AO_LOOK = { aoRadius: 2.2, distanceFalloff: 1, intensity: 3 } as const;

export const QUALITY_TIERS: Record<DeviceTier, QualityConfig> = {
  low: {
    tier: "low",
    maxPixelRatio: 1,
    shadows: false,
    groundingShadows: true,
    shadowMapSize: 1024,
    propDensity: 0.4,
    fog: false,
    waterDisplacement: false,
    bloom: false,
    // Never reached (no compositor is built on low), kept a valid, sane value.
    envDynamic: false,
    ao: { ...AO_LOOK, qualityMode: "Performance", halfRes: true },
    terrainDetail: "none",
    waterDetail: "none",
    cloudDetail: "none",
    textureAnisotropy: 4,
    floraDetail: "none",
    ambientParticles: "none",
    objectDetail: "none",
  },
  medium: {
    tier: "medium",
    maxPixelRatio: 1.5,
    shadows: true,
    groundingShadows: false,
    shadowMapSize: 1024,
    propDensity: 0.7,
    fog: true,
    waterDisplacement: true,
    bloom: true,
    envDynamic: true,
    ao: { ...AO_LOOK, qualityMode: "Performance", halfRes: true },
    terrainDetail: "full",
    waterDetail: "full",
    cloudDetail: "full",
    textureAnisotropy: 4,
    floraDetail: "full",
    ambientParticles: "full",
    objectDetail: "full",
  },
  high: {
    tier: "high",
    maxPixelRatio: 2,
    shadows: true,
    groundingShadows: false,
    shadowMapSize: 2048,
    propDensity: 1,
    fog: true,
    waterDisplacement: true,
    bloom: true,
    envDynamic: true,
    ao: { ...AO_LOOK, qualityMode: "Medium", halfRes: true },
    terrainDetail: "full",
    waterDetail: "full",
    cloudDetail: "full",
    textureAnisotropy: 8,
    floraDetail: "full",
    ambientParticles: "full",
    objectDetail: "full",
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
