import * as THREE from "three";
import type { System, FrameContext } from "../engine/types.ts";
import type { Terrain } from "../world/terrain.ts";
import type { Boundaries } from "../world/boundaries.ts";
import type { ControlState, InputSnapshot } from "./input.ts";
import type { GameSession } from "../gameSession.ts";

export type DriveMode = "drive" | "fly";

export interface VehicleState {
  mode: DriveMode;
  position: THREE.Vector3;
  /** Unit heading the nose points along (XZ for HUD compass / nav hints). */
  nose: THREE.Vector3;
  speed: number;
  altitude: number; // height above the ground directly below
}

const TUNE = {
  // Drive
  driveMax: 54,
  driveBoost: 92,
  driveAccelLambda: 2.0, // how quickly speed eases toward its target
  reverseFactor: 0.4, // reverse tops out at 40% of forward speed
  steerRate: 1.9, // rad/s at full lock
  rideHeight: 1.4,
  // Fly
  flyCruise: 46,
  flyBoost: 84,
  pitchRate: 1.2,
  maxPitch: 0.9,
  rollRate: 2.4,
  maxBank: 0.8,
  yawFromBank: 1.5,
  climbRate: 26,
  flyCeiling: 240,
  flyFloorClearance: 4,
  // shared
  levelLerp: 2.5, // auto-leveling toward neutral when no input
};

const BASE_FORWARD = new THREE.Vector3(0, 0, 1);

/**
 * The player's hover-craft (issues #23–#28). One vehicle, two control modes on a
 * real physics boundary — grounded driving and free flight — toggled with F.
 * Drive mode hugs the terrain via `terrain.heightAt` and tilts to the slope;
 * fly mode is arcade 6-DOF-ish with banked turns and a ground/ceiling clamp.
 * Both stay inside the world via `boundaries.clampToBounds`. Exposes
 * `VehicleState` so the camera (this epic) and discovery/HUD (Epics 4–5) follow.
 */
export class VehicleSystem implements System {
  readonly id = "vehicle";
  readonly object: THREE.Group;

  private mode: DriveMode = "drive";
  private readonly pos = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private roll = 0;
  private driveSpeed = 0;
  private readonly nose = new THREE.Vector3(0, 0, 1);
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private disposables: Array<{ dispose(): void }> = [];

  constructor(
    private readonly input: InputSnapshot,
    private readonly terrain: Terrain,
    private readonly boundaries: Boundaries,
    spawn: { x: number; z: number; yaw?: number } = { x: 0, z: 0 },
    private readonly session?: GameSession,
  ) {
    this.object = buildCraft(this.disposables);
    this.yaw = spawn.yaw ?? 0;
    this.pos.set(spawn.x, terrain.heightAt(spawn.x, spawn.z) + TUNE.rideHeight, spawn.z);
    this.object.position.copy(this.pos);
  }

  get state(): VehicleState {
    const ground = this.terrain.heightAt(this.pos.x, this.pos.z);
    return {
      mode: this.mode,
      position: this.pos.clone(),
      nose: this.nose.clone(),
      speed: this.mode === "drive" ? this.driveSpeed : this.vel.length(),
      altitude: this.pos.y - ground,
    };
  }

  update(ctx: FrameContext): void {
    // Hold still while a reveal panel / menu is open.
    if (this.session?.paused) return;
    if (this.input.consumeToggleMode()) this.toggleMode();
    if (this.mode === "drive") this.updateDrive(ctx.dt, this.input.state);
    else this.updateFly(ctx.dt, this.input.state);

    // Keep the player on the map (horizontal only; height handled per-mode).
    this.boundaries.clampToBounds(this.pos);
    // If the bounds clamp slid us over higher terrain, re-seat above the ground
    // so neither mode dips below it for a frame at the world edge.
    if (this.mode === "fly") {
      const floor = this.terrain.heightAt(this.pos.x, this.pos.z) + TUNE.flyFloorClearance;
      if (this.pos.y < floor) this.pos.y = floor;
    } else {
      this.pos.y = this.terrain.heightAt(this.pos.x, this.pos.z) + TUNE.rideHeight;
    }
    this.object.position.copy(this.pos);
    this.nose.copy(BASE_FORWARD).applyQuaternion(this.object.quaternion);
  }

  private toggleMode(): void {
    if (this.mode === "drive") {
      this.mode = "fly";
      // Seed velocity and start with a gentle climb so lift-off feels smooth.
      // (Flight re-derives velocity from the nose each frame; this just avoids a
      // one-frame stall on the transition.)
      this.vel.copy(this.nose).multiplyScalar(Math.max(this.driveSpeed, TUNE.flyCruise * 0.6));
      this.pitch = 0.15;
    } else {
      this.mode = "drive";
      this.driveSpeed = THREE.MathUtils.clamp(this.vel.length(), 0, TUNE.driveMax);
      this.pitch = 0;
      this.roll = 0;
    }
  }

  private updateDrive(dt: number, c: ControlState): void {
    const max = c.boost ? TUNE.driveBoost : TUNE.driveMax;
    // Ease speed toward the commanded target (forward holds → reach `max`;
    // release → coast to a stop). Reverse tops out slower than forward.
    const target = c.forward >= 0 ? c.forward * max : c.forward * max * TUNE.reverseFactor;
    this.driveSpeed = THREE.MathUtils.damp(this.driveSpeed, target, TUNE.driveAccelLambda, dt);

    // Steering scales with how fast you're going; reverses when backing up.
    const speedFactor = THREE.MathUtils.clamp(Math.abs(this.driveSpeed) / 12, 0, 1);
    this.yaw -= c.turn * TUNE.steerRate * dt * speedFactor * Math.sign(this.driveSpeed || 1);

    // Advance along the heading, then snap to the ground.
    this.euler.set(0, this.yaw, 0, "YXZ");
    this.object.quaternion.setFromEuler(this.euler);
    const fwd = BASE_FORWARD.clone().applyQuaternion(this.object.quaternion);
    this.pos.addScaledVector(fwd, this.driveSpeed * dt);

    const ground = this.terrain.heightAt(this.pos.x, this.pos.z);
    this.pos.y = ground + TUNE.rideHeight;

    // Tilt the chassis to the terrain slope for a planted feel.
    const e = 2;
    const slopePitch = (this.terrain.heightAt(this.pos.x + fwd.x * e, this.pos.z + fwd.z * e) - ground) / e;
    const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const slopeRoll = (this.terrain.heightAt(this.pos.x + right.x * e, this.pos.z + right.z * e) - ground) / e;
    this.pitch = THREE.MathUtils.damp(this.pitch, -slopePitch, 6, dt);
    this.roll = THREE.MathUtils.damp(this.roll, slopeRoll, 6, dt);
    this.euler.set(this.pitch, this.yaw, this.roll, "YXZ");
    this.object.quaternion.setFromEuler(this.euler);
  }

  private updateFly(dt: number, c: ControlState): void {
    // Pitch from forward; auto-level toward neutral when released.
    this.pitch += c.forward * TUNE.pitchRate * dt;
    if (Math.abs(c.forward) < 0.05)
      this.pitch = THREE.MathUtils.damp(this.pitch, 0, TUNE.levelLerp, dt);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -TUNE.maxPitch, TUNE.maxPitch);

    // Bank from turn; banking yaws you (plus a touch of direct yaw).
    const targetBank = -c.turn * TUNE.maxBank;
    this.roll = THREE.MathUtils.damp(this.roll, targetBank, TUNE.rollRate, dt);
    this.yaw += Math.sin(this.roll) * TUNE.yawFromBank * dt;

    this.euler.set(this.pitch, this.yaw, this.roll, "YXZ");
    this.object.quaternion.setFromEuler(this.euler);

    const speed = c.boost ? TUNE.flyBoost : TUNE.flyCruise;
    const nose = BASE_FORWARD.clone().applyQuaternion(this.object.quaternion);
    this.vel.copy(nose).multiplyScalar(speed);
    this.vel.y += c.thrust * TUNE.climbRate; // Space adds extra lift
    this.pos.addScaledVector(this.vel, dt);

    // Don't fly through the ground or off into space.
    const floor = this.terrain.heightAt(this.pos.x, this.pos.z) + TUNE.flyFloorClearance;
    if (this.pos.y < floor) {
      this.pos.y = floor;
      if (this.pitch < 0) this.pitch = THREE.MathUtils.damp(this.pitch, 0, 8, dt);
    }
    if (this.pos.y > TUNE.flyCeiling) this.pos.y = TUNE.flyCeiling;
  }

  describe(): Record<string, unknown> {
    const s = this.state;
    return {
      mode: s.mode,
      speed: Math.round(s.speed),
      altitude: Math.round(s.altitude),
      pos: [Math.round(s.position.x), Math.round(s.position.z)],
    };
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

/** A small low-poly hover-craft: body, canopy, stub wings, and an underglow. */
function buildCraft(disposables: Array<{ dispose(): void }>): THREE.Group {
  const g = new THREE.Group();
  g.name = "vehicle";
  const track = <T extends { dispose(): void }>(x: T): T => (disposables.push(x), x);

  const bodyMat = track(new THREE.MeshStandardMaterial({ color: 0xe8edf2, flatShading: true, roughness: 0.5, metalness: 0.2 }));
  const accentMat = track(new THREE.MeshStandardMaterial({ color: 0xffcb47, flatShading: true, roughness: 0.4 }));
  const glassMat = track(new THREE.MeshStandardMaterial({ color: 0x2a3550, flatShading: true, roughness: 0.1, metalness: 0.6 }));

  const body = new THREE.Mesh(track(new THREE.BoxGeometry(2.2, 0.8, 3.6)), bodyMat);
  body.position.y = 0.6;
  const nose = new THREE.Mesh(track(new THREE.ConeGeometry(0.9, 1.6, 4)), bodyMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.6, 2.4);
  const canopy = new THREE.Mesh(track(new THREE.SphereGeometry(0.7, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2)), glassMat);
  canopy.position.set(0, 1.0, 0.3);
  canopy.scale.set(1, 0.8, 1.4);
  const wingGeo = track(new THREE.BoxGeometry(1.6, 0.18, 1.2));
  const wingL = new THREE.Mesh(wingGeo, accentMat);
  wingL.position.set(-1.7, 0.55, -0.6);
  const wingR = new THREE.Mesh(wingGeo, accentMat);
  wingR.position.set(1.7, 0.55, -0.6);
  const glow = new THREE.Mesh(
    track(new THREE.BoxGeometry(2.0, 0.12, 3.0)),
    track(new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.6 })),
  );
  glow.position.y = 0.12;

  for (const m of [body, nose, canopy, wingL, wingR]) {
    m.castShadow = true;
  }
  g.add(body, nose, canopy, wingL, wingR, glow);
  return g;
}
