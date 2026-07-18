// Birds (pivot slice F, wildlife #184): 2 flocks of low-poly birds orbiting
// fixed waypoints over the valley canopy, scattering when the player closes
// in and regrouping once they've backed off. All the motion/state math is
// pure (this file, headless-tested); `BirdsSystem` only uploads it to two
// `InstancedMesh` draw calls (body + wings) — the GPU wiring stays trivial.

import * as THREE from "three";
import type { FrameContext, System } from "../engine/types.ts";
import type { Terrain } from "../world/terrain.ts";
import { mergeOrThrow, stampVertexColor } from "./geometry.ts";
import { COMIC_TIMING, PLAIN_TIMING, overshoot, type ReactionTiming } from "./reactions.ts";

/** Where the player is and how fast they're moving — the explorer satisfies
 *  it via `state.position`/`state.speed` (the `AudioSystem` stride shape).
 *  Speed is what separates a sprint-flush from a walk-up scatter. */
export interface PositionSource {
  readonly state: { position: THREE.Vector3; speed: number };
}

/** Live reduced-motion flag — a `SettingsStore` satisfies it. Optional: when
 *  absent, full comic timing applies. */
export interface ReducedMotionSource {
  getSnapshot(): { reducedMotion: boolean };
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

/** Sprint-past flush (J1 #219): faster than this, within the flush radius,
 *  startles the flock through the grammar's freeze-beat. The radius is wider
 *  than the walk {@link ALERT_RADIUS} — a sprinter is louder than a walker. */
export const SPRINT_FLUSH_SPEED = 5.5;
export const SPRINT_FLUSH_RADIUS = 26;

export type FlockMode = "orbit" | "freeze" | "flush" | "scatter" | "regroup";

export interface FlockState {
  mode: FlockMode;
  /** Seconds spent in the current mode (semantics per mode, see {@link stepFlock}). */
  timer: number;
  /** Seconds of sprint-flush refractory left — the grammar's cooldown, so a
   *  player lapping the flock can't re-trigger the gag on a metronome
   *  (J1 #219). Walk-up scatters are unaffected. */
  refractory: number;
}

export function initialFlockState(): FlockState {
  return { mode: "orbit", timer: 0, refractory: 0 };
}

/**
 * Advance one flock's state machine by `dt` given the current horizontal
 * distance from the player to the flock's centre. Pure: same inputs, same
 * output, every time.
 *
 * `orbit` → `scatter` the instant the player closes inside {@link ALERT_RADIUS}
 * (a walk-up, unchanged since the pivot). A SPRINT past — `playerSpeed` over
 * {@link SPRINT_FLUSH_SPEED} within {@link SPRINT_FLUSH_RADIUS} — instead
 * plays the reaction grammar's comic beat: `freeze` (wings dead-still for
 * `timing.freezeSeconds`, COMMITTED even if the sprint stops) then `flush`,
 * an overshooting explosive scatter. Reduced motion passes `PLAIN_TIMING`
 * (freeze 0) and goes straight to `flush`. `scatter`/`flush` hold for at
 * least {@link SCATTER_MIN_DURATION} (a committed startle, not a flicker),
 * then move to `regroup` once BOTH the minimum has elapsed AND the player is
 * clear again. `regroup` glides back to `orbit` over
 * {@link REGROUP_DURATION} — unless the player closes in again first, which
 * restarts `scatter` at once.
 */
export function stepFlock(
  state: FlockState,
  dt: number,
  distToPlayer: number,
  playerSpeed = 0,
  timing: ReactionTiming = COMIC_TIMING,
): FlockState {
  const refractory = Math.max(0, state.refractory - dt);
  if (state.mode === "orbit") {
    if (distToPlayer < ALERT_RADIUS) return { mode: "scatter", timer: 0, refractory };
    if (
      playerSpeed >= SPRINT_FLUSH_SPEED &&
      distToPlayer < SPRINT_FLUSH_RADIUS &&
      refractory <= 0
    ) {
      // The flush arms the grammar's refractory the moment it commits, so a
      // player lapping the annulus gets one gag per cooldown, not a metronome.
      return timing.freezeSeconds <= 0
        ? { mode: "flush", timer: 0, refractory: timing.cooldownSeconds }
        : { mode: "freeze", timer: 0, refractory: timing.cooldownSeconds };
    }
    return state.refractory === refractory ? state : { ...state, refractory };
  }
  if (state.mode === "freeze") {
    const timer = state.timer + dt;
    return timer >= timing.freezeSeconds
      ? { mode: "flush", timer: 0, refractory }
      : { mode: "freeze", timer, refractory };
  }
  if (state.mode === "scatter" || state.mode === "flush") {
    const timer = state.timer + dt;
    if (timer >= SCATTER_MIN_DURATION && distToPlayer >= ALERT_RADIUS) {
      return { mode: "regroup", timer: 0, refractory };
    }
    return { mode: state.mode, timer, refractory };
  }
  // regroup
  if (distToPlayer < ALERT_RADIUS) return { mode: "scatter", timer: 0, refractory };
  const timer = state.timer + dt;
  return timer >= REGROUP_DURATION
    ? { mode: "orbit", timer: 0, refractory }
    : { mode: "regroup", timer, refractory };
}

/** 0 (tight orbit) .. 1 (fully scattered) puff-out factor for the current
 *  mode/timer — the one knob {@link birdPose} scales radius/height/flap by.
 *  `freeze` pins 0 (the held comic beat); `flush` rides the grammar's
 *  {@link overshoot} envelope, so it bursts PAST a plain scatter (~1.15×)
 *  before settling at 1. */
export function scatterFactor(mode: FlockMode, timer: number): number {
  if (mode === "orbit" || mode === "freeze") return 0;
  if (mode === "scatter") return Math.min(1, timer / SCATTER_CLIMB_TIME);
  if (mode === "flush") return overshoot(timer / SCATTER_CLIMB_TIME);
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
    // The freeze beat holds the wings DEAD STILL — the "…!" instant that
    // sells the flush that follows (J1 #219).
    flap: mode === "freeze" ? 0 : Math.sin(elapsed * flapSpeed + birdIndex * 0.9) * FLAP_AMPLITUDE,
  };
}

const BODY_COLOR = 0x241f1a;
const WING_COLOR = 0x322b23;
/** A warm accent on the beak only — a parrot/macaw-like hint against the
 *  otherwise dark plumage silhouette (`docs/art-direction.md`'s warm
 *  palette), cheap (no extra geometry, one more merged part). */
const BEAK_COLOR = 0xcf7a34;

/** A four-triangle wing pair (a real tapered/swept PLANFORM — wide chord at
 *  the root, narrow at the tip, both swept back) lying flat in the local XZ
 *  plane, spine at the local origin — instanced whole and "flapped" by
 *  rotating the per-instance matrix around the body's forward axis (a roll),
 *  the per-instance-rotation flap the wildlife spec calls for. Objects
 *  slice 2 upgrade: the prior version was a single DEGENERATE triangle per
 *  side (root point to tip point to one trailing corner) — a wing outline
 *  with no chord/taper at all; this is the same "articulated plane" idiom
 *  (still flat, still one flap hinge) with an actual wing shape. */
function buildWingGeometry(): THREE.BufferGeometry {
  const span = 0.55;
  const sweep = 0.32;
  const rootChord = 0.11; // front-to-back width at the shoulder (spine)
  const tipChord = 0.04; // front-to-back width at the wingtip — a real taper

  // Right wing quad corners: leading/trailing edge at the root (spine) and
  // at the tip (swept back by `sweep`), split into 2 triangles.
  const rl: [number, number, number] = [0, 0, 0];
  const rt: [number, number, number] = [0, 0, rootChord];
  const tl: [number, number, number] = [span, 0, -sweep];
  const tt: [number, number, number] = [span, 0, -sweep + tipChord];
  const positions = new Float32Array([
    ...rl, ...rt, ...tt,
    ...rl, ...tt, ...tl,
    // Left wing: the mirrored quad (negate X, reversed winding).
    ...rl, ...[-tt[0], tt[1], tt[2]], ...[-rt[0], rt[1], rt[2]],
    ...rl, ...[-tl[0], tl[1], tl[2]], ...[-tt[0], tt[1], tt[2]],
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Torso + head + beak + fan tail, merged to ONE geometry (still the SAME one
 * `bodyMesh` `InstancedMesh` draw call) — Objects slice 2: the prior body was
 * a bare cone with no head/beak/tail at all. Apex (the torso cone's point)
 * faces local +Z, same convention `fish.ts`'s body uses, so the head sits
 * just ahead of it and the tail fans out behind the cone's flat base. No CC0
 * parrot/macaw model was found through this codebase's scriptable-download
 * conventions (poly.pizza gates behind a paid API key with mixed per-model
 * licences; Kenney has no 3D bird pack; Quaternius's itch.io mirrors carry no
 * bird pack at all), so — per the slice's own licence — this is a substantial
 * procedural upgrade, kept cheap (a handful of extra triangles) since it
 * multiplies by every one of `TOTAL_BIRDS` instances.
 */
function buildBirdBodyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const torso = stampVertexColor(new THREE.ConeGeometry(0.12, 0.55, 5).rotateX(Math.PI / 2), BODY_COLOR);
  parts.push(torso);
  const head = stampVertexColor(new THREE.BoxGeometry(0.15, 0.13, 0.16), BODY_COLOR);
  head.translate(0, 0.01, 0.34);
  parts.push(head);
  const beak = stampVertexColor(new THREE.ConeGeometry(0.035, 0.16, 3).rotateX(Math.PI / 2), BEAK_COLOR);
  beak.translate(0, 0, 0.5);
  parts.push(beak);
  const tail = stampVertexColor(new THREE.ConeGeometry(0.1, 0.32, 3).rotateX(-Math.PI / 2), WING_COLOR);
  tail.scale(1, 0.35, 1); // flatten into a fan
  tail.translate(0, 0, -0.42);
  parts.push(tail);
  const merged = mergeOrThrow(parts);
  for (const g of parts) g.dispose();
  return merged;
}

interface Flock {
  center: { x: number; y: number; z: number };
  state: FlockState;
}

/**
 * Two draw calls total (body + wings InstancedMesh), however many birds are
 * instanced — the wildlife budget's per-creature cap. Body/wing geometry is
 * still a low-poly silhouette (a torso+head+beak+tail body, a tapered/swept
 * wing planform — Objects slice 2), well inside the ≤40k-triangle wildlife
 * budget.
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

  /** Set when any flock enters `flush`; drained by {@link justFlushed}. */
  private flushedEdge = false;

  constructor(
    scene: THREE.Scene,
    terrain: Terrain,
    private readonly player: PositionSource,
    private readonly session: PauseSource,
    private readonly reducedMotion?: ReducedMotionSource,
  ) {
    this.group.name = "wildlife-birds";

    this.bodyGeo = buildBirdBodyGeometry();
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
    const speed = this.player.state.speed;
    const timing = this.reducedMotion?.getSnapshot().reducedMotion ? PLAIN_TIMING : COMIC_TIMING;
    let i = 0;
    for (const flock of this.flocks) {
      const dist = Math.hypot(p.x - flock.center.x, p.z - flock.center.z);
      const prev = flock.state.mode;
      flock.state = stepFlock(flock.state, ctx.dt, dist, speed, timing);
      if (flock.state.mode === "flush" && prev !== "flush") this.flushedEdge = true;

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

  /** True once per flush event — drained on read. The audio system polls this
   *  for the squawk-cascade one-shot (same posture as `snakes.anyAlert()`). */
  justFlushed(): boolean {
    const edge = this.flushedEdge;
    this.flushedEdge = false;
    return edge;
  }

  /** Startle every flock into a fresh scatter at once — the treasure finale's
   *  "the whole jungle answers" beat (owner note, 2026-07-10). Reuses the
   *  exact scatter state a close player triggers, so the committed-startle
   *  minimum and regroup glide apply unchanged. */
  startle(): void {
    for (const flock of this.flocks) {
      flock.state = { mode: "scatter", timer: 0, refractory: flock.state.refractory };
    }
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
