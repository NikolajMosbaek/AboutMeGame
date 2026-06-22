import * as THREE from "three";
import type { Engine } from "../engine/Engine.ts";
import type { FrameContext, System } from "../engine/types.ts";
import { buildTerrain, type Terrain } from "./terrain.ts";
import { buildSky, type Sky } from "./sky.ts";
import { buildBoundaries, type Boundaries } from "./boundaries.ts";
import { buildLandmarks, type Landmarks } from "./landmarks.ts";
import { buildProps } from "./props.ts";
import { WORLD } from "./worldConfig.ts";

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
 */
export function buildWorld(engine: Engine): World {
  const { scene } = engine;

  const terrain = buildTerrain();
  scene.add(terrain.mesh);

  const sky = buildSky(scene);
  scene.add(sky.group);

  const boundaries = buildBoundaries();
  scene.add(boundaries.group);

  const landmarks = buildLandmarks(terrain);
  scene.add(landmarks.group);

  const props = buildProps(terrain);
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
  engine.addSystem(new BeaconPulseSystem(world));

  return world;
}

/**
 * Gently pulses every landmark beacon's opacity so the navigation targets feel
 * alive. Owns no camera or player state — Epic 3 installs the follow camera and
 * the vehicle, Epic 4 the discovery tracking, all against the same world.
 */
class BeaconPulseSystem implements System {
  readonly id = "beacons";
  private beacons: THREE.MeshBasicMaterial[] = [];

  constructor(private readonly world: World) {
    world.landmarks.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name === "beacon") {
        this.beacons.push(o.material as THREE.MeshBasicMaterial);
      }
    });
  }

  update(ctx: FrameContext): void {
    const pulse = 0.22 + Math.sin(ctx.elapsed * 1.5) * 0.1;
    for (const m of this.beacons) m.opacity = pulse;
  }

  describe(): Record<string, unknown> {
    return { poiCount: this.world.landmarks.placed.length };
  }
}
