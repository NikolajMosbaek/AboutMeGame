// Ambient jungle motes (visual-overhaul slice 7, polish) — pure placement and
// motion math for the drifting pollen/dust + occasional falling leaves that
// read the day-cycle's light filtering through the canopy gaps. Split out from
// `AmbientMotesSystem` (the thin GPU wiring) the same way `ambientMotes.ts`'s
// siblings do (`windSway.ts` ↔ `windPatch.ts`, `starfield.ts`'s own placement
// half) — every number here is headless-testable, no three/DOM needed.
//
// Both layers are CPU-animated (a rewritten Float32Array each frame), the
// `DiscoveryBurst`/`TreasureBurstSystem` idiom, NOT a vertex shader — this
// keeps `THREE.PointsMaterial`'s built-in `sizeAttenuation` for free and needs
// no GLSL for ~250 points, matching this team's "shaders sparingly" doctrine.
//
// Concentrated near where players actually look: the camp clearing (where
// every expedition starts and lingers) and the carved-overhang highland — a
// confirmed-dry jungle-interior site, away from the lagoon/river — rather than
// spread thin across the whole 520-unit island, where ~250 points would read
// as nothing.

import { SPAWN } from "../world/worldConfig.ts";

/** Dust/pollen motes in the cloud — within the design's 150-300 range. */
export const AMBIENT_MOTE_COUNT = 220;
/** Occasional falling leaves — a much smaller, slower-moving second layer. */
export const AMBIENT_LEAF_COUNT = 26;

/** A placement centre: motes/leaves scatter within `radius` of (x,z), weighted
 *  by `weight` (relative, not required to sum to 1). */
export interface MoteCenter {
  x: number;
  z: number;
  radius: number;
  weight: number;
}

/** The camp clearing (every expedition starts and lingers here) and the
 *  carved-overhang highland interior (confirmed dry land, well inland from
 *  the lagoon/river) — two real, land-confirmed jungle locations, not a
 *  uniform island-wide scatter. */
export const AMBIENT_CENTERS: readonly MoteCenter[] = [
  { x: SPAWN.x, z: SPAWN.z, radius: 20, weight: 0.6 },
  { x: 34, z: -104, radius: 26, weight: 0.4 },
];

/** Height band above the ground a dust mote drifts in — roughly the trunk/
 *  lower-canopy zone (`props.ts`'s `CANOPY_TRUNK_HEIGHT` is 6.2) where
 *  dappled sunbeams actually filter through the canopy gaps. */
export const MOTE_HEIGHT_MIN = 1.2;
export const MOTE_HEIGHT_MAX = 7.5;

/** Height a falling leaf drops from / respawns at, and the floor it wraps
 *  back up from — spans from just above the mote band to just above the
 *  ground. */
export const LEAF_FALL_TOP = 10.5;
export const LEAF_FALL_BOTTOM = 0.5;
const LEAF_FALL_RANGE = LEAF_FALL_TOP - LEAF_FALL_BOTTOM;

// --- Wrapped clock (float32-precision discipline, `windSystem.ts`/
// `starfield.ts`/`waterSystem.ts` precedent) ---------------------------------
//
// Unlike those systems, every mote/leaf position here is computed on the CPU
// in JS doubles (never fed to a GPU `uTime` uniform), which have far more
// headroom before losing precision than a shader's mediump float32 — the
// practical failure mode this discipline guards against is more remote here.
// The accumulator is still wrapped, matching this codebase's clock
// convention and keeping it bounded across a very long-lived tab. The period
// is picked FORWARD (unlike `STAR_WRAP_PERIOD`'s reverse GCD derivation): fix
// `WRAP_CYCLES`, then derive every sine rate as `n / WRAP_CYCLES` for a chosen
// integer `n` — `rate * PERIOD = 2π·n` is an exact multiple of 2π by
// construction, so every drift/bob/sway sine closes on a whole cycle at the
// wrap with no reverse-engineering needed.
const WRAP_CYCLES = 1000;
export const AMBIENT_WRAP_PERIOD = 2 * Math.PI * WRAP_CYCLES; // ≈ 6283.2 s (~1h45m)

/** rad/s a mote drifts horizontally around its seed point. */
export const MOTE_DRIFT_RATE = 500 / WRAP_CYCLES; // 0.5
/** rad/s a mote bobs vertically. */
export const MOTE_BOB_RATE = 350 / WRAP_CYCLES; // 0.35
/** rad/s a falling leaf sways horizontally. */
export const LEAF_SWAY_RATE = 400 / WRAP_CYCLES; // 0.4

/** How many full leaf-fall cycles complete per wrap period — chosen so the
 *  derived {@link LEAF_FALL_SPEED} lands close to a natural ~20 s fall
 *  (`LEAF_FALL_RANGE / desired-fall-seconds ≈ 0.5` units/s) while closing
 *  exactly (up to double-precision rounding) on the wrap, the same "pick the
 *  cycle count, derive the rate" method the sines above use. */
const LEAF_FALL_CYCLES = 314;
export const LEAF_FALL_SPEED = (LEAF_FALL_CYCLES * LEAF_FALL_RANGE) / AMBIENT_WRAP_PERIOD;

/** Small deterministic seeded hash — mirrors `starfield.ts`'s/`noise.ts`'s
 *  integer-mix idiom, inlined here so this module stays single-file with no
 *  shared RNG dependency (the established per-file convention). */
function hash(i: number, salt: number): number {
  let h = Math.imul(i | 0, 374761393) + Math.imul(salt | 0, 668265263) + 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Pick a centre for seed index `i`, weighted by `weight` (a cumulative-
 *  weight draw over the fixed, small `centers` list). */
function pickCenter(centers: readonly MoteCenter[], i: number, salt: number): MoteCenter {
  const total = centers.reduce((s, c) => s + c.weight, 0);
  let r = hash(i, salt) * total;
  for (const c of centers) {
    if (r < c.weight) return c;
    r -= c.weight;
  }
  return centers[centers.length - 1];
}

/** A dust/pollen mote's fixed identity: its ground-level seed point (already
 *  offset within its centre's radius) and drift/bob phases. */
export interface MoteSeed {
  baseX: number;
  baseY: number;
  baseZ: number;
  phaseDrift: number;
  phaseBob: number;
  driftRadius: number;
}

/** Ground height sampler — `Terrain.heightAt`'s shape, injected so this module
 *  stays pure/three-free. */
export type HeightAt = (x: number, z: number) => number;

/** Deterministically seed `count` motes across `centers`, sampling ground
 *  height via `heightAt` so each mote's base sits just above real terrain. */
export function buildMoteSeeds(
  count: number,
  centers: readonly MoteCenter[],
  heightAt: HeightAt,
): MoteSeed[] {
  const seeds: MoteSeed[] = [];
  for (let i = 0; i < count; i++) {
    const center = pickCenter(centers, i, 11);
    const angle = hash(i, 13) * Math.PI * 2;
    const radius = Math.sqrt(hash(i, 17)) * center.radius; // uniform over the disc
    const x = center.x + Math.cos(angle) * radius;
    const z = center.z + Math.sin(angle) * radius;
    const ground = heightAt(x, z);
    seeds.push({
      baseX: x,
      baseY: ground + MOTE_HEIGHT_MIN + hash(i, 19) * (MOTE_HEIGHT_MAX - MOTE_HEIGHT_MIN),
      baseZ: z,
      phaseDrift: hash(i, 23) * Math.PI * 2,
      phaseBob: hash(i, 29) * Math.PI * 2,
      driftRadius: 0.6 + hash(i, 31) * 0.9,
    });
  }
  return seeds;
}

/** World position of mote `seed` at (wrapped) time `t`. A slow circular drift
 *  in XZ plus an independent vertical bob — small amplitudes, so it reads as
 *  suspended dust catching air currents, not a bouncing object. */
export function motePosition(seed: MoteSeed, t: number): { x: number; y: number; z: number } {
  return {
    x: seed.baseX + Math.cos(t * MOTE_DRIFT_RATE + seed.phaseDrift) * seed.driftRadius,
    y: seed.baseY + Math.sin(t * MOTE_BOB_RATE + seed.phaseBob) * 0.5,
    z: seed.baseZ + Math.sin(t * MOTE_DRIFT_RATE + seed.phaseDrift) * seed.driftRadius,
  };
}

/** A falling leaf's fixed identity: its ground-level XZ seed, sway phase, and
 *  a per-leaf fall offset so the layer doesn't reset in lockstep. */
export interface LeafSeed {
  baseX: number;
  baseZ: number;
  phaseSway: number;
  fallOffset: number;
}

/** Deterministically seed `count` falling leaves across `centers`. Leaves have
 *  no ground-height dependency (their Y is the fall band itself, relative to
 *  world Y=terrain-local — `AmbientMotesSystem` adds the local ground offset). */
export function buildLeafSeeds(count: number, centers: readonly MoteCenter[]): LeafSeed[] {
  const seeds: LeafSeed[] = [];
  for (let i = 0; i < count; i++) {
    const center = pickCenter(centers, i, 41);
    const angle = hash(i, 43) * Math.PI * 2;
    const radius = Math.sqrt(hash(i, 47)) * center.radius;
    seeds.push({
      baseX: center.x + Math.cos(angle) * radius,
      baseZ: center.z + Math.sin(angle) * radius,
      phaseSway: hash(i, 53) * Math.PI * 2,
      fallOffset: hash(i, 59) * LEAF_FALL_RANGE,
    });
  }
  return seeds;
}

function euclideanModulo(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** World-relative position of falling leaf `seed` at (wrapped) time `t`,
 *  offset by `groundY` (the local ground height under it) so it wraps between
 *  {@link LEAF_FALL_BOTTOM} and {@link LEAF_FALL_TOP} above real terrain. */
export function leafPosition(
  seed: LeafSeed,
  t: number,
  groundY: number,
): { x: number; y: number; z: number } {
  const fallen = euclideanModulo(t * LEAF_FALL_SPEED + seed.fallOffset, LEAF_FALL_RANGE);
  return {
    x: seed.baseX + Math.sin(t * LEAF_SWAY_RATE + seed.phaseSway) * 1.1,
    y: groundY + LEAF_FALL_TOP - fallen,
    z: seed.baseZ + Math.cos(t * LEAF_SWAY_RATE + seed.phaseSway) * 1.1,
  };
}

/** Dust-mote colour — warm and dim, matching the palette. Deliberately below
 *  the compositor's 0.85 bloom-luminance threshold: `NormalBlending` (not
 *  additive) means overlapping motes never sum brightness past the base
 *  colour regardless of how many stack on screen, unlike the burst/discovery
 *  effects, which deliberately use additive blending to guarantee blooming. */
export const MOTE_COLOR = 0xd8c9a0;
export const MOTE_OPACITY = 0.5;
export const MOTE_SIZE = 0.5;

/** Leaf colours — a warm dry-brown and a duller olive, alternated by index
 *  parity so the small layer reads as mixed leaf litter, not one flat hue. */
export const LEAF_COLOR_A = 0x9c7b3f;
export const LEAF_COLOR_B = 0x6f8a3d;
export const LEAF_SIZE = 0.9;
export const LEAF_OPACITY = 0.75;
