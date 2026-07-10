import * as THREE from "three";
import type { Engine } from "../engine/Engine.ts";
import type { System, FrameContext } from "../engine/types.ts";
import type { ExplorerSystem } from "./explorer.ts";
import { TUNE, cameraEulerYFromYaw, rightXZFromYaw } from "./explorer.ts";
import type { ReducedMotionSource } from "../world/buildWorld.ts";

/** Head-bob: vertical amplitude at full walk speed (metres). Sprint scales up. */
const BOB_AMP = 0.045;
/** Lateral sway is a fraction of the vertical bob. */
const BOB_SWAY = 0.5;
/** Stride frequency scale — bob cycles per metre travelled. */
const BOB_FREQ = 1.6;

/**
 * First-person camera (pivot slice B): eye at `TUNE.eyeHeight` above the feet,
 * oriented straight from the explorer's yaw/pitch (no smoothing — in first
 * person, lag between hand and view reads as swimmy). Immersion comes from the
 * head-bob: a distance-driven sine (so it tracks stride, not wall-clock) with a
 * touch of lateral sway, scaled by speed and zeroed under reduced motion.
 * Registered after the explorer so it reads the post-update state.
 */
export class FirstPersonCameraSystem implements System {
  readonly id = "camera";
  private bobDistance = 0;
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly right = new THREE.Vector3();

  constructor(
    private readonly engine: Engine,
    private readonly explorer: ExplorerSystem,
    private readonly motion?: ReducedMotionSource,
  ) {}

  update(ctx: FrameContext): void {
    const s = this.explorer.state;

    // Orientation from the one yaw convention (explorer.ts owns it); pitch
    // carries straight, positive = up.
    this.euler.set(s.pitch, cameraEulerYFromYaw(s.yaw), 0);
    this.engine.camera.quaternion.setFromEuler(this.euler);

    // Swimming (#184): the eye rides just above the body (a surfaced head sits
    // barely over the waterline), and the stride bob is off — there is no
    // stride in the water, and a bobbing waterline reads as nausea, not sea.
    const swimming = s.mode === "swim";
    const reduced = this.motion?.getSnapshot().reducedMotion ?? false;
    let bobY = 0;
    let sway = 0;
    if (!reduced && !swimming && s.speed > 0.1) {
      this.bobDistance += s.speed * ctx.dt;
      const phase = this.bobDistance * BOB_FREQ * Math.PI;
      const amp = BOB_AMP * Math.min(1.4, s.speed / TUNE.walkSpeed);
      bobY = Math.abs(Math.sin(phase)) * amp;
      sway = Math.sin(phase) * amp * BOB_SWAY;
    }

    // Screen-right from the one yaw convention (explorer.ts owns the signs).
    const right = rightXZFromYaw(s.yaw);
    this.right.set(right.x, 0, right.z);
    this.engine.camera.position
      .copy(s.position)
      .add(this.right.multiplyScalar(sway));
    this.engine.camera.position.y =
      s.position.y + (swimming ? TUNE.swimEyeHeight : TUNE.eyeHeight) + bobY;
  }

  describe(): Record<string, unknown> {
    const p = this.engine.camera.position;
    return { eye: [Math.round(p.x), Math.round(p.y * 10) / 10, Math.round(p.z)] };
  }
}
