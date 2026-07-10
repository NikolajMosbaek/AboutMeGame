import type { Engine } from "../engine/Engine.ts";
import type { FrameContext, System } from "../engine/types.ts";
import { buildTerrain, type Terrain } from "./terrain.ts";
import { buildSky, type Sky } from "./sky.ts";
import { buildBoundaries, type Boundaries } from "./boundaries.ts";
import { buildLandmarks, type Landmarks } from "./landmarks.ts";
import { buildProps } from "./props.ts";
import { WaterSystem } from "./waterSystem.ts";
import { DayCycleSystem } from "./dayCycleSystem.ts";
import { WORLD } from "./worldConfig.ts";
import { QUALITY_TIERS, type QualityConfig } from "../perf/quality.ts";

/** The reduced-motion signal the world reads to hold its beacon pulse (#49). A
 *  `SettingsStore` satisfies it (`getSnapshot().reducedMotion`); tests pass a
 *  fake. Optional everywhere — absent means "motion on". */
export interface ReducedMotionSource {
  getSnapshot(): { reducedMotion: boolean };
}

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
  /** The living-sky loop's current phase (pivot slice F wildlife seam) — see
   *  `DayCycleSystem.getPhase()`. Exposed as the narrow accessor, never the
   *  System itself, so a consumer can't reach into the sky/dome/fog handles. */
  dayCycle: { getPhase(): number };
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

  const terrain = buildTerrain();
  scene.add(terrain.mesh);

  const sky = buildSky(scene, {
    shadows: quality.shadows,
    shadowMapSize: quality.shadowMapSize,
    fog: quality.fog,
  });
  scene.add(sky.group);

  const boundaries = buildBoundaries(terrain.heightAt, quality.waterDisplacement);
  scene.add(boundaries.group);

  const landmarks = buildLandmarks(terrain);
  scene.add(landmarks.group);

  const props = buildProps(terrain, quality.propDensity);
  scene.add(props.group);

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
    dayCycle: { getPhase: () => dayCycleSystem.getPhase() },
    dispose() {
      terrain.dispose();
      sky.dispose();
      boundaries.dispose();
      landmarks.dispose();
      props.dispose();
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
