// Fish (pivot slice F, wildlife #184): dark shadow shapes patrolling the
// lagoon and river pools, darting away when the player wades close — sells
// the water as alive. One draw call (a single InstancedMesh of flattened
// cones); the patrol/flee state machine is a pure step function so it is
// fully headless-testable (`stepFish`), and `FishSystem` only integrates it
// into instance matrices each frame.

import * as THREE from "three";
import type { FrameContext, System } from "../engine/types.ts";
import { LAGOON, RIVER, WORLD } from "../world/worldConfig.ts";
import { stampVertexColor } from "./geometry.ts";

/** Where the player is — the explorer satisfies it via `state.position`. */
export interface PositionSource {
  readonly state: { position: THREE.Vector3 };
}

/** Hold all movement while true — the shared session pause flag satisfies it. */
export interface PauseSource {
  readonly paused: boolean;
}

/** Still-water depth at a ground point, metres (`World.waterDepthAt` satisfies
 *  it) — the ONE definition of "where water is," reused rather than re-derived. */
export type WaterDepthAt = (x: number, z: number) => number;

export const FISH_COUNT = 12;
/** Only water at least this deep counts as a fish pool — matches the spec's
 *  "deeper than 0.8" and keeps fish off the shallow, wade-able banks. */
export const MIN_POOL_DEPTH = 0.8;
export const FLEE_RADIUS = 6;
export const FLEE_DURATION = 1.4;
export const FLEE_SPEED = 5.5;
export const PATROL_SPEED = 0.6;
export const PATROL_RADIUS = 3.5;
/** Fish swim just under the still-water plane — a constant offset below
 *  `WORLD.seaLevel`, not tied to the (carved, uneven) river bed. */
export const SWIM_DEPTH = 0.45;

export interface Pool {
  x: number;
  z: number;
}

/**
 * Candidate pool centres deep enough to hold fish: the lagoon plus every
 * river-course point (`RIVER.points`, the channel's own centreline, always at
 * full bed depth). Filtered live against `waterDepthAt` rather than hardcoded,
 * so a future reshape of the river/lagoon keeps this correct for free.
 */
export function selectPools(waterDepthAt: WaterDepthAt): Pool[] {
  const candidates: Pool[] = [{ x: LAGOON.x, z: LAGOON.z }, ...RIVER.points];
  return candidates.filter((p) => waterDepthAt(p.x, p.z) > MIN_POOL_DEPTH);
}

export type FishMode = "patrol" | "flee";

export interface FishState {
  x: number;
  z: number;
  mode: FishMode;
  /** Seconds spent fleeing (patrol mode keeps this at 0). */
  timer: number;
  /** Patrol wander heading, radians — drifts continuously while patrolling. */
  angle: number;
}

export function initialFishState(pool: Pool, index: number): FishState {
  const angle = (index / FISH_COUNT) * Math.PI * 2;
  return { x: pool.x + Math.cos(angle) * 2, z: pool.z + Math.sin(angle) * 2, mode: "patrol", timer: 0, angle };
}

/**
 * Advance one fish's state by `dt`. Pure: given the same prior state, `dt`,
 * pool centre and player position, always returns the same next state.
 *
 * `patrol`: wanders in a loose Lissajous path around its pool centre, gently
 * pulled back when it strays past {@link PATROL_RADIUS}. The instant the
 * player is within {@link FLEE_RADIUS}, it darts directly away from the
 * player's CURRENT position (re-aimed every frame, so a moving player is
 * still evaded) at {@link FLEE_SPEED}. `flee` holds for at least
 * {@link FLEE_DURATION}; once that has elapsed AND the player is clear again,
 * it resumes patrol. Fish never leave their pool for good — the flee burst is
 * short and patrol's centre-pull brings them back.
 */
export function stepFish(
  state: FishState,
  dt: number,
  pool: Pool,
  player: { x: number; z: number },
): FishState {
  const distToPlayer = Math.hypot(state.x - player.x, state.z - player.z);
  let mode = state.mode;
  let timer = state.timer;

  if (mode === "patrol") {
    if (distToPlayer < FLEE_RADIUS) {
      mode = "flee";
      timer = 0;
    }
  } else {
    timer += dt;
    if (timer >= FLEE_DURATION && distToPlayer >= FLEE_RADIUS) {
      mode = "patrol";
      timer = 0;
    }
  }

  let vx: number;
  let vz: number;
  let angle = state.angle;

  if (mode === "flee") {
    const awayX = state.x - player.x;
    const awayZ = state.z - player.z;
    const len = Math.hypot(awayX, awayZ) || 1;
    vx = (awayX / len) * FLEE_SPEED;
    vz = (awayZ / len) * FLEE_SPEED;
  } else {
    angle += dt * 0.6;
    const toCenterX = pool.x - state.x;
    const toCenterZ = pool.z - state.z;
    const distFromCenter = Math.hypot(toCenterX, toCenterZ);
    const pull = distFromCenter > PATROL_RADIUS ? 1 : 0.15;
    vx = Math.cos(angle) * PATROL_SPEED + toCenterX * pull * 0.4;
    vz = Math.sin(angle) * PATROL_SPEED + toCenterZ * pull * 0.4;
  }

  return { x: state.x + vx * dt, z: state.z + vz * dt, mode, timer, angle };
}

const FISH_COLOR = 0x121f26;

function buildFishGeometry(): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(0.3, 1, 5);
  geo.rotateX(-Math.PI / 2); // apex points toward local +Z (forward)
  geo.scale(1, 0.32, 1); // flatten into a shadow-shape silhouette
  return stampVertexColor(geo, FISH_COLOR);
}

/**
 * One draw call (a single `InstancedMesh`) for all `FISH_COUNT` fish, however
 * many pools they're spread across — the wildlife budget's per-creature cap.
 */
export class FishSystem implements System {
  readonly id = "wildlife-fish";

  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.MeshStandardMaterial;
  private readonly mesh: THREE.InstancedMesh;
  private readonly pools: Pool[];
  private states: FishState[];

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly sc = new THREE.Vector3(1, 1, 1);
  private readonly posv = new THREE.Vector3();
  private readonly euler = new THREE.Euler();

  constructor(
    scene: THREE.Scene,
    waterDepthAt: WaterDepthAt,
    private readonly player: PositionSource,
    private readonly session: PauseSource,
  ) {
    this.geo = buildFishGeometry();
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6 });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, FISH_COUNT);
    this.mesh.name = "wildlife-fish";
    scene.add(this.mesh);

    // Safety net only: the real river/lagoon are always deep enough for at
    // least one pool, but a degenerate/flat test terrain must not crash.
    const found = selectPools(waterDepthAt);
    this.pools = found.length > 0 ? found : [{ x: LAGOON.x, z: LAGOON.z }];
    this.states = Array.from({ length: FISH_COUNT }, (_, i) =>
      initialFishState(this.pools[i % this.pools.length], i),
    );
  }

  update(ctx: FrameContext): void {
    if (this.session.paused) return;
    const p = this.player.state.position;
    for (let i = 0; i < this.states.length; i++) {
      const pool = this.pools[i % this.pools.length];
      const next = stepFish(this.states[i], ctx.dt, pool, { x: p.x, z: p.z });
      this.states[i] = next;

      this.posv.set(next.x, WORLD.seaLevel - SWIM_DEPTH, next.z);
      // Facing: the patrol wander heading while patrolling; while fleeing,
      // point along the escape vector so the dart reads as deliberate.
      const heading =
        next.mode === "flee"
          ? Math.atan2(next.x - pool.x, next.z - pool.z) // away from the pool it's fleeing across
          : next.angle;
      this.euler.set(0, heading, 0);
      this.q.setFromEuler(this.euler);
      this.m.compose(this.posv, this.q, this.sc);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  describe(): Record<string, unknown> {
    const fleeing = this.states.filter((s) => s.mode === "flee").length;
    return { fish: this.states.length, fleeing };
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.dispose();
    this.geo.dispose();
    this.mat.dispose();
  }
}
