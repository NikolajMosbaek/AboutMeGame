// The capuchin troop (J1 slices 3–4, #220) — the epic's star comedian. Four
// procedural low-poly monkeys living their own life between canopy anchors,
// getting curious when the player stands still, and pulling the centrepiece
// gag: the FRUIT HEIST — dart to a ripe plant the player was about to forage,
// steal the fruit, carry it to a perch, taunt, and drop it (early, if chased).
//
// Same architecture as every other creature here: ALL behavior is a pure step
// function (`stepMonkey`, headless-tested), the `MonkeysSystem` only elects
// the thief, paces the gag, uploads instance matrices and owns the GPU
// objects. Two draw calls total: one body InstancedMesh, one fruit
// InstancedMesh shared by carried + dropped fruit. Zero asset bytes.
//
// Tone: lightly cartoonish (the approved J1 boundary) — bouncy hop gait, a
// grammar freeze-beat before fleeing, a bounce-taunt on the perch. Nothing a
// real capuchin wouldn't do; the exaggeration is all in the timing.

import * as THREE from "three";
import type { FrameContext, System } from "../engine/types.ts";
import type { Terrain } from "../world/terrain.ts";
import { SPAWN, WORLD } from "../world/worldConfig.ts";
import { hash2, mergeOrThrow, stampVertexColor } from "./geometry.ts";
import { COMIC_TIMING, PLAIN_TIMING, type ReactionTiming } from "./reactions.ts";
import { TUNE as FORAGE_TUNE, type FruitPlant } from "../forage/ForageSystem.ts";
import type { FruitKind } from "../forage/forageStore.ts";

/** Where the player is and how fast they're moving — the explorer satisfies it. */
export interface PositionSource {
  readonly state: { position: THREE.Vector3; speed: number };
}

/** Hold all movement while true — the shared session pause flag satisfies it. */
export interface PauseSource {
  readonly paused: boolean;
}

/** Live reduced-motion flag — a `SettingsStore` satisfies it. */
export interface ReducedMotionSource {
  getSnapshot(): { reducedMotion: boolean };
}

/** The forage seam the heist steals through — buildGame wires the SAME plants
 *  array and ripeness hook `ForageSystem` owns, plus `creditEat` so a scooped
 *  drop nourishes exactly like a picked fruit (and rings the same bite cue). */
export interface HeistSeam {
  plants: FruitPlant[];
  setRipe(index: number, ripe: boolean): void;
  creditEat(kind: FruitKind): void;
}

export const TROOP_SIZE = 4;

/** Canopy hangouts split by the river: the carved channel is deep water the
 *  whole way from the highland spring to the lagoon, so a single anchor ring
 *  would send the troop SWIMMING four legs out of five (the shipped bug).
 *  Each monkey patrols one bank; every intra-bank leg is verified dry on the
 *  real terrain by test, as is each anchor's site/camp clearance. */
export const TROOP_BANKS: ReadonlyArray<ReadonlyArray<{ x: number; z: number }>> = [
  // East bank — the ruin-side valley and hills.
  [
    { x: 20, z: 40 },
    { x: 45, z: -40 },
    { x: 60, z: 70 },
  ],
  // West bank — the canoe/last-camp country.
  [
    { x: -30, z: 10 },
    { x: -60, z: 60 },
  ],
];

/** All anchors, flat — for site-clearance checks and as the default pool for
 *  {@link nearestAnchor}. */
export const TROOP_ANCHORS: ReadonlyArray<{ x: number; z: number }> = TROOP_BANKS.flat();

/** Water deeper than a wade is monkey-forbidden (the jaguar's threshold —
 *  matches the explorer's wadeDepth; capuchins don't swim rivers either). */
export const WADE_DEPTH = 0.35;

/** Player closer than this to a monkey → grammar freeze-beat, then flee. */
export const FLEE_RADIUS = 3;
/** Stand still this long within this range and the nearest monkey approaches. */
export const CURIOUS_STILL_SECONDS = 4;
export const CURIOUS_RADIUS = 14;
/** Curious keeps a respectful gap — close enough to read, never underfoot. */
const CURIOUS_KEEP = 5;
/** Movement speeds (m/s): the troop ambles, a thief bounds, a flee is a bolt. */
const TROOP_SPEED = 1.6;
const CURIOUS_SPEED = 2.4;
const HEIST_SPEED = 6;
const FLEE_SPEED = 5;
/** Seconds a monkey dwells at an anchor before moving on (± index jitter). */
const ANCHOR_DWELL = 24;
/** Arrival slop for anchors/targets. */
const REACHED = 1.2;

/** The heist pacing knob: at least this long between gags, and after the max
 *  wait the troop drifts toward the player to find a plant. One gag per gap —
 *  scarcity is what keeps it funny. */
export const HEIST_MIN_GAP = 90;
export const HEIST_MAX_WAIT = 240;
/** The gag clock starts here, not at zero, so the FIRST heist can land ~30 s
 *  into a session — the comedy has to introduce itself before it can be rare. */
export const FIRST_HEIST_HEAD_START = 60;
/** A heist that can't reach its plant or perch (water in the way) gives up
 *  after this long, freeing the gag slot instead of stalling comedy forever. */
export const HEIST_TIMEOUT = 25;
/** A heist arms when the player is within this of a ripe plant. */
export const HEIST_SEEK_RADIUS = 10;
/** How long the thief taunts on its perch before dropping the fruit. */
export const TAUNT_SECONDS = 20;
/** Closing within this of the perched thief forces the drop — the chase pays. */
export const CHASE_DROP_RADIUS = 4;
/** The perch: this far from the plant, away from the player. */
const PERCH_DISTANCE = 10;
/** Dropped fruit: scooped by walking over it; expires unclaimed after TTL. */
export const PICKUP_RADIUS = 1.4;
export const DROP_TTL = 60;
/** No heist triggers while the player is this close to camp. */
const CAMP_SANCTUARY = WORLD.campClearRadius + 6;

export type MonkeyMode = "troop" | "curious" | "freeze" | "flee" | "heist";

export interface MonkeyState {
  mode: MonkeyMode;
  x: number;
  z: number;
  /** Facing (radians; rotation.y for a +Z-forward body). */
  heading: number;
  /** Seconds in the current mode (taunt clock while perched, and the give-up
   *  clock while running a heist). */
  timer: number;
  /** Which side of the river this monkey lives on — index into
   *  {@link TROOP_BANKS}. Fixed for life; monkeys never cross the river. */
  bank: number;
  /** Current anchor index into its bank's list. */
  anchor: number;
  /** Seconds dwelt at the current anchor. */
  dwell: number;
  /** The fruit being carried mid-heist, if any. */
  carrying: FruitKind | null;
  /** Where the thief is headed: the plant (before the steal, `plantIndex`
   *  valid) or the perch (after). Null once perched. */
  heistTarget: { x: number; z: number; kind: FruitKind; plantIndex: number } | null;
  /** Seconds of curiosity refractory left (no immediate re-approach). */
  refractory: number;
}

export function initialMonkeyState(i: number): MonkeyState {
  const bank = i % TROOP_BANKS.length;
  const anchor = Math.floor(i / TROOP_BANKS.length) % TROOP_BANKS[bank].length;
  const a = TROOP_BANKS[bank][anchor];
  // Deterministic per-index spread around the anchor — no Math.random.
  const spread = hash2(i * 7.3, i * 3.1) * Math.PI * 2;
  return {
    mode: "troop",
    x: a.x + Math.cos(spread) * 2.5,
    z: a.z + Math.sin(spread) * 2.5,
    heading: 0,
    timer: 0,
    bank,
    anchor,
    dwell: i * 5, // stagger departures so the troop never moves in lockstep
    carrying: null,
    heistTarget: null,
    refractory: 0,
  };
}

/** Still-water depth at a ground point (`<= 0` = dry) — `World.waterDepthAt`. */
export type WaterDepthAt = (x: number, z: number) => number;

/** Everything one monkey reads about the world this frame. */
export interface TroopEnv {
  player: { x: number; z: number };
  playerSpeed: number;
  /** Seconds the player has been standing still (speed under a soft floor). */
  playerStillSeconds: number;
  /** Depth probe every step is checked against — monkeys never swim. */
  waterDepthAt: WaterDepthAt;
}

export interface MonkeyStepResult {
  state: MonkeyState;
  /** Index of the plant stolen THIS step, or null. */
  stolePlant: number | null;
  /** A fruit dropped THIS step (at the perch, or underfoot when chased). */
  dropped: { x: number; z: number; kind: FruitKind } | null;
  /** True on each taunt bounce accent (audio edge, PR III). */
  taunted: boolean;
}

/** The bouncy hop offset (world units above ground) — pure and bounded, the
 *  troop's lightly-cartoonish gait. */
export function hopPose(t: number, phase: number): number {
  return 0.35 * Math.abs(Math.sin(t * 5 + phase));
}

/** Index of the anchor (from `anchors`) nearest a point — the thief's retreat
 *  heading and the drift retarget, always within one bank when passed one. */
export function nearestAnchor(
  x: number,
  z: number,
  anchors: ReadonlyArray<{ x: number; z: number }> = TROOP_ANCHORS,
): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < anchors.length; i++) {
    const d = Math.hypot(x - anchors[i].x, z - anchors[i].z);
    if (d < bestDist) {
      best = i;
      bestDist = d;
    }
  }
  return best;
}

/** Index of the nearest eligible troop member — the elected thief. `-1` when
 *  nobody in the mask can take the job (the gag is skipped, not stalled). */
export function electThief(
  states: ReadonlyArray<{ x: number; z: number }>,
  plant: { x: number; z: number },
  eligible?: ReadonlyArray<boolean>,
): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < states.length; i++) {
    if (eligible && !eligible[i]) continue;
    const d = Math.hypot(states[i].x - plant.x, states[i].z - plant.z);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** True when the straight line a→b never dips into deep water (sampled every
 *  ~3 u) — the heist director's reachability check. */
export function dryPath(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  waterDepthAt: WaterDepthAt,
): boolean {
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(len / 3));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (waterDepthAt(ax + (bx - ax) * t, az + (bz - az) * t) > WADE_DEPTH) return false;
  }
  return true;
}

/** Steering offsets tried in order when the direct step lands in deep water —
 *  the monkey veers along the bank rather than swimming (or teleporting). */
const STEER = [0, 0.7, -0.7, 1.4, -1.4];

/** Move `speed·dt` toward the target, refusing any step into deep water; a
 *  blocked direct line slides along the bank via {@link STEER}. Returns true
 *  once within {@link REACHED} of the target (never while fully blocked). */
function moveToward(
  s: MonkeyState,
  tx: number,
  tz: number,
  speed: number,
  dt: number,
  waterDepthAt: WaterDepthAt,
): boolean {
  const dx = tx - s.x;
  const dz = tz - s.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return true;
  const step = Math.min(len, speed * dt);
  const base = Math.atan2(dx, dz);
  for (const off of STEER) {
    const a = base + off;
    const nx = s.x + Math.sin(a) * step;
    const nz = s.z + Math.cos(a) * step;
    if (waterDepthAt(nx, nz) <= WADE_DEPTH) {
      s.heading = a;
      s.x = nx;
      s.z = nz;
      return len <= REACHED;
    }
  }
  s.heading = base; // feet stay dry; it faces where it wanted to go
  return false;
}

/**
 * Advance one monkey by `dt`. Pure: same state + env in, same result out —
 * steal/drop/taunt are RETURN VALUES the system acts on, never side effects
 * (the snakes'/jaguar's testability posture).
 */
export function stepMonkey(
  state: MonkeyState,
  dt: number,
  env: TroopEnv,
  timing: ReactionTiming,
): MonkeyStepResult {
  const s: MonkeyState = { ...state, refractory: Math.max(0, state.refractory - dt) };
  const dist = Math.hypot(env.player.x - s.x, env.player.z - s.z);
  let stolePlant: number | null = null;
  let dropped: MonkeyStepResult["dropped"] = null;
  let taunted = false;

  // A too-close player startles ANY non-heisting monkey (a mid-heist thief is
  // committed — the chase resolution below is its own drama).
  if (s.mode !== "heist" && s.mode !== "freeze" && s.mode !== "flee" && dist < FLEE_RADIUS) {
    s.mode = timing.freezeSeconds <= 0 ? "flee" : "freeze";
    s.timer = 0;
    return { state: s, stolePlant, dropped, taunted };
  }

  switch (s.mode) {
    case "troop": {
      // Curiosity: a still player nearby is worth a look (one at a time — the
      // system only routes stillness to the elected monkey via env).
      if (
        env.playerStillSeconds >= CURIOUS_STILL_SECONDS &&
        dist < CURIOUS_RADIUS &&
        s.refractory <= 0
      ) {
        s.mode = "curious";
        s.timer = 0;
        break;
      }
      const bankAnchors = TROOP_BANKS[s.bank];
      const a = bankAnchors[s.anchor];
      const there = Math.hypot(s.x - a.x, s.z - a.z) <= 3;
      if (there) {
        s.dwell += dt;
        // Idle shuffle around the anchor: tiny deterministic drift.
        if (s.dwell >= ANCHOR_DWELL + (s.anchor % 3) * 4) {
          s.anchor = (s.anchor + 1) % bankAnchors.length;
          s.dwell = 0;
        }
      } else {
        moveToward(s, a.x, a.z, TROOP_SPEED, dt, env.waterDepthAt);
      }
      s.timer += dt;
      break;
    }

    case "curious": {
      // The moment is over the instant the player moves.
      if (env.playerSpeed > 0.5) {
        s.mode = "troop";
        s.timer = 0;
        s.refractory = 15;
        break;
      }
      if (dist > CURIOUS_KEEP) moveToward(s, env.player.x, env.player.z, CURIOUS_SPEED, dt, env.waterDepthAt);
      else s.heading = Math.atan2(env.player.x - s.x, env.player.z - s.z); // sit and stare
      s.timer += dt;
      if (s.timer > 15) {
        // Bored: seen enough of you.
        s.mode = "troop";
        s.timer = 0;
        s.refractory = 20;
      }
      break;
    }

    case "freeze": {
      s.timer += dt;
      if (s.timer >= timing.freezeSeconds) {
        s.mode = "flee";
        s.timer = 0;
      }
      break; // held dead-still — the "…!" beat
    }

    case "flee": {
      s.timer += dt;
      const awayX = s.x - env.player.x;
      const awayZ = s.z - env.player.z;
      const len = Math.hypot(awayX, awayZ) || 1;
      // A bolt toward the river skirts the bank instead of swimming it.
      moveToward(
        s,
        s.x + (awayX / len) * 10,
        s.z + (awayZ / len) * 10,
        FLEE_SPEED,
        dt,
        env.waterDepthAt,
      );
      if (s.timer >= timing.reactSeconds) {
        s.mode = "troop";
        s.timer = 0;
        s.refractory = 10;
      }
      break;
    }

    case "heist": {
      if (s.heistTarget && s.carrying === null) {
        // Phase 1 — bound to the plant. The give-up clock runs the whole way:
        // a thief walled off by the river frees the gag slot, never stalls it.
        const t = s.heistTarget;
        s.timer += dt;
        if (s.timer >= HEIST_TIMEOUT) {
          s.mode = "flee";
          s.heistTarget = null;
          s.timer = 0;
          break;
        }
        if (moveToward(s, t.x, t.z, HEIST_SPEED, dt, env.waterDepthAt)) {
          stolePlant = t.plantIndex;
          s.carrying = t.kind;
          // Phase 2 target: the perch, toward the nearest anchor of the
          // thief's OWN bank — home turf is validated dry land inside the
          // boundary, so the drop can never strand offshore or over the river
          // (review finding: "away from the player" could point out to sea).
          // A plant sitting ON an anchor needs a home that's actually
          // elsewhere, or the perch degenerates to the plant and the gag
          // self-destructs against the chase radius.
          const bankAnchors = TROOP_BANKS[s.bank];
          let home = bankAnchors[nearestAnchor(t.x, t.z, bankAnchors)];
          if (Math.hypot(home.x - t.x, home.z - t.z) < PERCH_DISTANCE * 1.5) {
            for (const a of bankAnchors) {
              if (Math.hypot(a.x - t.x, a.z - t.z) >= PERCH_DISTANCE * 1.5) {
                home = a;
                break;
              }
            }
          }
          const homeX = home.x - t.x;
          const homeZ = home.z - t.z;
          const len = Math.hypot(homeX, homeZ) || 1;
          s.heistTarget = {
            x: t.x + (homeX / len) * PERCH_DISTANCE,
            z: t.z + (homeZ / len) * PERCH_DISTANCE,
            kind: t.kind,
            plantIndex: -1,
          };
          s.timer = 0;
        }
      } else if (s.heistTarget && s.carrying !== null) {
        // Phase 2 — carry to the perch (same give-up clock: a blocked carrier
        // drops the fruit where it stands and bails).
        s.timer += dt;
        if (s.timer >= HEIST_TIMEOUT) {
          dropped = { x: s.x, z: s.z, kind: s.carrying };
          s.carrying = null;
          s.heistTarget = null;
          s.mode = "flee";
          s.timer = 0;
          break;
        }
        if (moveToward(s, s.heistTarget.x, s.heistTarget.z, HEIST_SPEED, dt, env.waterDepthAt)) {
          s.heistTarget = null;
          s.timer = 0;
        }
      } else if (s.carrying !== null) {
        // Phase 3 — perched: taunt until the clock runs out or the chase wins.
        const prevBounce = Math.floor(s.timer / 3);
        s.timer += dt;
        if (Math.floor(s.timer / 3) > prevBounce) taunted = true;
        s.heading = Math.atan2(env.player.x - s.x, env.player.z - s.z); // faces you, the cheek
        if (s.timer >= TAUNT_SECONDS || dist < CHASE_DROP_RADIUS) {
          dropped = { x: s.x, z: s.z, kind: s.carrying };
          s.carrying = null;
          s.mode = "flee";
          s.timer = 0;
        }
      } else {
        // Defensive: a heist with nothing to do resolves back to the troop.
        s.mode = "troop";
        s.timer = 0;
      }
      break;
    }
  }

  return { state: s, stolePlant, dropped, taunted };
}

// --- Geometry (procedural, zero asset bytes — the birds/jaguar idiom) -------

const FUR_DARK = 0x4a3423;
const FUR_FACE = 0xc9a876;
const FRUIT_COLORS: Record<FruitKind, number> = {
  berries: 0x7a2740,
  banana: 0xe8c93f,
  mango: 0xdd7a2e,
};

/** Torso + head with a lighter face patch + four stub limbs + a curled tail,
 *  merged to ONE geometry (~180 tris) — a capuchin silhouette, not a fur
 *  render. Local +Z is forward (the birds/fish convention). */
function buildMonkeyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const torso = stampVertexColor(new THREE.CapsuleGeometry(0.16, 0.28, 2, 6).rotateX(Math.PI / 2), FUR_DARK);
  torso.translate(0, 0.42, 0);
  parts.push(torso);
  const head = stampVertexColor(new THREE.SphereGeometry(0.13, 6, 5), FUR_DARK);
  head.translate(0, 0.62, 0.2);
  parts.push(head);
  const face = stampVertexColor(new THREE.SphereGeometry(0.085, 6, 5), FUR_FACE);
  face.translate(0, 0.6, 0.29);
  parts.push(face);
  for (const side of [-1, 1]) {
    const arm = stampVertexColor(new THREE.CylinderGeometry(0.035, 0.03, 0.3, 4), FUR_DARK);
    arm.translate(side * 0.14, 0.28, 0.14);
    parts.push(arm);
    const leg = stampVertexColor(new THREE.CylinderGeometry(0.04, 0.035, 0.32, 4), FUR_DARK);
    leg.translate(side * 0.11, 0.24, -0.16);
    parts.push(leg);
  }
  // The curled tail: three segments arcing up behind — the capuchin signature.
  const t1 = stampVertexColor(new THREE.CylinderGeometry(0.03, 0.026, 0.3, 4).rotateX(Math.PI / 3), FUR_DARK);
  t1.translate(0, 0.5, -0.38);
  const t2 = stampVertexColor(new THREE.CylinderGeometry(0.026, 0.022, 0.24, 4).rotateX(Math.PI / 8), FUR_DARK);
  t2.translate(0, 0.72, -0.46);
  const t3 = stampVertexColor(new THREE.CylinderGeometry(0.022, 0.016, 0.16, 4).rotateX(-Math.PI / 4), FUR_DARK);
  t3.translate(0, 0.86, -0.4);
  parts.push(t1, t2, t3);

  const merged = mergeOrThrow(parts);
  for (const g of parts) g.dispose();
  return merged;
}

/** Carried + dropped fruit share ONE small instanced sphere mesh; slots
 *  0..TROOP_SIZE-1 are the carry slots (scale 0 unless that monkey carries),
 *  the rest are ground drops. */
const MAX_DROPS = 4;

interface Drop {
  x: number;
  z: number;
  kind: FruitKind;
  ttl: number;
}

export class MonkeysSystem implements System {
  readonly id = "wildlife-monkeys";

  private readonly group = new THREE.Group();
  private readonly bodyGeo: THREE.BufferGeometry;
  private readonly fruitGeo: THREE.BufferGeometry;
  private readonly bodyMat: THREE.MeshStandardMaterial;
  private readonly fruitMat: THREE.MeshStandardMaterial;
  private readonly bodyMesh: THREE.InstancedMesh;
  private readonly fruitMesh: THREE.InstancedMesh;

  private states: MonkeyState[];
  private drops: Drop[] = [];
  /** Play-time clocks the system owns (BirdsSystem's own-clock convention). */
  private elapsed = 0;
  private stillSeconds = 0;
  private heistClock = FIRST_HEIST_HEAD_START;
  private thief = -1;
  /** Per-monkey "actually displaced this frame" — the hop belongs to
   *  movement; an idle monkey sits still instead of bouncing forever. */
  private readonly moved: boolean[] = new Array(TROOP_SIZE).fill(false);

  /** Drained one-shot edges for the audio slice (PR III). */
  private stoleEdge = false;
  private tauntEdge = false;
  private dropEdge = false;

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly sc = new THREE.Vector3(1, 1, 1);
  private readonly posv = new THREE.Vector3();
  private readonly euler = new THREE.Euler();
  private readonly tint = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private readonly terrain: Terrain,
    private readonly waterDepthAt: WaterDepthAt,
    private readonly player: PositionSource,
    private readonly session: PauseSource,
    private readonly heist: HeistSeam,
    private readonly reducedMotion?: ReducedMotionSource,
  ) {
    this.group.name = "wildlife-monkeys";
    this.bodyGeo = buildMonkeyGeometry();
    this.fruitGeo = new THREE.SphereGeometry(0.11, 6, 5);
    this.bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
    this.fruitMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.7 });
    this.bodyMesh = new THREE.InstancedMesh(this.bodyGeo, this.bodyMat, TROOP_SIZE);
    this.fruitMesh = new THREE.InstancedMesh(this.fruitGeo, this.fruitMat, TROOP_SIZE + MAX_DROPS);
    this.bodyMesh.name = "wildlife-monkey-body";
    this.fruitMesh.name = "wildlife-monkey-fruit";
    // Instances roam the island; a unit bounding sphere would cull them wrong.
    this.bodyMesh.frustumCulled = false;
    this.fruitMesh.frustumCulled = false;
    this.group.add(this.bodyMesh, this.fruitMesh);
    scene.add(this.group);

    this.states = Array.from({ length: TROOP_SIZE }, (_, i) => initialMonkeyState(i));
  }

  update(ctx: FrameContext): void {
    if (this.session.paused) return;
    this.elapsed += ctx.dt;

    const p = this.player.state.position;
    const speed = this.player.state.speed;
    this.stillSeconds = speed < 0.3 ? this.stillSeconds + ctx.dt : 0;
    const timing = this.reducedMotion?.getSnapshot().reducedMotion ? PLAIN_TIMING : COMIC_TIMING;

    // --- The heist director: pace, elect, assign -------------------------
    const heistInProgress = this.thief >= 0;
    if (!heistInProgress) this.heistClock += ctx.dt;
    const playerInCamp = Math.hypot(p.x - SPAWN.x, p.z - SPAWN.z) < CAMP_SANCTUARY;
    if (!heistInProgress && this.heistClock >= HEIST_MIN_GAP && !playerInCamp) {
      const plantIndex = this.nearestRipePlant(p.x, p.z);
      let assigned = false;
      if (plantIndex >= 0) {
        const plant = this.heist.plants[plantIndex];
        // Only a monkey with a dry line to the plant can take the job — a
        // thief across the river would swim (or stall against the bank).
        const eligible = this.states.map((s) =>
          dryPath(s.x, s.z, plant.x, plant.z, this.waterDepthAt),
        );
        const idx = electThief(this.states, plant, eligible);
        if (idx >= 0) {
          this.states[idx] = {
            ...this.states[idx],
            mode: "heist",
            heistTarget: { x: plant.x, z: plant.z, kind: plant.kind, plantIndex },
            timer: 0,
          };
          this.thief = idx;
          assigned = true;
        }
      }
      if (!assigned && this.heistClock >= HEIST_MAX_WAIT) {
        // Starved for a mark (no plant near, or nobody can reach it): drift
        // each monkey toward its OWN bank's anchor nearest the player so the
        // next encounter actually happens.
        for (let i = 0; i < this.states.length; i++) {
          if (this.states[i].mode === "troop") {
            const bankAnchors = TROOP_BANKS[this.states[i].bank];
            // Fresh dwell too, or a stale clock bounces the monkey straight
            // past the retargeted anchor (review finding).
            this.states[i] = {
              ...this.states[i],
              anchor: nearestAnchor(p.x, p.z, bankAnchors),
              dwell: 0,
            };
          }
        }
        this.heistClock = HEIST_MIN_GAP; // re-check as soon as a plant is near
      }
    }

    // --- Step every monkey ------------------------------------------------
    const env: TroopEnv = {
      player: { x: p.x, z: p.z },
      playerSpeed: speed,
      // Curiosity is routed to ONE monkey (the nearest) so the whole troop
      // doesn't crowd a still player.
      playerStillSeconds: this.stillSeconds,
      waterDepthAt: this.waterDepthAt,
    };
    // The player may pick the very plant the thief is mid-flight toward
    // (forage runs earlier in the frame): the moment the mark goes bare, the
    // heist is off — no phantom fruit, no double meal, no stomped regrow
    // clock (review finding).
    if (this.thief >= 0) {
      const t = this.states[this.thief].heistTarget;
      if (t && t.plantIndex >= 0 && !this.heist.plants[t.plantIndex]?.ripe) {
        this.states[this.thief] = {
          ...this.states[this.thief],
          mode: "flee", // slinks off empty-handed — its own small gag
          heistTarget: null,
          carrying: null,
          timer: 0,
        };
        this.thief = -1;
        this.heistClock = 0;
      }
    }

    const nearestIdx = this.nearestMonkeyTo(p.x, p.z);
    for (let i = 0; i < this.states.length; i++) {
      const perMonkeyEnv =
        i === nearestIdx ? env : { ...env, playerStillSeconds: 0 };
      const prevX = this.states[i].x;
      const prevZ = this.states[i].z;
      const r = stepMonkey(this.states[i], ctx.dt, perMonkeyEnv, timing);
      this.states[i] = r.state;
      this.moved[i] = Math.hypot(r.state.x - prevX, r.state.z - prevZ) > 1e-4;

      if (r.stolePlant !== null && r.stolePlant >= 0) {
        const plant = this.heist.plants[r.stolePlant];
        // Same-frame arrival guard (belt to the pre-step braces above).
        if (!plant.ripe) {
          this.states[i] = { ...this.states[i], mode: "flee", heistTarget: null, carrying: null, timer: 0 };
          this.thief = -1;
          this.heistClock = 0;
          continue;
        }
        plant.ripe = false;
        plant.regrowIn = FORAGE_TUNE.regrowSeconds;
        this.heist.setRipe(r.stolePlant, false);
        this.stoleEdge = true;
      }
      if (r.taunted) this.tauntEdge = true;
      if (r.dropped) {
        if (this.drops.length < MAX_DROPS) {
          this.drops.push({ ...r.dropped, ttl: DROP_TTL });
        }
        this.dropEdge = true;
        this.thief = -1;
        this.heistClock = 0;
      }
    }
    // A thief that resolved without a drop (defensive path) frees the slot.
    if (this.thief >= 0 && this.states[this.thief].mode !== "heist") {
      this.thief = -1;
      this.heistClock = 0;
    }

    // --- Dropped fruit: TTL + walk-over scoop ------------------------------
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.ttl -= ctx.dt;
      if (d.ttl <= 0) {
        this.drops.splice(i, 1);
        continue;
      }
      if (Math.hypot(p.x - d.x, p.z - d.z) <= PICKUP_RADIUS) {
        this.heist.creditEat(d.kind);
        this.drops.splice(i, 1);
      }
    }

    this.upload();
  }

  private nearestRipePlant(x: number, z: number): number {
    let best = -1;
    let bestDist = HEIST_SEEK_RADIUS;
    for (let i = 0; i < this.heist.plants.length; i++) {
      const pl = this.heist.plants[i];
      if (!pl.ripe) continue;
      const d = Math.hypot(x - pl.x, z - pl.z);
      if (d < bestDist) {
        best = i;
        bestDist = d;
      }
    }
    return best;
  }

  private nearestMonkeyTo(x: number, z: number): number {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.states.length; i++) {
      const d = Math.hypot(x - this.states[i].x, z - this.states[i].z);
      if (d < bestDist) {
        best = i;
        bestDist = d;
      }
    }
    return best;
  }

  private upload(): void {
    for (let i = 0; i < this.states.length; i++) {
      const s = this.states[i];
      const ground = this.terrain.heightAt(s.x, s.z);
      // The hop belongs to actual travel — a dwelling monkey sits calm, so
      // the freeze-beat and the taunt-bounce read against stillness.
      const hop = this.moved[i] ? hopPose(this.elapsed, i * 1.9) : 0;
      // Perched taunt: a big cheeky bounce instead of the travel hop.
      const tauntBounce =
        s.mode === "heist" && s.heistTarget === null && s.carrying !== null
          ? Math.abs(Math.sin(this.elapsed * 6)) * 0.5
          : 0;
      // Curious head-tilt: the whole body cocks side to side — cheap and it reads.
      const tilt = s.mode === "curious" ? Math.sin(this.elapsed * 1.8) * 0.22 : 0;

      this.posv.set(s.x, ground + hop + tauntBounce, s.z);
      this.euler.set(0, s.heading, tilt);
      this.q.setFromEuler(this.euler);
      this.m.compose(this.posv, this.q, this.sc);
      this.bodyMesh.setMatrixAt(i, this.m);

      // Carry slot i: the fruit rides at head height, hidden (scale 0) otherwise.
      const carryScale = s.carrying ? 1 : 0;
      this.posv.set(s.x, ground + hop + tauntBounce + 0.72, s.z);
      this.sc.setScalar(carryScale || 1e-6);
      this.m.compose(this.posv, this.q, this.sc);
      this.fruitMesh.setMatrixAt(i, this.m);
      if (s.carrying) this.fruitMesh.setColorAt(i, this.tint.setHex(FRUIT_COLORS[s.carrying]));
      this.sc.setScalar(1);
    }

    // Ground drops in the remaining fruit slots.
    for (let d = 0; d < MAX_DROPS; d++) {
      const slot = TROOP_SIZE + d;
      const drop = this.drops[d];
      if (drop) {
        this.posv.set(drop.x, this.terrain.heightAt(drop.x, drop.z) + 0.1, drop.z);
        this.sc.setScalar(1);
        this.fruitMesh.setColorAt(slot, this.tint.setHex(FRUIT_COLORS[drop.kind]));
      } else {
        this.posv.set(0, -100, 0);
        this.sc.setScalar(1e-6);
      }
      this.q.identity();
      this.m.compose(this.posv, this.q, this.sc);
      this.fruitMesh.setMatrixAt(slot, this.m);
      this.sc.setScalar(1);
    }

    this.bodyMesh.instanceMatrix.needsUpdate = true;
    this.fruitMesh.instanceMatrix.needsUpdate = true;
    if (this.fruitMesh.instanceColor) this.fruitMesh.instanceColor.needsUpdate = true;
  }

  /** Respawn seam: the troop goes back to its own life; carried fruit is lost
   *  to the jungle (the plant's regrow clock keeps running — honest theft). */
  reset(): void {
    this.states = Array.from({ length: TROOP_SIZE }, (_, i) => initialMonkeyState(i));
    this.drops = [];
    this.thief = -1;
    this.heistClock = FIRST_HEIST_HEAD_START;
    this.moved.fill(false);
    this.upload();
  }

  /** Drained one-shot edges — the audio system polls these (PR III). */
  justStole(): boolean {
    const e = this.stoleEdge;
    this.stoleEdge = false;
    return e;
  }
  justTaunted(): boolean {
    const e = this.tauntEdge;
    this.tauntEdge = false;
    return e;
  }
  justDropped(): boolean {
    const e = this.dropEdge;
    this.dropEdge = false;
    return e;
  }

  describe(): Record<string, unknown> {
    return {
      modes: this.states.map((s) => s.mode),
      positions: this.states.map((s) => ({ x: s.x, z: s.z })),
      heisting: this.thief >= 0,
      thief: this.thief,
      carrying: this.states.filter((s) => s.carrying !== null).length,
      drops: this.drops.map((d) => ({ x: d.x, z: d.z })),
    };
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    this.bodyMesh.dispose();
    this.fruitMesh.dispose();
    this.bodyGeo.dispose();
    this.fruitGeo.dispose();
    this.bodyMat.dispose();
    this.fruitMat.dispose();
  }
}
