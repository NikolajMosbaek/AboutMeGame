import type { Engine } from "../engine/Engine.ts";
import type { FrameContext, System } from "../engine/types.ts";
import { buildTerrain, type Terrain } from "./terrain.ts";
import { buildSky, type Sky } from "./sky.ts";
import { buildBoundaries, type Boundaries } from "./boundaries.ts";
import { buildLandmarks, type Landmarks } from "./landmarks.ts";
import { buildProps } from "./props.ts";
import { WaterSystem } from "./waterSystem.ts";
import { DayCycleSystem } from "./dayCycleSystem.ts";
import { UnderwaterFxSystem } from "./underwaterFxSystem.ts";
import { buildAquatic } from "./aquatic.ts";
import { ShadowFrustumSystem } from "./shadowFrustumSystem.ts";
import { StarfieldSystem } from "./starfield.ts";
import { CloudSystem } from "./clouds.ts";
import { WORLD } from "./worldConfig.ts";
import { QUALITY_TIERS, type QualityConfig } from "../perf/quality.ts";

/** The reduced-motion signal the world reads to hold its beacon pulse (#49). A
 *  `SettingsStore` satisfies it (`getSnapshot().reducedMotion`); tests pass a
 *  fake. Optional everywhere — absent means "motion on". */
export interface ReducedMotionSource {
  getSnapshot(): { reducedMotion: boolean };
}

/** Half-extent of the player-following shadow frustum (visual-overhaul slice
 *  2, `ShadowFrustumSystem`) — within the design's 60-90-unit range. At this
 *  size (full width 140) the SAME `shadowMapSize` per tier yields texels
 *  roughly 3x smaller than the old whole-island frame (`islandRadius * 1.1`
 *  full width 440): 1024/140 ≈ 0.137 m/texel vs the old ≈ 0.43 m/texel on
 *  medium, ≈0.068 vs ≈0.21 on high — a real, measured sharpening, short of the
 *  design doc's illustrative "~10x" (that figure would need a ~44-unit full
 *  frustum, well outside the stated 60-90 range; recorded here as a deviation
 *  rather than silently claimed). */
const SHADOW_FRUSTUM_HALF_EXTENT = 70;

/** The assembled world. The player reads `terrain`/`boundaries`/`waterDepthAt`;
 *  discovery reads `landmarks.placed`. Shared by reference — the DI seam. */
export interface World {
  terrain: Terrain;
  sky: Sky;
  boundaries: Boundaries;
  landmarks: Landmarks;
  /** Still water depth at a ground point, metres (`<= 0` = dry land). The ONE
   *  definition of "where water is": today the sea plane at `WORLD.seaLevel`
   *  over anything the terrain dips below it — the same `seaLevel - height`
   *  the foam bake uses. Movement (wading/blocking), and later drinking,
   *  audio and FX all ask here, so a reshaped river changes one function. */
  waterDepthAt(x: number, z: number): number;
  /** The living-sky loop's current phase (pivot slice F wildlife seam),
   *  current palette (visual-overhaul slice 2's `EnvLightSystem` seam), and
   *  live sun direction (visual-overhaul slice 5's god-rays seam) — see
   *  `DayCycleSystem.getPhase()`/`getPalette()`/`getSunDirection()`. Exposed
   *  as this narrow accessor, never the System itself, so a consumer can't
   *  reach into the sky/dome/fog handles. `EnvLightSystem` and the
   *  post-processing compositor's god rays are both built OUTSIDE `buildWorld`
   *  (by `GameCanvas`, which owns the real renderer they each need) and read
   *  this same accessor. */
  dayCycle: Pick<DayCycleSystem, "getPhase" | "getPalette" | "getSunDirection">;
  dispose(): void;
}

/**
 * Compose the whole environment into the engine and return the handle later
 * epics build on. For Epic 2 it also installs a slow cinematic preview camera
 * so the world can be seen and verified before movement exists (Epic 3 replaces
 * it with the follow camera) and a gentle beacon pulse.
 *
 * `quality` (the resolved tier from the scaler, #47) tunes the build-time cost:
 * prop density and the sun's shadow map / fog. Defaults to full (high) so tests
 * and previews keep the old behaviour without passing it. `reducedMotion` (#49)
 * lets the beacon pulse hold still when the player has asked for less motion;
 * read live each frame, so toggling the setting takes effect at once.
 */
export function buildWorld(
  engine: Engine,
  quality: QualityConfig = QUALITY_TIERS.high,
  reducedMotion?: ReducedMotionSource,
): World {
  const { scene } = engine;

  const terrain = buildTerrain(quality);
  scene.add(terrain.mesh);

  const sky = buildSky(scene, {
    shadows: quality.shadows,
    shadowMapSize: quality.shadowMapSize,
    fog: quality.fog,
  });
  scene.add(sky.group);

  const boundaries = buildBoundaries(
    terrain.heightAt,
    quality.waterDisplacement,
    quality.waterDetail === "full",
    quality.textureAnisotropy,
  );
  scene.add(boundaries.group);

  const landmarks = buildLandmarks(terrain);
  scene.add(landmarks.group);

  const props = buildProps(terrain, quality.propDensity);
  scene.add(props.group);

  // Aquatic life (#184): kelp beds + lily pads in the lagoon (2 draw calls,
  // deterministic). The sway system registers below, gated by reduced motion.
  const aquatic = buildAquatic(terrain);
  scene.add(aquatic.group);

  // Constructed here (not inline in the `addSystem` call below) so `World.dayCycle`
  // can close over the live instance — the single production importer of
  // `./dayCycle` (the chain that wires the pure palette into the bundle) stays
  // unchanged; only WHERE the reference is held moves.
  const dayCycleSystem = new DayCycleSystem(sky.sun, sky.dome, sky.fog, reducedMotion);

  const world: World = {
    terrain,
    sky,
    boundaries,
    landmarks,
    waterDepthAt: (x, z) => WORLD.seaLevel - terrain.heightAt(x, z),
    dayCycle: {
      getPhase: () => dayCycleSystem.getPhase(),
      getPalette: () => dayCycleSystem.getPalette(),
      getSunDirection: () => dayCycleSystem.getSunDirection(),
    },
    dispose() {
      terrain.dispose();
      sky.dispose();
      boundaries.dispose();
      landmarks.dispose();
      props.dispose();
      aquatic.dispose();
    },
  };

  engine.camera.far = WORLD.size * 2;
  engine.camera.updateProjectionMatrix();
  // The sites census — a zero-cost system whose describe() feeds
  // render_game_to_text (`systems.sites.poiCount`), replacing the retired
  // beacon pulse's census now that sites carry no sky-beacons.
  engine.addSystem(new SitesCensusSystem(world));

  // The water swell clock — installed ONLY on medium/high, where
  // `quality.waterDisplacement` compiled the vertex swell and `buildBoundaries`
  // exposes the live `uTime` uniform. On low the water is the static slice-2
  // surface (no `waterUniforms`), so no clock is owed and none is paid.
  if (boundaries.waterUniforms) {
    engine.addSystem(
      new WaterSystem(boundaries.waterUniforms, reducedMotion),
    );
  }

  // The living-sky day cycle (G3) — registered UNCONDITIONALLY, since the sun
  // and dome exist on every tier and the fog handle is
  // null-guarded for the low tier. Injected the three live sky handles
  // individually (never the whole World/Sky), and the reduced-motion gate so it
  // pins to golden hour and holds when the player asks for less motion.
  engine.addSystem(dayCycleSystem);

  // The player-following, texel-snapped shadow frustum (visual-overhaul slice
  // 2) — visual-only, registered here alongside the sky/water systems, NOT the
  // interact-key chain. Only where shadows actually run (`quality.shadows`):
  // on low there is no shadow map to sharpen, so nothing is registered (a
  // system that only ever repositioned an inert light would be pure waste).
  // AFTER the day cycle so it reads THIS frame's freshly-written sun
  // direction before recentering (see `ShadowFrustumSystem`'s own doc for why
  // one frame of lag would be harmless either way).
  if (quality.shadows) {
    engine.addSystem(
      new ShadowFrustumSystem(sky.sun, dayCycleSystem, {
        halfExtent: SHADOW_FRUSTUM_HALF_EXTENT,
        mapSize: quality.shadowMapSize,
      }),
    );
  }

  // Underwater fog (#184) — AFTER the day cycle, which owns the fog colour:
  // this layers the submerged teal + density on top and restores exactly on
  // surfacing. Null-fog (low tier) makes it a no-op, like the day cycle's own
  // fog write.
  engine.addSystem(new UnderwaterFxSystem(sky.fog));

  // Kelp sway (#184) — gentle and non-essential, so it holds still under the
  // same live reduced-motion gate the water swell reads.
  engine.addSystem(aquatic.sway(reducedMotion));

  // Starfield (visual-overhaul slice 5) — ONE cheap Points draw call, every
  // tier (it's too cheap to gate). Reads the day cycle's sun direction (its
  // own accessor, not `./dayCycle`) to fade in as the sun gets low and holds
  // its twinkle/rotation still under reduced motion, mirroring the aquatic
  // sway's gate.
  engine.addSystem(new StarfieldSystem(scene, dayCycleSystem, reducedMotion));

  // Drifting clouds (visual-overhaul slice 5) — ONE InstancedMesh draw call,
  // medium/high only (`quality.cloudDetail`): a bake-at-mount knob, like
  // `terrainDetail`/`waterDetail`, so it "applies on reload".
  if (quality.cloudDetail === "full") {
    engine.addSystem(new CloudSystem(scene, dayCycleSystem, reducedMotion));
  }

  return world;
}

/**
 * The sites census: no per-frame work, but its describe() keeps the site count
 * visible in the render_game_to_text state the smoke tooling reads (the beacon
 * pulse that used to carry this census retired with the sky-beacons — jungle
 * sites are found by reading clues, not by glowing pillars).
 */
class SitesCensusSystem implements System {
  readonly id = "sites";

  constructor(private readonly world: World) {}

  update(_ctx: FrameContext): void {}

  describe(): Record<string, unknown> {
    return { poiCount: this.world.landmarks.placed.length };
  }
}
