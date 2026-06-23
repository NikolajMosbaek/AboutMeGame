import * as THREE from "three";
import type { Engine } from "../engine/Engine.ts";
import type { FrameContext, System } from "../engine/types.ts";
import { buildTerrain, type Terrain } from "./terrain.ts";
import { buildSky, type Sky } from "./sky.ts";
import { buildBoundaries, type Boundaries } from "./boundaries.ts";
import { buildLandmarks, type Landmarks } from "./landmarks.ts";
import { buildProps } from "./props.ts";
import { WORLD } from "./worldConfig.ts";
import { QUALITY_TIERS, type QualityConfig } from "../perf/quality.ts";

/** The reduced-motion signal the world reads to hold its beacon pulse (#49). A
 *  `SettingsStore` satisfies it (`getSnapshot().reducedMotion`); tests pass a
 *  fake. Optional everywhere — absent means "motion on". */
export interface ReducedMotionSource {
  getSnapshot(): { reducedMotion: boolean };
}

/** The assembled world. Epic 3 (movement) reads `terrain`/`boundaries`; Epic 4
 *  (discovery) reads `landmarks.placed`. Shared by reference — the DI seam. */
export interface World {
  terrain: Terrain;
  sky: Sky;
  boundaries: Boundaries;
  landmarks: Landmarks;
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

  const boundaries = buildBoundaries(terrain.heightAt);
  scene.add(boundaries.group);

  const landmarks = buildLandmarks(terrain);
  scene.add(landmarks.group);

  const props = buildProps(terrain, quality.propDensity);
  scene.add(props.group);

  const world: World = {
    terrain,
    sky,
    boundaries,
    landmarks,
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
  engine.addSystem(new BeaconPulseSystem(world, reducedMotion));

  return world;
}

/** Static beacon opacity used when motion is reduced — the mid-point of the
 *  pulse, so the beacons read identically but hold still. */
const BEACON_REST_OPACITY = 0.22;

/**
 * Gently pulses every landmark beacon's opacity so the navigation targets feel
 * alive. Owns no camera or player state — Epic 3 installs the follow camera and
 * the vehicle, Epic 4 the discovery tracking, all against the same world.
 *
 * The pulse is non-essential motion, so it's gated by the reduced-motion source
 * (#49): when set, the beacons hold at a steady opacity. Read live each frame so
 * the pause-menu toggle takes effect immediately, without a rebuild.
 */
class BeaconPulseSystem implements System {
  readonly id = "beacons";
  private beacons: THREE.MeshBasicMaterial[] = [];

  constructor(
    private readonly world: World,
    private readonly reducedMotion?: ReducedMotionSource,
  ) {
    world.landmarks.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name === "beacon") {
        this.beacons.push(o.material as THREE.MeshBasicMaterial);
      }
    });
  }

  update(ctx: FrameContext): void {
    const still = this.reducedMotion?.getSnapshot().reducedMotion ?? false;
    const pulse = still ? BEACON_REST_OPACITY : 0.22 + Math.sin(ctx.elapsed * 1.5) * 0.1;
    for (const m of this.beacons) m.opacity = pulse;
  }

  describe(): Record<string, unknown> {
    return { poiCount: this.world.landmarks.placed.length };
  }
}
