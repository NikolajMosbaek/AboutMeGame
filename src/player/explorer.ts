import * as THREE from "three";
import type { System, FrameContext } from "../engine/types.ts";
import type { Terrain } from "../world/terrain.ts";
import type { Boundaries } from "../world/boundaries.ts";
import type { PlayerInputSnapshot, MoveState } from "./input.ts";
import type { GameSession } from "../gameSession.ts";
import type { SwimZones } from "../world/waterZones.ts";
import { NO_COLLISION, type CollisionField } from "../world/collision.ts";

/** Still water depth at a ground point, metres (`<= 0` means dry land). The
 *  world owns the definition of "water" (`World.waterDepthAt`); the explorer
 *  only asks how deep it is where it wants to step. */
export type WaterDepthAt = (x: number, z: number) => number;

export interface ExplorerState {
  /** Feet position on the ground — or the body's centre while swimming, where
   *  `position.y` floats free of the terrain (camera adds the mode's eye
   *  height). Valid for the current frame only — the snapshot object and its
   *  vector are reused, so copy anything you keep across frames. */
  position: THREE.Vector3;
  /** Speed actually moved this frame, m/s. */
  speed: number;
  /** Look yaw, radians — 0 faces +Z, increasing yaw turns LEFT (CCW from
   *  above, the mathematical direction); see {@link forwardXZFromYaw}. */
  yaw: number;
  /** Look pitch, radians (positive = looking up, clamped). */
  pitch: number;
  /** Sprinting right now (moving + sprint held) — sprint-swim while in water. */
  sprinting: boolean;
  /** Standing in shallow water (slows movement; audio/FX read it too). */
  wading: boolean;
  /** On foot, or free-floating in deep water (swimming, #184). */
  mode: "walk" | "swim";
  /** The eye is below the water surface (breath drains; underwater FX show). */
  submerged: boolean;
  /** Deep river water has you: the current forces you downstream and your own
   *  strokes work at reduced effect (survival drains stamina hard on this). */
  gripped: boolean;
}

export const TUNE = {
  walkSpeed: 4.2,
  sprintSpeed: 7.0,
  /** Exponential damping rate for speed changes (feels planted, not instant). */
  accelLambda: 9,
  /** Eye height above the feet — the first-person camera reads this. */
  eyeHeight: 1.7,
  /** The player's body radius for solid-prop collision (metres). Small, so
   *  dense jungle reads as something you weave through, not a wall. */
  playerRadius: 0.35,
  /** Pitch clamp: just short of straight up/down so the view never flips. */
  maxPitch: 1.45,
  /** Uphill grade (rise/run) where climbing starts to slow you. */
  slopeSlowGrade: 0.45,
  /** Uphill grade that blocks ascent entirely (~45°). */
  slopeBlockGrade: 1.0,
  /** Water deeper than this slows you to a wade. */
  wadeDepth: 0.35,
  /** Water deeper than this can't be waded — swimmable zones transition to a
   *  swim here; everywhere else (open sea) the step is still refused. */
  maxWadeDepth: 1.2,
  /** Wading speed multiplier. */
  wadeFactor: 0.55,
  // --- Swimming (#184) ---
  /** Cruise swim speed, m/s (along the LOOK direction, pitch included). */
  swimSpeed: 2.6,
  /** Sprint-swim speed, m/s (stamina-gated like the sprint on land). */
  sprintSwimSpeed: 3.4,
  /** Swim exits back to a walk only below this depth — hysteresis against
   *  maxWadeDepth so the walk↔swim seam can't chatter at the drop-off. */
  swimExitDepth: 0.9,
  /** Swimming eye height above `position.y` — a surfaced head rides just
   *  above the waterline (camera + submerged test both read this). */
  swimEyeHeight: 0.45,
  /** The float ceiling: the body rides this far below the water surface. */
  swimSurfaceOffset: 0.15,
  /** The dive floor: never closer to the bed than this. */
  swimBedClearance: 0.4,
  /** Gentle buoyant drift upward when no vertical input is given, m/s. */
  buoyancyRise: 0.4,
  /** Space: steady rise rate, m/s. */
  riseSpeed: 1.5,
  /** The river current's downstream push in deep channel water, m/s. */
  currentSpeed: 4.5,
  /** Your own strokes' effectiveness while the current has you. */
  currentInputFactor: 0.4,
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
 * `slopeBlockGrade` refuse the step (you can't scale cliffs), and
 * `boundaries.clampToBounds` keeps the player on the island. While the session
 * is paused the controller drains the look/interact edges and holds still, so a
 * panel opened mid-stride doesn't spin the camera on resume.
 *
 * Water (#184): shallow water wades as before, but past `maxWadeDepth` the
 * injected {@link SwimZones} decide what deep water means. In the calm lagoon
 * you transition to a free swim — movement follows the LOOK direction (nose
 * down + forward = dive), Space rises steadily, buoyancy drifts you up when
 * idle, and `position.y` floats between the bed clearance and the surface. In
 * the river channel deep water GRIPS instead: the current forces you along the
 * downstream flow while your own strokes work at `currentInputFactor`, until
 * the channel meets the lagoon zone or you reach wade-depth ground. Outside
 * both zones (the open sea) deep water refuses the step exactly as before.
 * Surfacing + swimming shoreward always works — swimming never traps.
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
  private mode: "walk" | "swim" = "walk";
  private submerged = false;
  private gripped = false;
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
    mode: "walk",
    submerged: false,
    gripped: false,
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
    /** Where deep water swims vs grips (buildPlayer injects the worldConfig
     *  zones). Absent = deep water refuses everywhere — the pre-#184 rule,
     *  which is also the right default for zone-less unit tests. */
    private readonly zones: SwimZones = { inLagoon: () => false, riverFlowAt: () => null },
    /** Solid props to slide out of (buildPlayer injects `world.collisionField`).
     *  Absent = nothing collides — the right default for zone-less unit tests. */
    private readonly collision: CollisionField = NO_COLLISION,
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
    this.mode = "walk";
    this.submerged = false;
    this.gripped = false;
  }

  get state(): ExplorerState {
    const s = this.snapshot;
    s.position.copy(this.pos);
    s.speed = this.speed;
    s.yaw = this.yaw;
    s.pitch = this.pitch;
    s.sprinting = this.sprinting;
    s.wading = this.wading;
    s.mode = this.mode;
    s.submerged = this.submerged;
    s.gripped = this.gripped;
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

    if (this.mode === "swim") this.updateSwim(ctx, c, moving);
    else this.updateWalk(ctx, c, moving);

    this.boundaries.clampToBounds(this.pos);
    if (this.mode === "walk") {
      this.pos.y = this.terrain.heightAt(this.pos.x, this.pos.z);
      this.submerged = false;
      this.gripped = false;
    } else {
      // Free-floating: clamp between the bed clearance and the float ceiling
      // (re-applied after the bounds clamp may have moved x/z).
      const bed = this.terrain.heightAt(this.pos.x, this.pos.z);
      const top = this.surfaceYAt(this.pos.x, this.pos.z) - TUNE.swimSurfaceOffset;
      this.pos.y = Math.min(top, Math.max(this.pos.y, Math.min(bed + TUNE.swimBedClearance, top)));
      this.submerged = this.pos.y + TUNE.swimEyeHeight < this.surfaceYAt(this.pos.x, this.pos.z);
    }
  }

  /** The water surface height over (x, z) — bed + still-water depth. Derived
   *  from the injected seams (never a WORLD import), so tests own the level. */
  private surfaceYAt(x: number, z: number): number {
    return this.terrain.heightAt(x, z) + this.waterDepthAt(x, z);
  }

  private updateWalk(ctx: FrameContext, c: MoveState, moving: boolean): void {
    // Already in over your head (spawned there, or the ground fell away):
    // deep swimmable water starts the swim without needing a step.
    const depthHere = this.waterDepthAt(this.pos.x, this.pos.z);
    if (depthHere > TUNE.maxWadeDepth && this.swimmableAt(this.pos.x, this.pos.z)) {
      this.enterSwim(this.pos.x, this.pos.z);
      return;
    }

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

      if (depth > TUNE.maxWadeDepth && this.swimmableAt(nx, nz)) {
        // Wading out past your depth in a swimmable zone: the step becomes
        // the first stroke instead of a refusal.
        this.pos.x = nx;
        this.pos.z = nz;
        this.enterSwim(nx, nz);
      } else if (grade >= TUNE.slopeBlockGrade || depth > TUNE.maxWadeDepth) {
        // Refused step: too steep, or deep non-swimmable water (the open
        // sea) — a hard stop. (A damp here equilibrates against the accel
        // damp above at ~1.6 m/s, leaving the HUD reading speed and the
        // camera bobbing while pinned in place.) Wading reflects where the
        // player IS, not the refused destination.
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

    // Solid-prop collision: after the step is committed, slide out of any trunk
    // or boulder it entered. A no-op field (tests/previews) and clear ground
    // both leave the position untouched; a glancing approach keeps its tangential
    // motion, so dense jungle reads as something you weave through, not a wall.
    // Skipped if the step just became a swim. The push is REFUSED if it would
    // eject into deep un-wadeable water or up a blocked slope — better to graze a
    // trunk than be shoved into the sea or a cliff (rare: colliders are on-land).
    if (this.mode === "walk") {
      const r = this.collision.resolve(this.pos.x, this.pos.z, TUNE.playerRadius);
      if (r.x !== this.pos.x || r.z !== this.pos.z) {
        const run = Math.hypot(r.x - this.pos.x, r.z - this.pos.z);
        const rise = this.terrain.heightAt(r.x, r.z) - this.terrain.heightAt(this.pos.x, this.pos.z);
        const grade = run > 1e-6 ? rise / run : 0;
        if (this.waterDepthAt(r.x, r.z) <= TUNE.maxWadeDepth && grade < TUNE.slopeBlockGrade) {
          this.pos.x = r.x;
          this.pos.z = r.z;
        }
      }
    }
  }

  private swimmableAt(x: number, z: number): boolean {
    return this.zones.inLagoon(x, z) || this.zones.riverFlowAt(x, z) !== null;
  }

  /** Cross the walk→swim seam: start floating at the surface (you waded in,
   *  so the head is above water until you choose to dive). */
  private enterSwim(x: number, z: number): void {
    this.mode = "swim";
    this.wading = false;
    this.pos.y = this.surfaceYAt(x, z) - TUNE.swimSurfaceOffset;
  }

  private updateSwim(ctx: FrameContext, c: MoveState, moving: boolean): void {
    const depthHere = this.waterDepthAt(this.pos.x, this.pos.z);
    const flow = this.zones.riverFlowAt(this.pos.x, this.pos.z);
    this.gripped = flow !== null;

    // Exit back to a walk: the calm exit waits for the hysteresis depth so
    // the seam can't chatter at the drop-off; the river's grip releases the
    // moment you reach wade-depth ground (steered to a bank or a ford).
    const exitDepth = this.gripped ? TUNE.maxWadeDepth : TUNE.swimExitDepth;
    if (depthHere < exitDepth) {
      this.mode = "walk";
      this.gripped = false;
      this.wading = depthHere > TUNE.wadeDepth;
      return; // the caller's walk branch snaps y back to the terrain
    }

    // Wish along the LOOK direction: pitch carries into the stroke (nose
    // down + forward = dive); strafe stays horizontal.
    const cp = Math.cos(this.pitch);
    const fwd = forwardXZFromYaw(this.yaw);
    const right = rightXZFromYaw(this.yaw);
    this.wish.set(
      fwd.x * cp * c.moveZ + right.x * c.moveX,
      Math.sin(this.pitch) * c.moveZ,
      fwd.z * cp * c.moveZ + right.z * c.moveX,
    );
    if (this.wish.lengthSq() > 1) this.wish.normalize();

    const target = moving ? (this.sprinting ? TUNE.sprintSwimSpeed : TUNE.swimSpeed) : 0;
    this.speed = THREE.MathUtils.damp(this.speed, target, TUNE.accelLambda, ctx.dt);

    // Own strokes — at reduced effect while the current has you.
    const eff = (this.gripped ? TUNE.currentInputFactor : 1) * this.speed * ctx.dt;
    let dx = this.wish.x * eff;
    let dy = this.wish.y * eff;
    const dzOwn = this.wish.z * eff;
    let dz = dzOwn;

    // Vertical assists: Space rises steadily; with no vertical input at all,
    // gentle buoyancy drifts you toward a surface float.
    if (c.rise) dy += TUNE.riseSpeed * ctx.dt;
    else if (Math.abs(this.wish.y) * this.speed < 0.05) dy += TUNE.buoyancyRise * ctx.dt;

    // The river's push, full-strength and un-fightable at 100%.
    if (flow) {
      dx += flow.x * TUNE.currentSpeed * ctx.dt;
      dz += flow.z * TUNE.currentSpeed * ctx.dt;
    }

    // You can't swim up a wall: refuse the horizontal step if the ground
    // there stands above your head (banks are exits only where they ramp).
    const nx = this.pos.x + dx;
    const nz = this.pos.z + dz;
    if (this.terrain.heightAt(nx, nz) <= this.pos.y + 0.6) {
      this.pos.x = nx;
      this.pos.z = nz;
    }
    this.pos.y += dy;
    this.wading = false;
  }

  describe(): Record<string, unknown> {
    return {
      pos: [Math.round(this.pos.x), Math.round(this.pos.z)],
      speed: Math.round(this.speed * 10) / 10,
      sprinting: this.sprinting,
      wading: this.wading,
      mode: this.mode,
      submerged: this.submerged,
      gripped: this.gripped,
    };
  }
}
