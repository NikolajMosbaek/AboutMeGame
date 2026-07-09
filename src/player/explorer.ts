import * as THREE from "three";
import type { System, FrameContext } from "../engine/types.ts";
import type { Terrain } from "../world/terrain.ts";
import type { Boundaries } from "../world/boundaries.ts";
import type { PlayerInputSnapshot } from "./input.ts";
import type { GameSession } from "../gameSession.ts";
import { WORLD } from "../world/worldConfig.ts";

export interface ExplorerState {
  /** Kept as a literal so downstream readers (HUD, audio) can switch on it if a
   *  future slice adds e.g. swimming; today it is always "walk". */
  mode: "walk";
  /** Feet position on the ground (camera adds eye height). */
  position: THREE.Vector3;
  /** Unit look direction including pitch (nav projection, interactions). */
  nose: THREE.Vector3;
  /** Horizontal speed actually moved this frame, m/s. */
  speed: number;
  /** Look yaw, radians (0 = +Z, increases turning right). */
  yaw: number;
  /** Look pitch, radians (positive = looking up, clamped). */
  pitch: number;
  /** Sprinting right now (moving + sprint held). */
  sprinting: boolean;
  /** Standing in shallow water (slows movement; audio/FX read it too). */
  wading: boolean;
}

export const TUNE = {
  walkSpeed: 4.2,
  sprintSpeed: 7.0,
  /** Exponential damping rate for speed changes (feels planted, not instant). */
  accelLambda: 9,
  /** Eye height above the feet — the first-person camera reads this. */
  eyeHeight: 1.7,
  /** Pitch clamp: just short of straight up/down so the view never flips. */
  maxPitch: 1.45,
  /** Uphill grade (rise/run) where climbing starts to slow you. */
  slopeSlowGrade: 0.45,
  /** Uphill grade that blocks ascent entirely (~45°). */
  slopeBlockGrade: 1.0,
  /** Water deeper than this slows you to a wade. */
  wadeDepth: 0.35,
  /** Water deeper than this can't be entered (no swimming in v1). */
  maxWadeDepth: 1.2,
  /** Wading speed multiplier. */
  wadeFactor: 0.55,
} as const;

/**
 * The explorer (pivot slice B) — a first-person on-foot controller replacing the
 * old hover-craft. Walks the terrain height field with eye-height handled by the
 * camera system; sprint is a held modifier; look comes in as accumulated radians
 * from the input layer (mouse/touch/gamepad agnostic). Uphill grades beyond
 * `slopeBlockGrade` refuse the step (you can't scale cliffs), water deeper than
 * `maxWadeDepth` refuses it too (the jungle river is a real obstacle), and
 * `boundaries.clampToBounds` keeps the player on the island. While the session
 * is paused the controller drains the look/interact edges and holds still, so a
 * panel opened mid-stride doesn't spin the camera on resume.
 *
 * No visible body: first person needs none, so nothing is added to the scene.
 */
export class ExplorerSystem implements System {
  readonly id = "explorer";

  private readonly pos = new THREE.Vector3();
  private yaw: number;
  private pitch = 0;
  private speed = 0;
  private sprinting = false;
  private wading = false;
  private readonly nose = new THREE.Vector3(0, 0, 1);
  private readonly wish = new THREE.Vector3();

  constructor(
    private readonly input: PlayerInputSnapshot,
    private readonly terrain: Terrain,
    private readonly boundaries: Boundaries,
    spawn: { x: number; z: number; yaw?: number } = { x: 0, z: 0 },
    private readonly session?: GameSession,
  ) {
    this.yaw = spawn.yaw ?? 0;
    this.pos.set(spawn.x, terrain.heightAt(spawn.x, spawn.z), spawn.z);
    this.updateNose();
  }

  get state(): ExplorerState {
    return {
      mode: "walk",
      position: this.pos.clone(),
      nose: this.nose.clone(),
      speed: this.speed,
      yaw: this.yaw,
      pitch: this.pitch,
      sprinting: this.sprinting,
      wading: this.wading,
    };
  }

  update(ctx: FrameContext): void {
    if (this.session?.paused) {
      // Hold still and drain accumulated look so a drag/flick behind a panel
      // doesn't snap the view when it closes. (Interact is drained by the
      // discovery/quest system, which owns that edge.)
      this.input.consumeLook();
      this.speed = 0;
      this.sprinting = false;
      return;
    }

    // Look first, so movement this frame follows where you now face.
    const look = this.input.consumeLook();
    this.yaw += look.dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch - look.dy, -TUNE.maxPitch, TUNE.maxPitch);
    this.updateNose();

    const c = this.input.state;
    const moving = Math.abs(c.moveX) > 0.01 || Math.abs(c.moveZ) > 0.01;
    this.sprinting = moving && c.sprint;

    // Wish direction in the ground plane, relative to yaw. `sin/cos(yaw)` is the
    // forward the camera faces (see updateNose); strafe is its perpendicular.
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    this.wish.set(fx * c.moveZ + fz * c.moveX, 0, fz * c.moveZ - fx * c.moveX);
    if (this.wish.lengthSq() > 1) this.wish.normalize();

    const target = moving ? (this.sprinting ? TUNE.sprintSpeed : TUNE.walkSpeed) : 0;
    this.speed = THREE.MathUtils.damp(this.speed, target, TUNE.accelLambda, ctx.dt);

    if (this.speed > 0.01 && this.wish.lengthSq() > 1e-6) {
      const step = this.wish.clone().multiplyScalar(this.speed * ctx.dt);
      const here = this.terrain.heightAt(this.pos.x, this.pos.z);
      const nx = this.pos.x + step.x;
      const nz = this.pos.z + step.z;
      const there = this.terrain.heightAt(nx, nz);

      // Uphill grade check over the actual step length.
      const run = Math.hypot(step.x, step.z);
      const grade = run > 1e-6 ? (there - here) / run : 0;

      // Water depth at the destination (sea level is the drinkable surface).
      const depth = WORLD.seaLevel - there;

      if (grade >= TUNE.slopeBlockGrade || depth > TUNE.maxWadeDepth) {
        // Refused step: too steep or too deep. Bleed speed so it feels like a
        // real obstacle rather than a wall of glass you slide along at full run.
        this.speed = THREE.MathUtils.damp(this.speed, 0, 12, ctx.dt);
        this.wading = depth > TUNE.wadeDepth && depth <= TUNE.maxWadeDepth;
      } else {
        let factor = 1;
        if (grade > TUNE.slopeSlowGrade) {
          factor *= 1 - 0.7 * Math.min(1, (grade - TUNE.slopeSlowGrade) / (TUNE.slopeBlockGrade - TUNE.slopeSlowGrade));
        }
        this.wading = depth > TUNE.wadeDepth;
        if (this.wading) factor *= TUNE.wadeFactor;
        this.pos.x += step.x * factor;
        this.pos.z += step.z * factor;
      }
    } else if (this.speed <= 0.01) {
      const here = this.terrain.heightAt(this.pos.x, this.pos.z);
      this.wading = WORLD.seaLevel - here > TUNE.wadeDepth;
    }

    this.boundaries.clampToBounds(this.pos);
    this.pos.y = this.terrain.heightAt(this.pos.x, this.pos.z);
  }

  private updateNose(): void {
    const cp = Math.cos(this.pitch);
    this.nose.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
  }

  describe(): Record<string, unknown> {
    return {
      pos: [Math.round(this.pos.x), Math.round(this.pos.z)],
      speed: Math.round(this.speed * 10) / 10,
      sprinting: this.sprinting,
      wading: this.wading,
    };
  }
}
