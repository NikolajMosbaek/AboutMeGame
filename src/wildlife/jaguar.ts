// The jaguar (owner note 2026-07-10: "a deadly animal") — ONE stalking
// predator patrolling the deep-jungle west valley and the northern highland,
// far from camp and lagoon. Unlike the snakes (fixed ambush points), it hunts:
// prowl → stalk (shadows you at 15–25 u, a low growl announces it) → charge
// (a ~9 m/s lunge once it has stalked long enough and you're close) → strike
// (hurt(45)) → retreat — hit-and-run: it melts back into its territory for a
// ~90 s cooldown. You always have outs: reach the camp clearing, wade into
// water, or open 60+ u of distance and it breaks off. At night it's bolder.
//
// All hunting math is pure (`stepJaguar`, headless-tested); `JaguarSystem`
// only owns the two-draw-call mesh (merged body + emissive night eyes), the
// terrain clamp and the injected `hurt` seam — same split as snakes.ts.

import * as THREE from "three";
import type { FrameContext, System } from "../engine/types.ts";
import type { Terrain } from "../world/terrain.ts";
import { POI_ANCHORS, WORLD } from "../world/worldConfig.ts";
import { hash2, mergeOrThrow, mottleFaces, stampVertexColor } from "./geometry.ts";

/** Where the player is — the explorer satisfies it via `state.position`. */
export interface PositionSource {
  readonly state: { position: THREE.Vector3 };
}

/** Hold all movement while true — the shared session pause flag satisfies it. */
export interface PauseSource {
  readonly paused: boolean;
}

/** Deal damage to the player — `game.survival.hurt` satisfies it (the same
 *  plain-callback seam the snakes use). */
export type HurtFn = (amount: number) => void;

/** The day-cycle phase accessor — `World.dayCycle` satisfies it (same seam as
 *  FliersSystem). */
export interface DayCycleSource {
  getPhase(): number;
}

/** Still-water depth at a ground point (`<= 0` = dry) — `World.waterDepthAt`. */
export type WaterDepthAt = (x: number, z: number) => number;

// --- Tuning ------------------------------------------------------------------

/** Player inside this range (daytime) makes the jaguar start stalking. */
export const STALK_RANGE = 45;
/** At night the jungle is its element: stalk range grows by this factor. */
export const NIGHT_BOLDNESS = 1.3;
/** While stalking it shadows the player inside this distance band. */
export const SHADOW_MIN = 15;
export const SHADOW_MAX = 25;
/** Charge only after at least this long spent stalking… */
export const STALK_MIN_SECONDS = 4;
/** …and only once the player is within this range. */
export const CHARGE_RANGE = 12;
/** Contact distance: the strike lands, then it's gone. */
export const STRIKE_RADIUS = 1.8;
export const STRIKE_DAMAGE = 45;
/** Hit-and-run: after a strike it keeps to its territory this long. */
export const STRIKE_COOLDOWN = 90;
/** Beyond this distance to the player, any hunt breaks off. */
export const BREAK_OFF_DIST = 60;
/** Movement speeds (m/s) per mode. The charge outruns a sprinting player. */
export const PROWL_SPEED = 1.6;
export const STALK_SPEED = 3.5;
export const CHARGE_SPEED = 9;
export const RETREAT_SPEED = 6;
/** It never sets foot inside twice the camp's cleared radius… */
export const CAMP_EXCLUSION = WORLD.campClearRadius * 2;
/** …or in water deeper than a wade (matches the explorer's wade threshold in
 *  player/explorer.ts TUNE.wadeDepth — cats don't swim rivers). */
export const WADE_DEPTH = 0.35;
/** Close enough to a territory waypoint to move on to the next. */
const WAYPOINT_REACHED = 3;

/**
 * Territory waypoints: the deep-jungle west valley (around the lost
 * expedition's last camp) and the northern highland — the island's far
 * country, nowhere near the base camp (−28, 126) or the lagoon (0, 142), and
 * all west/east of the river course rather than on it.
 */
export const TERRITORY: ReadonlyArray<{ x: number; z: number }> = [
  { x: -70, z: -30 },
  { x: -88, z: -62 },
  { x: -48, z: -84 },
  { x: 46, z: -120 },
  { x: 64, z: -94 },
  { x: -54, z: -6 },
];

/** 0 = full day (noon) … 1 = full night, the same cosine the fliers crossfade
 *  by; "night" for boldness/eyes is the darkest half of the loop. */
export function nightWeight(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  return (1 - Math.cos((p - 0.25) * Math.PI * 2)) / 2;
}

export function isNightPhase(phase: number): boolean {
  return nightWeight(phase) > 0.5;
}

export type JaguarMode = "prowl" | "stalk" | "charge" | "retreat" | "startled";

/** The snake double-take (J1 #221): a stalk that carries the cat within this
 *  of any snake breaks into a freeze-beat, an ignominious bolt, and a LONG
 *  cooldown — the apex predator's one humiliation. A committed charge is
 *  never interrupted: comedy must not rescue the player mid-pounce. */
export const SNAKE_SCARE_RADIUS = 5;
export const STARTLE_FREEZE = 0.5;
export const STARTLE_BOLT_SECONDS = 2.5;
export const STARTLED_COOLDOWN = 45;
const BOLT_SPEED_MULT = 1.4;

export interface JaguarState {
  mode: JaguarMode;
  x: number;
  z: number;
  /** Facing (radians; rotation.y for a +X-forward body). */
  heading: number;
  /** Seconds spent in the current stalk. */
  stalkSeconds: number;
  /** Seconds until it may hunt again (ticks down in every mode). */
  cooldown: number;
  /** Current prowl waypoint index into {@link TERRITORY}. */
  waypoint: number;
}

/** Deterministic spawn: the first territory waypoint, heading for the second —
 *  identical on every load, no randomness anywhere in the hunt. */
export function initialJaguarState(): JaguarState {
  return {
    mode: "prowl",
    x: TERRITORY[0].x,
    z: TERRITORY[0].z,
    heading: 0,
    stalkSeconds: 0,
    cooldown: 0,
    waypoint: 1,
  };
}

/** Everything the hunt reads about the world this frame. */
export interface JaguarEnv {
  player: { x: number; z: number };
  isNight: boolean;
  waterDepthAt: WaterDepthAt;
  /** The camp clearing's centre (the base-camp anchor). */
  camp: { x: number; z: number };
  /** Where the snakes coil (J1 #221) — optional so pre-J1 rigs are unchanged. */
  snakes?: ReadonlyArray<{ x: number; z: number }>;
  /** The freeze-beat length; reduced motion passes 0. */
  startleFreeze?: number;
}

export interface JaguarStepResult {
  state: JaguarState;
  /** True the instant this step lands the strike — the caller feeds it into
   *  `hurt(STRIKE_DAMAGE)`, once per hit-and-run cycle. */
  struck: boolean;
  /** True exactly on the transition INTO `startled` — the yelp's audio edge. */
  startled: boolean;
}

function nearestSnakeDist(
  x: number,
  z: number,
  snakes: ReadonlyArray<{ x: number; z: number }> | undefined,
): { dist: number; snake: { x: number; z: number } | null } {
  if (!snakes || snakes.length === 0) return { dist: Infinity, snake: null };
  let best = Infinity;
  let bestSnake = snakes[0];
  for (const sn of snakes) {
    const d = Math.hypot(x - sn.x, z - sn.z);
    if (d < best) {
      best = d;
      bestSnake = sn;
    }
  }
  return { dist: best, snake: bestSnake };
}

/** Ground the jaguar refuses to step on: deep water, or the camp's wider
 *  exclusion ring. */
function forbidden(x: number, z: number, env: JaguarEnv): boolean {
  if (env.waterDepthAt(x, z) > WADE_DEPTH) return true;
  return Math.hypot(x - env.camp.x, z - env.camp.z) < CAMP_EXCLUSION;
}

/** The player has reached safety: the camp clearing itself, or wading water —
 *  both end any hunt on the spot (and prevent one starting). */
function playerSafe(env: JaguarEnv): boolean {
  if (Math.hypot(env.player.x - env.camp.x, env.player.z - env.camp.z) <= WORLD.campClearRadius) {
    return true;
  }
  return env.waterDepthAt(env.player.x, env.player.z) > WADE_DEPTH;
}

/** Move `speed·dt` toward the target unless the step lands on forbidden
 *  ground; always faces the target. Returns whether it actually moved. */
function stepToward(
  s: { x: number; z: number; heading: number },
  tx: number,
  tz: number,
  speed: number,
  dt: number,
  env: JaguarEnv,
): boolean {
  const dx = tx - s.x;
  const dz = tz - s.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return false;
  s.heading = Math.atan2(-dz, dx);
  const step = Math.min(len, speed * dt);
  const nx = s.x + (dx / len) * step;
  const nz = s.z + (dz / len) * step;
  if (forbidden(nx, nz, env)) return false;
  s.x = nx;
  s.z = nz;
  return true;
}

function nearestWaypoint(x: number, z: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < TERRITORY.length; i++) {
    const d = Math.hypot(x - TERRITORY[i].x, z - TERRITORY[i].z);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/**
 * Advance the hunt by `dt`. Pure: same state + env in, same result out —
 * `struck` is a return value, never a side effect (the snakes' testability
 * posture). One call per frame from `JaguarSystem.update`.
 */
export function stepJaguar(state: JaguarState, dt: number, env: JaguarEnv): JaguarStepResult {
  const s: JaguarState = { ...state, cooldown: Math.max(0, state.cooldown - dt) };
  const dist = Math.hypot(env.player.x - s.x, env.player.z - s.z);
  const safe = playerSafe(env);
  const stalkRange = STALK_RANGE * (env.isNight ? NIGHT_BOLDNESS : 1);
  let struck = false;
  let startled = false;

  switch (s.mode) {
    case "prowl": {
      if (s.cooldown <= 0 && !safe && dist <= stalkRange) {
        s.mode = "stalk";
        s.stalkSeconds = 0;
        break;
      }
      const wp = TERRITORY[s.waypoint];
      const reached = Math.hypot(s.x - wp.x, s.z - wp.z) <= WAYPOINT_REACHED;
      const moved = reached ? false : stepToward(s, wp.x, wp.z, PROWL_SPEED, dt, env);
      if (reached || !moved) s.waypoint = (s.waypoint + 1) % TERRITORY.length;
      break;
    }

    case "stalk": {
      // The double-take: a snake underfoot outranks everything else in a
      // stalk (never a charge — that pounce is committed).
      const scare = nearestSnakeDist(s.x, s.z, env.snakes);
      if (scare.dist < SNAKE_SCARE_RADIUS) {
        s.mode = "startled";
        s.stalkSeconds = 0; // reused as the startle clock
        startled = true;
        break;
      }
      if (safe || dist > BREAK_OFF_DIST) {
        s.mode = "prowl";
        break;
      }
      s.stalkSeconds += dt;
      if (s.stalkSeconds >= STALK_MIN_SECONDS && dist <= CHARGE_RANGE) {
        s.mode = "charge";
        break;
      }
      // Shadow the player: close to the band from outside, back off inside it.
      if (dist > SHADOW_MAX) {
        stepToward(s, env.player.x, env.player.z, STALK_SPEED, dt, env);
      } else if (dist < SHADOW_MIN) {
        const away = { x: 2 * s.x - env.player.x, z: 2 * s.z - env.player.z };
        stepToward(s, away.x, away.z, STALK_SPEED, dt, env);
        s.heading = Math.atan2(-(env.player.z - s.z), env.player.x - s.x); // eyes on you
      } else {
        s.heading = Math.atan2(-(env.player.z - s.z), env.player.x - s.x);
      }
      break;
    }

    case "charge": {
      if (safe || dist > BREAK_OFF_DIST) {
        s.mode = "prowl";
        break;
      }
      if (dist <= STRIKE_RADIUS) {
        // The strike: one hit, then it's gone — hit-and-run.
        struck = true;
        s.cooldown = STRIKE_COOLDOWN;
        s.mode = "retreat";
        break;
      }
      stepToward(s, env.player.x, env.player.z, CHARGE_SPEED, dt, env);
      break;
    }

    case "startled": {
      const freeze = env.startleFreeze ?? STARTLE_FREEZE;
      s.stalkSeconds += dt;
      if (s.stalkSeconds <= freeze) {
        // The held "…!" beat: dead still, eyes locked on the snake.
        const scare = nearestSnakeDist(s.x, s.z, env.snakes);
        if (scare.snake) {
          s.heading = Math.atan2(-(scare.snake.z - s.z), scare.snake.x - s.x);
        }
        break;
      }
      if (s.stalkSeconds >= freeze + STARTLE_BOLT_SECONDS) {
        s.mode = "prowl";
        s.waypoint = nearestWaypoint(s.x, s.z);
        s.cooldown = STARTLED_COOLDOWN; // no hunting for a good while — shame
        break;
      }
      // The bolt: directly away from the snake, faster than its own charge.
      // A bolt into forbidden ground (river, camp ring) falls back to
      // away-from-the-player; if that's blocked too, the startle resolves
      // early — a rooted 2.5 s statue is a hang, not a gag (review finding).
      const scare = nearestSnakeDist(s.x, s.z, env.snakes);
      const from = scare.snake ?? env.player;
      const away = { x: 2 * s.x - from.x, z: 2 * s.z - from.z };
      if (!stepToward(s, away.x, away.z, CHARGE_SPEED * BOLT_SPEED_MULT, dt, env)) {
        const alt = { x: 2 * s.x - env.player.x, z: 2 * s.z - env.player.z };
        if (!stepToward(s, alt.x, alt.z, CHARGE_SPEED * BOLT_SPEED_MULT, dt, env)) {
          s.mode = "prowl";
          s.waypoint = nearestWaypoint(s.x, s.z);
          s.cooldown = STARTLED_COOLDOWN;
        }
      }
      break;
    }

    case "retreat": {
      const home = TERRITORY[nearestWaypoint(s.x, s.z)];
      const homeDist = Math.hypot(s.x - home.x, s.z - home.z);
      if (homeDist <= WAYPOINT_REACHED) {
        s.mode = "prowl";
        s.waypoint = nearestWaypoint(s.x, s.z);
        break;
      }
      stepToward(s, home.x, home.z, RETREAT_SPEED, dt, env);
      break;
    }
  }

  return { state: s, struck, startled };
}

// --- Geometry / system --------------------------------------------------------

const BODY_COLOR = 0x8a5a24; // dark amber
/** Seeded blotches over the coat (chest/hip lobes only) — cheap, construction-
 *  time-only rosette suggestion via {@link mottleFaces}, never a texture. */
const ROSETTE_COLOR = 0x4a3115;
/** Lower legs (the "shin" segment) a touch darker than the coat — reads as a
 *  big cat's dark forepaws/socks without any extra geometry. */
const PAW_COLOR = 0x5c3d1a;
const EYE_COLOR = 0xffc94d;
/** Above the compositor's 0.85 bloom threshold at night — two points of fire
 *  in the dark; near-off by day. */
export const EYE_NIGHT_EMISSIVE = 2.2;
export const EYE_DAY_EMISSIVE = 0.15;

/**
 * Chest lobe + hip lobe (a tapered torso, not one uniform barrel) + a
 * distinct skull/muzzle/ear head + a 3-segment curving tail + 4 two-part
 * (thigh+shin) legs, merged to ONE geometry (one draw call) — Objects slice 2
 * ("make the wildlife look like what it really is"): the prior single-
 * dodecahedron torso + one box head read as a generic quadruped blob; this
 * upgrade gives the jaguar a low-slung, tapered big-cat silhouette (wider
 * chest than hip), a protruding muzzle distinct from the skull, a curved
 * tail instead of a straight stick, and seeded rosette blotches
 * ({@link mottleFaces} + {@link hash2}, construction-time only, zero runtime
 * cost) over the coat. No CC0 jaguar/big-cat model was found through this
 * codebase's own scriptable-download conventions (poly.pizza gates its API
 * behind a paid key and mixes per-model licences; Kenney's "Animal Pack" is a
 * 2D icon set, not 3D; Quaternius's own site funnels every download through a
 * Google Drive folder — the exact scriptability dead end `floraGlb.ts`'s own
 * header doc already records; Quaternius's itch.io mirrors ARE scriptable
 * through the browse/csrf/signed-download-page flow, but list only farm-
 * animal packs, no jungle cat), so this is a substantial PROCEDURAL upgrade,
 * per the slice's own "upgrade the procedural bodies where sourcing fails"
 * licence. Forward stays local +X — every hunt/heading convention in
 * {@link stepJaguar} is untouched by this purely visual change.
 */
function buildJaguarBodyGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const baseColor = new THREE.Color(BODY_COLOR);
  const rosetteColor = new THREE.Color(ROSETTE_COLOR);

  // Torso: two overlapping lobes tapering shoulder → hip. Each lobe is
  // stamped + rosette-mottled on its OWN (already-placed) geometry before the
  // final merge, so the blotchy pattern reads as scattered rosettes rather
  // than one smooth gradient across the whole body.
  const chest = stampVertexColor(new THREE.DodecahedronGeometry(0.46), BODY_COLOR);
  chest.scale(1.05, 0.72, 0.66);
  chest.translate(0.3, 0.64, 0);
  mottleFaces(chest, baseColor, rosetteColor, (cx, cy, cz) =>
    hash2(Math.round(cx * 6), Math.round(cy * 6 + cz * 6)) > 0.62 ? 1 : 0,
  );
  parts.push(chest);

  const hip = stampVertexColor(new THREE.DodecahedronGeometry(0.4), BODY_COLOR);
  hip.scale(0.9, 0.62, 0.58);
  hip.translate(-0.58, 0.58, 0);
  mottleFaces(hip, baseColor, rosetteColor, (cx, cy, cz) =>
    hash2(Math.round(cx * 6) + 11, Math.round(cy * 6 + cz * 6) + 7) > 0.62 ? 1 : 0,
  );
  parts.push(hip);

  // Head: a distinct skull + a narrower, protruding muzzle (the old single
  // box head was the least cat-like part of the prior silhouette) + two
  // small ears.
  const skull = stampVertexColor(new THREE.BoxGeometry(0.34, 0.3, 0.34), BODY_COLOR);
  skull.translate(1.0, 0.78, 0);
  parts.push(skull);
  const muzzle = stampVertexColor(new THREE.BoxGeometry(0.22, 0.2, 0.24), BODY_COLOR);
  muzzle.translate(1.24, 0.72, 0);
  parts.push(muzzle);
  for (const ez of [0.13, -0.13]) {
    const ear = stampVertexColor(new THREE.ConeGeometry(0.09, 0.16, 4), BODY_COLOR);
    ear.rotateX(ez > 0 ? -0.3 : 0.3);
    ear.translate(0.92, 0.98, ez);
    parts.push(ear);
  }

  // Tail: three tapering, progressively-curved segments — the old single
  // straight cylinder read as a stick; the upward curve reads as a real
  // cat's tail carriage.
  const tailSegments: Array<{ len: number; rBase: number; rTip: number; x: number; y: number; rot: number }> = [
    { len: 0.42, rBase: 0.075, rTip: 0.06, x: -1.0, y: 0.86, rot: 0.35 },
    { len: 0.36, rBase: 0.06, rTip: 0.045, x: -1.32, y: 1.0, rot: 0.75 },
    { len: 0.3, rBase: 0.045, rTip: 0.025, x: -1.56, y: 1.16, rot: 1.15 },
  ];
  for (const seg of tailSegments) {
    const segGeo = stampVertexColor(new THREE.CylinderGeometry(seg.rTip, seg.rBase, seg.len, 5), BODY_COLOR);
    segGeo.rotateZ(Math.PI / 2 - seg.rot);
    segGeo.translate(seg.x, seg.y, 0);
    parts.push(segGeo);
  }

  // Legs: thigh + shin per leg (a joint break, not one solid post) — front
  // legs straight (weight-bearing forelegs), hind legs offset forward at the
  // "knee" (a crouched hunting stance); the shin is the darker PAW_COLOR.
  const legs: Array<{ fx: number; fz: number; front: boolean }> = [
    { fx: 0.55, fz: 0.22, front: true },
    { fx: 0.55, fz: -0.22, front: true },
    { fx: -0.5, fz: 0.22, front: false },
    { fx: -0.5, fz: -0.22, front: false },
  ];
  for (const leg of legs) {
    const bendX = leg.front ? 0 : 0.12;
    const thigh = stampVertexColor(new THREE.BoxGeometry(0.15, 0.28, 0.15), BODY_COLOR);
    thigh.translate(leg.fx, 0.42, leg.fz);
    parts.push(thigh);
    const shin = stampVertexColor(new THREE.BoxGeometry(0.12, 0.28, 0.12), PAW_COLOR);
    shin.translate(leg.fx + bendX, 0.16, leg.fz);
    parts.push(shin);
  }

  const merged = mergeOrThrow(parts);
  for (const g of parts) g.dispose();
  return merged;
}

/** Two eye dots merged to one geometry — the second draw call, emissive.
 *  Positioned on the new skull's upper-front face (`buildJaguarBodyGeometry`'s
 *  skull is centred at x=1.0, the muzzle protrudes further to x=1.24). */
function buildJaguarEyesGeometry(): THREE.BufferGeometry {
  const left = new THREE.SphereGeometry(0.04, 5, 4);
  left.translate(1.13, 0.85, 0.11);
  const right = new THREE.SphereGeometry(0.04, 5, 4);
  right.translate(1.13, 0.85, -0.11);
  const merged = mergeOrThrow([left, right]);
  left.dispose();
  right.dispose();
  return merged;
}

/**
 * Two draw calls (merged body Mesh + emissive eyes Mesh) for the one jaguar —
 * within the wildlife per-creature cap with room to spare. The state machine
 * lives entirely in {@link stepJaguar}; this class clamps it to the terrain,
 * feeds `struck` into the injected `hurt`, and dims/fires the eyes with the
 * day phase.
 */
export class JaguarSystem implements System {
  readonly id = "wildlife-jaguar";

  private readonly group = new THREE.Group();
  private readonly bodyGeo: THREE.BufferGeometry;
  private readonly eyesGeo: THREE.BufferGeometry;
  private readonly bodyMat: THREE.MeshStandardMaterial;
  private readonly eyesMat: THREE.MeshStandardMaterial;
  private state: JaguarState = initialJaguarState();
  /** Set on the transition into `startled`; drained by {@link justStartled}. */
  private startledEdge = false;

  constructor(
    scene: THREE.Scene,
    private readonly terrain: Terrain,
    private readonly waterDepthAt: WaterDepthAt,
    private readonly dayCycle: DayCycleSource,
    private readonly player: PositionSource,
    private readonly session: PauseSource,
    private readonly hurt: HurtFn,
    /** The camp clearing's centre; defaults to the base-camp anchor. */
    private readonly camp: { x: number; z: number } = campAnchor(),
    /** Live snake placements for the double-take (J1 #221); optional. */
    private readonly snakePositions?: () => ReadonlyArray<{ x: number; z: number }>,
    /** Reduced motion collapses the startle's freeze-beat to zero. */
    private readonly reducedMotion?: { getSnapshot(): { reducedMotion: boolean } },
  ) {
    this.group.name = "wildlife-jaguar";
    this.bodyGeo = buildJaguarBodyGeometry();
    this.eyesGeo = buildJaguarEyesGeometry();
    this.bodyMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.85,
    });
    this.eyesMat = new THREE.MeshStandardMaterial({
      color: 0x120d04,
      emissive: new THREE.Color(EYE_COLOR),
      emissiveIntensity: EYE_DAY_EMISSIVE,
    });
    const body = new THREE.Mesh(this.bodyGeo, this.bodyMat);
    body.name = "wildlife-jaguar-body";
    body.castShadow = true;
    const eyes = new THREE.Mesh(this.eyesGeo, this.eyesMat);
    eyes.name = "wildlife-jaguar-eyes";
    this.group.add(body, eyes);
    scene.add(this.group);
    this.place();
  }

  update(ctx: FrameContext): void {
    if (this.session.paused) return; // hold the hunt with everything else

    const night = isNightPhase(this.dayCycle.getPhase());
    const p = this.player.state.position;
    const { state, struck, startled } = stepJaguar(this.state, ctx.dt, {
      player: { x: p.x, z: p.z },
      isNight: night,
      waterDepthAt: this.waterDepthAt,
      camp: this.camp,
      snakes: this.snakePositions?.(),
      startleFreeze: this.reducedMotion?.getSnapshot().reducedMotion ? 0 : undefined,
    });
    this.state = state;
    if (struck) this.hurt(STRIKE_DAMAGE);
    if (startled) this.startledEdge = true;

    this.eyesMat.emissiveIntensity = night ? EYE_NIGHT_EMISSIVE : EYE_DAY_EMISSIVE;
    this.place();
  }

  /** True once per snake double-take — drained on read (the yelp's audio
   *  edge, same polled posture as `snakes.anyAlert()`). */
  justStartled(): boolean {
    const e = this.startledEdge;
    this.startledEdge = false;
    return e;
  }

  private place(): void {
    this.group.position.set(
      this.state.x,
      this.terrain.heightAt(this.state.x, this.state.z),
      this.state.z,
    );
    this.group.rotation.y = this.state.heading;
  }

  /** True while it has committed to you (stalk or charge) — the audio slice's
   *  growl edge, polled like the snakes' `anyAlert()`. */
  isStalking(): boolean {
    return this.state.mode === "stalk" || this.state.mode === "charge";
  }

  describe(): Record<string, unknown> {
    return {
      jaguar: this.state.mode,
      at: { x: Math.round(this.state.x), z: Math.round(this.state.z) },
      cooldown: Math.round(this.state.cooldown),
    };
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    this.bodyGeo.dispose();
    this.eyesGeo.dispose();
    this.bodyMat.dispose();
    this.eyesMat.dispose();
  }
}

/** The base-camp anchor from the world config — the exclusion's centre. */
function campAnchor(): { x: number; z: number } {
  const camp = POI_ANCHORS.find((a) => a.archetype === "camp");
  if (!camp) throw new Error("jaguar: no camp anchor in POI_ANCHORS");
  return { x: camp.x, z: camp.z };
}
