// Birds (pivot slice F, wildlife #184): 2 flocks of low-poly birds orbiting
// fixed waypoints over the valley canopy, scattering when the player closes
// in and regrouping once they've backed off. All the motion/state math is
// pure (this file, headless-tested); `BirdsSystem` only uploads it to two
// `InstancedMesh` draw calls (body + wings) — the GPU wiring stays trivial.

import * as THREE from "three";
import type { FrameContext, System } from "../engine/types.ts";
import type { Terrain } from "../world/terrain.ts";
import { stampVertexColor } from "./geometry.ts";

/** Where the player is — the explorer satisfies it via `state.position` (same
 *  shape `DiscoverySystem`/`SurvivalSystem` read). */
export interface PositionSource {
  readonly state: { position: THREE.Vector3 };
}

/** Hold all movement while true — the shared session pause flag satisfies it. */
export interface PauseSource {
  readonly paused: boolean;
}

export const FLOCK_COUNT = 2;
export const BIRDS_PER_FLOCK = 7;
export const TOTAL_BIRDS = FLOCK_COUNT * BIRDS_PER_FLOCK;

/**
 * Waypoint anchors over the valley canopy, picked clear of the river course
 * (`RIVER.points` runs roughly x ∈ [-20, 24] down the middle of the map — see
 * `world/worldConfig.ts`) and well outside the lagoon, so a flock never reads
 * as circling over open water. Only the first `FLOCK_COUNT` are used; a third
 * is kept in reserve for a future flock without touching this file.
 */
export const FLOCK_WAYPOINTS: ReadonlyArray<{ x: number; z: number }> = [
  { x: 60, z: -40 },
  { x: -62, z: 4 },
  { x: 46, z: 88 },
];

/** Flock scatters when the player closes to within this of its centre. */
export const ALERT_RADIUS = 18;
/** Base orbit radius/angular speed around the waypoint. */
export const ORBIT_RADIUS = 9;
export const ORBIT_SPEED = 0.35; // rad/s
/** Flight altitude above the ground at the waypoint (clears the canopy). */
export const CANOPY_CLEARANCE = 12;
/** Scatter is a committed startle: holds at least this long regardless of the
 *  player's distance, so a flock can't flicker in and out of alarm. */
export const SCATTER_MIN_DURATION = 3;
/** Glide back into formation over this long once the player has backed off. */
export const REGROUP_DURATION = 2;
/** Seconds to reach full scatter puff-out (climb + spread). */
export const SCATTER_CLIMB_TIME = 0.6;
export const SCATTER_SPREAD = 12;
export const SCATTER_CLIMB = 6;
export const FLAP_SPEED = 10;
export const FLAP_AMPLITUDE = 0.5;

export type FlockMode = "orbit" | "scatter" | "regroup";

export interface FlockState {
  mode: FlockMode;
  /** Seconds spent in the current mode (semantics per mode, see {@link stepFlock}). */
  timer: number;
}

export function initialFlockState(): FlockState {
  return { mode: "orbit", timer: 0 };
}

/**
 * Advance one flock's state machine by `dt` given the current horizontal
 * distance from the player to the flock's centre. Pure: same inputs, same
 * output, every time.
 *
 * `orbit` → `scatter` the instant the player closes inside {@link ALERT_RADIUS}.
 * `scatter` holds for at least {@link SCATTER_MIN_DURATION} even if the player
 * immediately backs off (a committed startle, not a flicker), then moves to
 * `regroup` once BOTH the minimum has elapsed AND the player is clear again.
 * `regroup` glides back to `orbit` over {@link REGROUP_DURATION} — unless the
 * player closes in again first, which restarts `scatter` at once.
 */
export function stepFlock(state: FlockState, dt: number, distToPlayer: number): FlockState {
  if (state.mode === "orbit") {
    return distToPlayer < ALERT_RADIUS ? { mode: "scatter", timer: 0 } : state;
  }
  if (state.mode === "scatter") {
    const timer = state.timer + dt;
    if (timer >= SCATTER_MIN_DURATION && distToPlayer >= ALERT_RADIUS) {
      return { mode: "regroup", timer: 0 };
    }
    return { mode: "scatter", timer };
  }
  // regroup
  if (distToPlayer < ALERT_RADIUS) return { mode: "scatter", timer: 0 };
  const timer = state.timer + dt;
  return timer >= REGROUP_DURATION ? { mode: "orbit", timer: 0 } : { mode: "regroup", timer };
}

/** 0 (tight orbit) .. 1 (fully scattered) puff-out factor for the current
 *  mode/timer — the one knob {@link birdPose} scales radius/height/flap by. */
export function scatterFactor(mode: FlockMode, timer: number): number {
  if (mode === "orbit") return 0;
  if (mode === "scatter") return Math.min(1, timer / SCATTER_CLIMB_TIME);
  return Math.max(0, 1 - timer / REGROUP_DURATION);
}

export interface BirdPose {
  x: number;
  y: number;
  z: number;
  /** Heading around the orbit (radians) — also the body's yaw. */
  yaw: number;
  /** Wing roll angle this instant (radians), oscillating with the flap. */
  flap: number;
}

/**
 * Pure position/orientation for one bird in a flock, given the flock's fixed
 * centre, its current scatter state and the system's own held clock (NOT
 * `ctx.elapsed` — see `BirdsSystem`). Every bird keeps orbiting continuously;
 * scatter/regroup only puffs the radius/height out and back, so the whole
 * flight path is one smooth function of (center, mode, timer, elapsed,
 * birdIndex) with no per-bird stored state — determinism and disposal-safety
 * fall out for free.
 */
export function birdPose(
  center: { x: number; y: number; z: number },
  mode: FlockMode,
  timer: number,
  elapsed: number,
  birdIndex: number,
): BirdPose {
  const angle = (birdIndex / BIRDS_PER_FLOCK) * Math.PI * 2 + elapsed * ORBIT_SPEED;
  const f = scatterFactor(mode, timer);
  const jitter = Math.sin(birdIndex * 1.7) * 1.4;
  const radius = ORBIT_RADIUS + jitter + f * SCATTER_SPREAD;
  const bob = Math.sin(elapsed * 1.3 + birdIndex * 0.8) * 0.6;
  const height = bob + f * SCATTER_CLIMB;
  const flapSpeed = FLAP_SPEED * (1 + f); // faster wingbeats while scattering
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + height,
    z: center.z + Math.sin(angle) * radius,
    yaw: angle + Math.PI / 2,
    flap: Math.sin(elapsed * flapSpeed + birdIndex * 0.9) * FLAP_AMPLITUDE,
  };
}

const BODY_COLOR = 0x241f1a;
const WING_COLOR = 0x322b23;

/** A two-triangle wing pair lying flat in the local XZ plane, spine at the
 *  local origin, tips swept back — instanced whole and "flapped" by rotating
 *  the per-instance matrix around the body's forward axis (a roll), the
 *  per-instance-rotation flap the wildlife spec calls for. */
function buildWingGeometry(): THREE.BufferGeometry {
  const span = 0.55;
  const sweep = 0.32;
  const positions = new Float32Array([
    0, 0, 0, span, 0, -sweep, 0.05, 0, 0.05,
    0, 0, 0, -0.05, 0, 0.05, -span, 0, -sweep,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

interface Flock {
  center: { x: number; y: number; z: number };
  state: FlockState;
}

/**
 * Two draw calls total (body + wings InstancedMesh), however many birds are
 * instanced — the wildlife budget's per-creature cap. Body/wing geometry is a
 * few triangles each (a low-poly silhouette, not a modelled bird), well inside
 * the ≤40k-triangle wildlife budget.
 */
export class BirdsSystem implements System {
  readonly id = "wildlife-birds";

  private readonly group = new THREE.Group();
  private readonly bodyGeo: THREE.BufferGeometry;
  private readonly wingGeo: THREE.BufferGeometry;
  private readonly bodyMat: THREE.MeshStandardMaterial;
  private readonly wingMat: THREE.MeshStandardMaterial;
  private readonly bodyMesh: THREE.InstancedMesh;
  private readonly wingMesh: THREE.InstancedMesh;
  private readonly flocks: Flock[];
  /** System-owned clock — NOT `ctx.elapsed` (mirrors `DayCycleSystem`): only
   *  advances while unpaused, so held birds resume exactly where they froze. */
  private elapsed = 0;

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly sc = new THREE.Vector3(1, 1, 1);
  private readonly posv = new THREE.Vector3();
  private readonly euler = new THREE.Euler();

  constructor(
    scene: THREE.Scene,
    terrain: Terrain,
    private readonly player: PositionSource,
    private readonly session: PauseSource,
  ) {
    this.group.name = "wildlife-birds";

    this.bodyGeo = stampVertexColor(
      new THREE.ConeGeometry(0.12, 0.55, 4).rotateX(Math.PI / 2),
      BODY_COLOR,
    );
    this.wingGeo = stampVertexColor(buildWingGeometry(), WING_COLOR);
    this.bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
    this.wingMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 1,
      side: THREE.DoubleSide,
    });
    this.bodyMesh = new THREE.InstancedMesh(this.bodyGeo, this.bodyMat, TOTAL_BIRDS);
    this.wingMesh = new THREE.InstancedMesh(this.wingGeo, this.wingMat, TOTAL_BIRDS);
    this.bodyMesh.name = "wildlife-bird-body";
    this.wingMesh.name = "wildlife-bird-wing";
    this.group.add(this.bodyMesh, this.wingMesh);
    scene.add(this.group);

    this.flocks = FLOCK_WAYPOINTS.slice(0, FLOCK_COUNT).map((wp) => ({
      center: { x: wp.x, y: terrain.heightAt(wp.x, wp.z) + CANOPY_CLEARANCE, z: wp.z },
      state: initialFlockState(),
    }));
  }

  update(ctx: FrameContext): void {
    if (this.session.paused) return; // hold all movement
    this.elapsed += ctx.dt;

    const p = this.player.state.position;
    let i = 0;
    for (const flock of this.flocks) {
      const dist = Math.hypot(p.x - flock.center.x, p.z - flock.center.z);
      flock.state = stepFlock(flock.state, ctx.dt, dist);

      for (let b = 0; b < BIRDS_PER_FLOCK; b++, i++) {
        const pose = birdPose(flock.center, flock.state.mode, flock.state.timer, this.elapsed, b);
        this.posv.set(pose.x, pose.y, pose.z);

        this.euler.set(0, pose.yaw, 0);
        this.q.setFromEuler(this.euler);
        this.m.compose(this.posv, this.q, this.sc);
        this.bodyMesh.setMatrixAt(i, this.m);

        this.euler.set(pose.flap, pose.yaw, 0);
        this.q.setFromEuler(this.euler);
        this.m.compose(this.posv, this.q, this.sc);
        this.wingMesh.setMatrixAt(i, this.m);
      }
    }
    this.bodyMesh.instanceMatrix.needsUpdate = true;
    this.wingMesh.instanceMatrix.needsUpdate = true;
  }

  /** Startle every flock into a fresh scatter at once — the treasure finale's
   *  "the whole jungle answers" beat (owner note, 2026-07-10). Reuses the
   *  exact scatter state a close player triggers, so the committed-startle
   *  minimum and regroup glide apply unchanged. */
  startle(): void {
    for (const flock of this.flocks) flock.state = { mode: "scatter", timer: 0 };
  }

  describe(): Record<string, unknown> {
    return { flocks: this.flocks.map((f) => f.state.mode) };
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    this.bodyMesh.dispose();
    this.wingMesh.dispose();
    this.bodyGeo.dispose();
    this.wingGeo.dispose();
    this.bodyMat.dispose();
    this.wingMat.dispose();
  }
}
