// Snakes (pivot slice F, wildlife #184): 6 coiled snakes placed deterministically
// near — but never inside — the camp clearing, guarding the approaches to the
// expedition sites. idle → alert (player < 6u: head raises) → strike (player
// < 1.6u: lunges, deals damage through the injected `hurt` seam, 1.5s cooldown)
// → de-escalate (a brief settle) → idle as the player backs off. They never
// chase — their placement is fixed for life. The state machine (`stepSnake`) is
// pure and takes `hurt` as a return value (`struck`), not a direct call, so it
// stays trivially testable; only `SnakesSystem.update` actually calls it.

import * as THREE from "three";
import type { FrameContext, System } from "../engine/types.ts";
import type { Terrain } from "../world/terrain.ts";
import { POI_ANCHORS, WORLD } from "../world/worldConfig.ts";
import { mergeOrThrow, mottleFaces, stampVertexColor } from "./geometry.ts";

/** Where the player is — the explorer satisfies it via `state.position`. */
export interface PositionSource {
  readonly state: { position: THREE.Vector3 };
}

/** Hold all movement while true — the shared session pause flag satisfies it. */
export interface PauseSource {
  readonly paused: boolean;
}

/** Deal damage to the player — `game.survival.hurt` satisfies it. Injected as
 *  a plain callback (not the SurvivalSystem itself) so this module stays
 *  decoupled from survival's shape, per the wildlife spec. */
export type HurtFn = (amount: number) => void;

export const SNAKE_COUNT = 6;
/** Clue-site-approach placement band: this far out from the site it guards. */
export const APPROACH_MIN = 12;
export const APPROACH_MAX = 20;

export const ALERT_RADIUS = 6;
export const STRIKE_RADIUS = 1.6;
export const STRIKE_DAMAGE = 25;
export const STRIKE_COOLDOWN = 1.5;
/** How long the head takes to settle back down once the player is clear of
 *  both the alert and strike radii. */
export const DEESCALATE_DURATION = 1.2;

export interface SnakePlacement {
  x: number;
  z: number;
  y: number;
  /** Radians — faces back toward the site it guards. */
  facing: number;
}

/** A tiny deterministic string hash → [0,1), so placement never depends on
 *  `Math.random` (repeatable across every load, per the wildlife spec). FNV-1a
 *  variant salted per call site so two calls on the same id decorrelate. */
function hash01(id: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h / 4294967296;
}

/**
 * Deterministic placement: one snake per expedition site (5 non-camp sites +
 * the camp itself), {@link APPROACH_MIN}..{@link APPROACH_MAX} units out along
 * a hash-picked bearing — "near an interesting spot, not on it." The camp gets
 * a wider minimum so it never lands inside `WORLD.campClearRadius` (the base
 * camp is a legitimate approach to guard, just never IN the cleared pad).
 */
export function placeSnakes(terrain: Terrain): SnakePlacement[] {
  return POI_ANCHORS.map((anchor) => {
    const bearing = hash01(anchor.poiId, 1) * Math.PI * 2;
    const isCamp = anchor.archetype === "camp";
    const minDist = isCamp ? WORLD.campClearRadius + 3 : APPROACH_MIN;
    const maxDist = Math.max(minDist + 1, APPROACH_MAX);
    const dist = minDist + hash01(anchor.poiId, 2) * (maxDist - minDist);
    const x = anchor.x + Math.sin(bearing) * dist;
    const z = anchor.z + Math.cos(bearing) * dist;
    return { x, z, y: terrain.heightAt(x, z), facing: bearing + Math.PI };
  });
}

export type SnakeMode = "idle" | "alert" | "strike" | "deescalate";

export interface SnakeState {
  mode: SnakeMode;
  /** Seconds until the next strike may land (decays every frame, in every
   *  mode — a global per-snake cooldown, not reset on mode entry). */
  cooldown: number;
  /** Seconds remaining in `deescalate` before settling to `idle`. */
  timer: number;
}

export function initialSnakeState(): SnakeState {
  return { mode: "idle", cooldown: 0, timer: 0 };
}

export interface SnakeStepResult {
  state: SnakeState;
  /** True the instant this step lands a strike — the caller feeds this into
   *  `hurt(STRIKE_DAMAGE)`, exactly once per cooldown window. */
  struck: boolean;
}

/**
 * Advance one snake's state by `dt` given the current distance to the player.
 * Pure: `struck` is a return value, never a side effect, so tests can assert
 * the cooldown/strike behaviour without any injected callback.
 */
export function stepSnake(state: SnakeState, dt: number, dist: number): SnakeStepResult {
  let mode = state.mode;
  let timer = state.timer;
  const cooldown = Math.max(0, state.cooldown - dt);

  switch (mode) {
    case "idle":
      if (dist <= ALERT_RADIUS) mode = "alert";
      break;
    case "alert":
      if (dist <= STRIKE_RADIUS) {
        mode = "strike"; // may strike THIS frame — checked below, after the transition
      } else if (dist > ALERT_RADIUS) {
        mode = "deescalate";
        timer = DEESCALATE_DURATION;
      }
      break;
    case "strike":
      if (dist > STRIKE_RADIUS) {
        mode = dist > ALERT_RADIUS ? "deescalate" : "alert";
        if (mode === "deescalate") timer = DEESCALATE_DURATION;
      }
      break;
    case "deescalate":
      if (dist <= STRIKE_RADIUS) {
        mode = "strike";
      } else if (dist <= ALERT_RADIUS) {
        mode = "alert";
      } else {
        timer = Math.max(0, timer - dt);
        if (timer <= 0) mode = "idle";
      }
      break;
  }

  // Evaluated AFTER the transition above, so entering `strike` this very frame
  // (from alert or deescalate) lands its strike immediately, matching "lunge
  // toward player, call hurt() once per strike" — not one frame late.
  let struck = false;
  let nextCooldown = cooldown;
  if (mode === "strike" && cooldown <= 0) {
    struck = true;
    nextCooldown = STRIKE_COOLDOWN;
  }

  return { state: { mode, cooldown: nextCooldown, timer }, struck };
}

/** 0 (resting) .. 1 (fully raised) head height for the current mode/timer. */
export function headRaise(mode: SnakeMode, timer: number): number {
  switch (mode) {
    case "idle":
      return 0;
    case "alert":
    case "strike":
      return 1;
    case "deescalate":
      return Math.max(0, Math.min(1, timer / DEESCALATE_DURATION));
  }
}

/** 0..1 forward lunge amount — only nonzero mid-strike-cycle, so repeated
 *  strikes (gated by the cooldown) read as repeated jabs rather than one held
 *  lean. Cosmetic; not part of the damage rule. */
export function lungeAmount(mode: SnakeMode, cooldown: number): number {
  if (mode !== "strike") return 0;
  const cyclePhase = 1 - cooldown / STRIKE_COOLDOWN; // 0 right after a strike → 1 as the next nears
  return Math.max(0, Math.sin(cyclePhase * Math.PI));
}

const BODY_COLOR = 0x3d5a34;
const HEAD_COLOR = 0x2e4527;
/** A darker band colour, mottled onto the coil in stripes around its own
 *  angle (see {@link buildCoiledBodyGeometry}) — Objects slice 2's "improve
 *  proportions/colour banding" call for the snake (already the closest-
 *  reading of the four animals, per the slice's own scope): zero extra
 *  triangles, just a periodic per-face colour blend. */
const BAND_COLOR = 0x223318;
/** How many dark bands wrap the coil — enough to read as scale banding
 *  without looking like a barber pole. */
const BAND_COUNT = 7;

function buildCoiledBodyGeometry(): THREE.BufferGeometry {
  const outer = new THREE.TorusGeometry(0.5, 0.14, 6, 14);
  outer.rotateX(Math.PI / 2);
  const inner = new THREE.TorusGeometry(0.32, 0.12, 6, 12);
  inner.rotateX(Math.PI / 2);
  inner.translate(0, 0.18, 0.05);
  const merged = mergeOrThrow([outer, inner]);
  outer.dispose();
  inner.dispose();
  const body = stampVertexColor(merged, BODY_COLOR);
  // The torus lies flat in the local XZ plane (post-rotateX) — banding by
  // the coil's own angle (atan2(z, x)) wraps the stripes around the body
  // exactly the way real scale banding follows a snake's length.
  return mottleFaces(body, new THREE.Color(BODY_COLOR), new THREE.Color(BAND_COLOR), (cx, _cy, cz) => {
    const angle = Math.atan2(cz, cx);
    return Math.abs(Math.sin(angle * BAND_COUNT)) > 0.55 ? 1 : 0;
  });
}

/** A flattened, widened cone — a triangular, pit-viper-like head wedge rather
 *  than the prior round symmetric cone (Objects slice 2; already the
 *  closest-reading animal, so this stays a cheap reshape — zero added
 *  triangles — rather than new geometry). */
function buildHeadGeometry(): THREE.BufferGeometry {
  const geo = new THREE.ConeGeometry(0.16, 0.5, 6);
  geo.rotateZ(-Math.PI / 2); // apex points along local +X (forward)
  geo.scale(1, 0.55, 1.35);
  return stampVertexColor(geo, HEAD_COLOR);
}

/**
 * Two draw calls (coiled-body + head InstancedMesh), however many snakes are
 * placed — the wildlife budget's per-creature cap. Bodies are placed ONCE at
 * construction (they never move — "they never chase"); only the head matrix
 * updates per frame, so a paused/idle snake costs nothing beyond the state
 * check.
 */
export class SnakesSystem implements System {
  readonly id = "wildlife-snakes";

  private readonly bodyGeo: THREE.BufferGeometry;
  private readonly headGeo: THREE.BufferGeometry;
  private readonly bodyMat: THREE.MeshStandardMaterial;
  private readonly headMat: THREE.MeshStandardMaterial;
  private readonly bodyMesh: THREE.InstancedMesh;
  private readonly headMesh: THREE.InstancedMesh;
  private readonly placements: SnakePlacement[];
  private states: SnakeState[];

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
    private readonly hurt: HurtFn,
  ) {
    this.bodyGeo = buildCoiledBodyGeometry();
    this.headGeo = buildHeadGeometry();
    this.bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8 });
    this.headMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8 });

    this.placements = placeSnakes(terrain);
    this.states = this.placements.map(() => initialSnakeState());

    this.bodyMesh = new THREE.InstancedMesh(this.bodyGeo, this.bodyMat, this.placements.length);
    this.headMesh = new THREE.InstancedMesh(this.headGeo, this.headMat, this.placements.length);
    this.bodyMesh.name = "wildlife-snake-body";
    this.headMesh.name = "wildlife-snake-head";

    // Bodies are placed once — fixed for the snake's life.
    for (let i = 0; i < this.placements.length; i++) {
      const pl = this.placements[i];
      this.posv.set(pl.x, pl.y, pl.z);
      this.euler.set(0, pl.facing, 0);
      this.q.setFromEuler(this.euler);
      this.m.compose(this.posv, this.q, this.sc);
      this.bodyMesh.setMatrixAt(i, this.m);
    }
    this.bodyMesh.instanceMatrix.needsUpdate = true;

    scene.add(this.bodyMesh, this.headMesh);
  }

  update(ctx: FrameContext): void {
    if (this.session.paused) return;
    const p = this.player.state.position;

    for (let i = 0; i < this.placements.length; i++) {
      const pl = this.placements[i];
      const dist = Math.hypot(p.x - pl.x, p.z - pl.z);
      const { state, struck } = stepSnake(this.states[i], ctx.dt, dist);
      this.states[i] = state;
      if (struck) this.hurt(STRIKE_DAMAGE);

      const raise = headRaise(state.mode, state.timer);
      const lunge = lungeAmount(state.mode, state.cooldown);
      const forwardX = Math.sin(pl.facing);
      const forwardZ = Math.cos(pl.facing);
      const forwardDist = lunge * 0.5;
      this.posv.set(pl.x + forwardX * forwardDist, pl.y + 0.35 + raise * 0.35, pl.z + forwardZ * forwardDist);
      this.euler.set(-0.3 + raise * 0.9 + lunge * 0.4, pl.facing, 0);
      this.q.setFromEuler(this.euler);
      this.m.compose(this.posv, this.q, this.sc);
      this.headMesh.setMatrixAt(i, this.m);
    }
    this.headMesh.instanceMatrix.needsUpdate = true;
  }

  /** True while ANY snake is alert or mid-strike — the audio slice's rattle-
   *  warning edge trigger. Polled rather than a callback, so this module stays
   *  decoupled from audio's shape (same "plain callback/poll, no coupling"
   *  posture as {@link HurtFn}). */
  anyAlert(): boolean {
    for (const s of this.states) {
      if (s.mode === "alert" || s.mode === "strike") return true;
    }
    return false;
  }

  describe(): Record<string, unknown> {
    return { snakes: this.states.map((s) => s.mode) };
  }

  dispose(): void {
    this.bodyMesh.parent?.remove(this.bodyMesh);
    this.headMesh.parent?.remove(this.headMesh);
    this.bodyMesh.dispose();
    this.headMesh.dispose();
    this.bodyGeo.dispose();
    this.headGeo.dispose();
    this.bodyMat.dispose();
    this.headMat.dispose();
  }
}
