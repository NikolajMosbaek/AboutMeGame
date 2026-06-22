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
  engine.addSystem(new WorldPreviewSystem(engine, world));

  return world;
}

/**
 * Temporary Epic 2 system: orbits the camera around the island so the world is
 * visible without a vehicle, and pulses the landmark beacons. Replaced by the
 * follow-camera + input systems in Epic 3 — it owns no state other epics depend
 * on, so swapping it out is clean.
 */
class WorldPreviewSystem implements System {
  readonly id = "worldPreview";
  private angle = 0;
  private beacons: THREE.MeshBasicMaterial[] = [];
  private readonly target = new THREE.Vector3(0, 8, 0);

  constructor(
    private readonly engine: Engine,
    private readonly world: World,
  ) {
    world.landmarks.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name === "beacon") {
        this.beacons.push(o.material as THREE.MeshBasicMaterial);
      }
    });
  }

  update(ctx: FrameContext): void {
    this.angle += ctx.dt * 0.06;
    const r = WORLD.islandRadius * 1.35;
    this.engine.camera.position.set(
      Math.cos(this.angle) * r,
      130,
      Math.sin(this.angle) * r,
    );
    this.engine.camera.lookAt(this.target);
    const pulse = 0.22 + Math.sin(ctx.elapsed * 1.5) * 0.1;
    for (const m of this.beacons) m.opacity = pulse;
  }

  describe(): Record<string, unknown> {
    return {
      poiCount: this.world.landmarks.placed.length,
      cameraOrbitDeg: Math.round(((this.angle * 180) / Math.PI) % 360),
    };
  }
}
