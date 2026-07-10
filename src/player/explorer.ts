import * as THREE from "three";
import type { System, FrameContext } from "../engine/types.ts";
import type { Terrain } from "../world/terrain.ts";
import type { Boundaries } from "../world/boundaries.ts";
import type { PlayerInputSnapshot } from "./input.ts";
import type { GameSession } from "../gameSession.ts";

/** Still water depth at a ground point, metres (`<= 0` means dry land). The
 *  world owns the definition of "water" (`World.waterDepthAt`); the explorer
 *  only asks how deep it is where it wants to step. */
export type WaterDepthAt = (x: number, z: number) => number;

export interface ExplorerState {
  /** Feet position on the ground (camera adds eye height). Valid for the
   *  current frame only — the snapshot object and its vector are reused, so
   *  copy anything you keep across frames. */
  position: THREE.Vector3;
  /** Horizontal speed actually moved this frame, m/s. */
  speed: number;
  /** Look yaw, radians — 0 faces +Z, increasing yaw turns LEFT (CCW from
   *  above, the mathematical direction); see {@link forwardXZFromYaw}. */
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

// ---------------------------------------------------------------------------
// The yaw convention, in ONE place. Explorer yaw 0 faces +Z; yaw increases
// COUNTER-clockwise from above (the mathematical direction), i.e. a LEFT turn
// from the player's seat — device "turn right" deltas are subtracted. Every
// consumer derives from these helpers instead of re-deriving the trigonometry —
// getting a sign wrong by hand mirrors the world silently (both the camera and
// the strafe did, once each, in review).

/** Ground forward for a yaw: unit XZ direction the explorer walks along. */
export function forwardXZFromYaw(yaw: number): { x: number; z: number } {
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

/** The camera's screen-right for a yaw: forward × up = (-fz, fx). Getting this
 *  by hand is how the east/west mirror shipped once — always derive from here. */
export function rightXZFromYaw(yaw: number): { x: number; z: number } {
  return { x: -Math.cos(yaw), z: Math.sin(yaw) };
}

/** Three.js camera euler-Y for a yaw: a camera looks down -Z at identity, so
 *  R_y(yaw + π)·(0,0,-1) equals the explorer's forward (π − yaw would mirror). */
export function cameraEulerYFromYaw(yaw: number): number {
  return yaw + Math.PI;
}

/** Compass heading in degrees, 0..360, for a yaw. The compass calls -Z "N"
 *  (the spawn looks south down the island), so yaw 0 reads as S = 180°. */
export function compassDegFromYaw(yaw: number): number {
  const deg = 180 - (yaw * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

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
  private readonly wish = new THREE.Vector3();
  // Reused snapshot — four systems read `state` every frame; allocating here
  // would be the hottest garbage source in the loop (review, slice B).
  private readonly snapshot: ExplorerState = {
    position: new THREE.Vector3(),
    speed: 0,
    yaw: 0,
    pitch: 0,
    sprinting: false,
    wading: false,
  };

  constructor(
    private readonly input: PlayerInputSnapshot,
    private readonly terrain: Terrain,
    private readonly boundaries: Boundaries,
    private readonly waterDepthAt: WaterDepthAt,
    spawn: { x: number; z: number; yaw?: number } = { x: 0, z: 0 },
    private readonly session?: GameSession,
    /** Survival's sprint gate (stamina left?). Absent = always allowed. */
    private readonly canSprint?: () => boolean,
  ) {
    this.yaw = spawn.yaw ?? 0;
    this.pos.set(spawn.x, terrain.heightAt(spawn.x, spawn.z), spawn.z);
  }

  /** Teleport back to a spawn point (death → wake at camp). Zeroes motion and
   *  levels the view so waking reads as waking, not as mid-stride whiplash. */
  respawn(spawn: { x: number; z: number; yaw?: number }): void {
    this.pos.set(spawn.x, this.terrain.heightAt(spawn.x, spawn.z), spawn.z);
    this.yaw = spawn.yaw ?? this.yaw;
    this.pitch = 0;
    this.speed = 0;
    this.sprinting = false;
  }

  get state(): ExplorerState {
    const s = this.snapshot;
    s.position.copy(this.pos);
    s.speed = this.speed;
    s.yaw = this.yaw;
    s.pitch = this.pitch;
    s.sprinting = this.sprinting;
    s.wading = this.wading;
    return s;
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

    // Look first, so movement this frame follows where you now face. dx is
    // "turn right" from the device's seat; yaw is CCW-positive, so subtract
    // (screen-right of forward (sin,cos) is (-cos… ) — see forwardXZFromYaw's
    // companion rightXZFromYaw; the signs here and there must stay paired).
    const look = this.input.consumeLook();
    this.yaw -= look.dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch - look.dy, -TUNE.maxPitch, TUNE.maxPitch);

    const c = this.input.state;
    const moving = Math.abs(c.moveX) > 0.01 || Math.abs(c.moveZ) > 0.01;
    this.sprinting = moving && c.sprint && (this.canSprint?.() ?? true);

    // Wish direction in the ground plane: forward·moveZ + screen-right·moveX.
    const fwd = forwardXZFromYaw(this.yaw);
    const right = rightXZFromYaw(this.yaw);
    this.wish.set(fwd.x * c.moveZ + right.x * c.moveX, 0, fwd.z * c.moveZ + right.z * c.moveX);
    if (this.wish.lengthSq() > 1) this.wish.normalize();

    const target = moving ? (this.sprinting ? TUNE.sprintSpeed : TUNE.walkSpeed) : 0;
    this.speed = THREE.MathUtils.damp(this.speed, target, TUNE.accelLambda, ctx.dt);

    if (this.speed > 0.01 && this.wish.lengthSq() > 1e-6) {
      // Scale the wish into this frame's step in place (it's rebuilt next frame).
      this.wish.multiplyScalar(this.speed * ctx.dt);
      const here = this.terrain.heightAt(this.pos.x, this.pos.z);
      const nx = this.pos.x + this.wish.x;
      const nz = this.pos.z + this.wish.z;
      const there = this.terrain.heightAt(nx, nz);

      // Uphill grade check over the actual step length.
      const run = Math.hypot(this.wish.x, this.wish.z);
      const grade = run > 1e-6 ? (there - here) / run : 0;

      const depth = this.waterDepthAt(nx, nz);

      if (grade >= TUNE.slopeBlockGrade || depth > TUNE.maxWadeDepth) {
        // Refused step: too steep or too deep — a hard stop. (A damp here
        // equilibrates against the accel damp above at ~1.6 m/s, leaving the
        // HUD reading speed and the camera bobbing while pinned in place.)
        // Wading reflects where the player IS, not the refused destination.
        this.speed = 0;
        this.wading = this.waterDepthAt(this.pos.x, this.pos.z) > TUNE.wadeDepth;
      } else {
        let factor = 1;
        if (grade > TUNE.slopeSlowGrade) {
          factor *= 1 - 0.7 * Math.min(1, (grade - TUNE.slopeSlowGrade) / (TUNE.slopeBlockGrade - TUNE.slopeSlowGrade));
        }
        this.wading = depth > TUNE.wadeDepth;
        if (this.wading) factor *= TUNE.wadeFactor;
        this.pos.x += this.wish.x * factor;
        this.pos.z += this.wish.z * factor;
      }
    } else if (this.speed <= 0.01) {
      this.wading = this.waterDepthAt(this.pos.x, this.pos.z) > TUNE.wadeDepth;
    }

    this.boundaries.clampToBounds(this.pos);
    this.pos.y = this.terrain.heightAt(this.pos.x, this.pos.z);
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
