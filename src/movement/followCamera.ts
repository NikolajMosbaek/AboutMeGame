import * as THREE from "three";
import type { Engine } from "../engine/Engine.ts";
import type { System, FrameContext } from "../engine/types.ts";
import type { Terrain } from "../world/terrain.ts";
import type { VehicleSystem } from "./vehicle.ts";

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Follow camera (#29) with terrain collision (#30). Trails the craft from behind
 * and above, smoothed so it eases rather than snaps. In flight it trails in full
 * 3D (so a dive points the camera down); on the ground it stays level behind.
 * Collision is handled for a heightfield by never letting the camera sink below
 * the ground beneath it plus a clearance — so it won't clip through a hill it's
 * orbiting. Registered after the vehicle, so it reads the updated state.
 */
export class CameraRigSystem implements System {
  readonly id = "camera";
  private readonly current = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly back = new THREE.Vector3();
  private initialized = false;

  constructor(
    private readonly engine: Engine,
    private readonly vehicle: VehicleSystem,
    private readonly terrain: Terrain,
  ) {}

  update(ctx: FrameContext): void {
    const s = this.vehicle.state;
    const fly = s.mode === "fly";

    // Direction to sit behind: full nose in flight, flattened on the ground.
    this.back.copy(s.nose);
    if (!fly) this.back.y = 0;
    if (this.back.lengthSq() < 1e-5) this.back.set(0, 0, 1);
    this.back.normalize();

    const dist = fly ? 15 : 11;
    const height = fly ? 5.5 : 5;
    this.desired
      .copy(s.position)
      .addScaledVector(this.back, -dist)
      .addScaledVector(WORLD_UP, height);

    // Terrain collision: keep the camera above the ground directly below it.
    const groundClear = this.terrain.heightAt(this.desired.x, this.desired.z) + 2.5;
    if (this.desired.y < groundClear) this.desired.y = groundClear;

    if (!this.initialized) {
      this.current.copy(this.desired);
      this.initialized = true;
    } else {
      // Frame-rate-independent smoothing; snappier in flight.
      const lambda = fly ? 6 : 8;
      dampVec(this.current, this.desired, lambda, ctx.dt);
    }

    this.engine.camera.position.copy(this.current);
    this.look
      .copy(s.position)
      .addScaledVector(s.nose, fly ? 6 : 4)
      .addScaledVector(WORLD_UP, 1.5);
    this.engine.camera.lookAt(this.look);
  }
}

function dampVec(cur: THREE.Vector3, target: THREE.Vector3, lambda: number, dt: number): void {
  cur.x = THREE.MathUtils.damp(cur.x, target.x, lambda, dt);
  cur.y = THREE.MathUtils.damp(cur.y, target.y, lambda, dt);
  cur.z = THREE.MathUtils.damp(cur.z, target.z, lambda, dt);
}
