// Wind sway reference math (visual-overhaul slice 6, flora & fauna).
//
// Pure TS functions the GLSL in `windPatch.ts` transcribes line-for-line — the
// `waterSurface.ts`/`waterPatch.ts` idiom: logic lives here, tested headless,
// and the shader patch is a faithful copy so this module IS the single source
// of truth for what the sway actually computes.
//
// The sway itself is deliberately the CHEAPEST thing that reads as "foliage
// moves": one sine term, applied only to the horizontal (x/z) axes, scaled by
// how far a vertex sits above its OWN instance's local origin (so a tree's
// trunk near the ground barely moves while its canopy sways, and a grass
// blade's root is pinned while its tip waves) — no per-vertex noise texture,
// no branching, a handful of extra ALU ops in the vertex stage only.

/** Angular sway speed, rad/s — deliberately gentle (a slow, believable jungle
 *  breeze, not a violent gale). */
export const WIND_SPEED = 1.7;

// --- Time wrap (float32 precision guard, the WaterSystem/StarfieldSystem
// precedent) — a single sine term closes on a WHOLE cycle after exactly
// `2π / WIND_SPEED` time units, so wrapping the live accumulator modulo that
// period is seamless (no visible jump at the wrap, unlike the water swell's
// two-term derivation, one term needs no GCD reconciliation). ---
export const WIND_WRAP_PERIOD = (2 * Math.PI) / WIND_SPEED;

/**
 * Deterministic per-instance phase offset from a world-space XZ position, so
 * neighbouring trees/tufts don't sway in lockstep. A cheap sine-hash (the
 * common GLSL "hash11" trick), NOT a physically meaningful value — only its
 * spread across many world positions matters. Returns radians in
 * `[0, 2π)`.
 */
export function windPhase(worldX: number, worldZ: number): number {
  const h = Math.sin(worldX * 12.9898 + worldZ * 78.233) * 43758.5453;
  const frac = h - Math.floor(h);
  return frac * Math.PI * 2;
}

/**
 * Horizontal sway offset for one vertex, in local model units.
 *
 * @param height01 height above the instance's local origin, normalized to
 *   [0,1] by the model's own known max height (0 at the base — never moves;
 *   1 at the tallest point — moves the most). Values are squared so the ramp
 *   is gentle near the base and pronounced near the top (a real tree/blade's
 *   own bending profile), not a linear tilt.
 * @param time the live (wrapped) accumulator, seconds.
 * @param phase this instance's {@link windPhase}.
 * @param strength world-unit amplitude at height01 = 1.
 */
export function windOffset(height01: number, time: number, phase: number, strength: number): number {
  const h = height01 < 0 ? 0 : height01 > 1 ? 1 : height01;
  return Math.sin(time * WIND_SPEED + phase) * strength * h * h;
}
