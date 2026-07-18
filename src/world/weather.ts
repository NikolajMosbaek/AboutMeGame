// Weather Over the Island (W1 slice 1, #226) — the pure core. A deterministic
// shower schedule derived by HASHING shower indices (the props/wildlife
// hash-RNG idiom — no Math.random anywhere, so a session's weather replays
// identically for a given seed and the whole thing is headless-testable):
//
//   clear gap → gathering (gusts lead) → rain (smooth envelope) → clearing → …
//
// Every consumer-facing factor (light dim, fog boost, cloud darkening, gust
// agitation) is derived from the ONE rain envelope here, so the weather can
// never disagree with itself. Dawn mist is its own independent curve over the
// day-cycle phase. `WeatherSystem` (slice 2) is the only thing that touches
// THREE — this file imports nothing but the shared hash.

import { hash2 } from "../wildlife/geometry.ts";

/** The first gap is fixed and short-ish so a normal expedition actually sees
 *  weather (~4 min in); later gaps stretch out. Seconds of play time. */
export const FIRST_GAP = 240;
export const GAP_MIN = 240;
export const GAP_MAX = 420;
/** The build-up: gusts rise and the light starts to die before a drop falls. */
export const GATHER_SECONDS = 30;
/** Shower length range (the envelope's plateau + ramps live inside it). */
export const RAIN_MIN = 60;
export const RAIN_MAX = 150;
/** The tail-off after the plateau ends. */
export const CLEAR_SECONDS = 20;
/** A light shower never exceeds this intensity; a heavy one reaches 1. */
export const LIGHT_CAP = 0.55;

/** Factor couplings — one place, so a retune can't desynchronise consumers. */
const DIM_PER_RAIN = 0.45;
const FOG_PER_RAIN = 1.6;

export interface WeatherSnapshot {
  /** The master envelope, 0 (dry) .. 1 (heavy peak). */
  rain01: number;
  /** How much of the light the shower takes (multiply: `1 − dim`). */
  dim: number;
  /** Fog density boost factor (multiply base density by `1 + fogBoost`). */
  fogBoost: number;
  /** Cloud darkening 0..1. */
  cloudDark: number;
  /** Wind agitation 0..1 — leads the rain during the gather. */
  gust01: number;
  /** Whether the CURRENT (or next, while gathering) shower is a heavy one. */
  heavy: boolean;
}

const DRY: WeatherSnapshot = {
  rain01: 0,
  dim: 0,
  fogBoost: 0,
  cloudDark: 0,
  gust01: 0,
  heavy: false,
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Per-shower deterministic parameters, hashed from (index, seed). */
function showerParams(index: number, seed: number) {
  const gap =
    index === 0 ? FIRST_GAP : GAP_MIN + hash2(index * 3.7 + seed, 11.13) * (GAP_MAX - GAP_MIN);
  const rain = RAIN_MIN + hash2(index * 5.1 + seed, 23.29) * (RAIN_MAX - RAIN_MIN);
  // Roughly every other shower is heavy.
  const heavy = hash2(index * 9.7 + seed, 41.43) > 0.5;
  return { gap, rain, heavy, total: gap + GATHER_SECONDS + rain + CLEAR_SECONDS };
}

/**
 * The weather at `playSeconds` of (pause-aware) play. Walks the shower list
 * from the start — showers are minutes long, so even hours of play is a
 * couple dozen iterations; determinism beats cleverness here.
 */
export function weatherAt(playSeconds: number, seed = 1): WeatherSnapshot {
  let t = playSeconds;
  for (let index = 0; index < 200; index++) {
    const p = showerParams(index, seed);
    if (t >= p.total) {
      t -= p.total;
      continue;
    }
    // Inside this shower's cycle. Where?
    const cap = p.heavy ? 1 : LIGHT_CAP;
    if (t < p.gap) return DRY;
    const sinceGather = t - p.gap;
    if (sinceGather < GATHER_SECONDS) {
      // Gathering: gusts and a first touch of gloom lead the rain.
      const ramp = smoothstep(0, 1, sinceGather / GATHER_SECONDS);
      return { ...DRY, gust01: ramp * cap, heavy: p.heavy };
    }
    const sinceRain = sinceGather - GATHER_SECONDS;
    let env: number;
    if (sinceRain < p.rain) {
      // Ramp up over the first GATHER-worth of the shower, hold the plateau.
      env = cap * smoothstep(0, 1, sinceRain / GATHER_SECONDS);
    } else {
      // Clearing tail.
      env = cap * (1 - smoothstep(0, 1, (sinceRain - p.rain) / CLEAR_SECONDS));
    }
    // Gusts hand over CONTINUOUSLY (review finding): the gather's full-cap
    // agitation decays over the first gather-window of rain while the rain
    // envelope ramps up — the max() crossover has no step at either boundary,
    // and the clearing tail rides env straight down to the gap's zero.
    const gustFloor =
      sinceRain < p.rain ? cap * (1 - smoothstep(0, 1, sinceRain / GATHER_SECONDS)) : 0;
    return {
      rain01: env,
      dim: DIM_PER_RAIN * env,
      fogBoost: FOG_PER_RAIN * env,
      cloudDark: env,
      gust01: Math.max(env, gustFloor),
      heavy: p.heavy,
    };
  }
  return DRY;
}

/**
 * Dawn mist 0..1 over the day-cycle loop fraction (0 = dawn — see
 * `world/dayCycle.ts`'s keyframes): a tight bell around dawn, gone well
 * before noon, periodic across the seam.
 */
export function mistAt(dayPhase: number): number {
  const p = ((dayPhase % 1) + 1) % 1;
  // Distance to dawn (phase 0/1), as a loop fraction.
  const d = Math.min(p, 1 - p);
  const WIDTH = 0.07; // mist is gone ~7% of the loop after dawn
  return d >= WIDTH ? 0 : 1 - smoothstep(0, 1, d / WIDTH);
}

/**
 * Thunder strike offsets (seconds from the shower's rain start) for a heavy
 * shower — hash-spaced 8–20 s apart across the longest possible shower.
 * `WeatherSystem` filters them against the live envelope (strikes only land
 * while `rain01 > 0.6`).
 */
/**
 * Whether a thunder strike lands in the play-time window `(t0, t1]` — pure,
 * so the system's drained edge is one comparison per frame. A strike exists
 * where a heavy shower's hashed offsets cross the window while the envelope
 * at the strike moment exceeds 0.6.
 */
export function thunderBetween(t0: number, t1: number, seed = 1): boolean {
  if (t1 <= t0) return false;
  // Locate the shower cycle containing t1 (same walk as weatherAt).
  let t = t1;
  let cycleStart = 0;
  for (let index = 0; index < 200; index++) {
    const p = showerParams(index, seed);
    if (t >= p.total) {
      t -= p.total;
      cycleStart += p.total;
      continue;
    }
    if (!p.heavy) return false;
    const rainStart = cycleStart + p.gap + GATHER_SECONDS;
    for (const offset of thunderTimes(index, seed)) {
      const strikeAt = rainStart + offset;
      if (strikeAt > t0 && strikeAt <= t1 && weatherAt(strikeAt, seed).rain01 > 0.6) {
        return true;
      }
    }
    return false;
  }
  return false;
}

export function thunderTimes(showerIndex: number, seed = 1): number[] {
  const times: number[] = [];
  let t = 6 + hash2(showerIndex * 13.3 + seed, 3.1) * 8;
  while (t < RAIN_MAX + CLEAR_SECONDS) {
    times.push(t);
    t += 8 + hash2(showerIndex * 17.9 + seed, t) * 12;
  }
  return times;
}
