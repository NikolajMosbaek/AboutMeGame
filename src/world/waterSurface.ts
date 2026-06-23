// Pure, headless water-surface math — no Three.js, no DOM, no WebGL.
//
// This module is the source of truth for the water look: a two-sine wave
// height field, an art-direction depth/fresnel colour ramp, and a shoreline
// foam term, plus the GLSL-equivalent `clamp01`/`smoothstep` helpers they share.
// Authored so the later G1 visual slice can transliterate these functions
// line-for-line into an `onBeforeCompile` GLSL patch: every helper matches GLSL
// semantics exactly (notably `smoothstep` clamping its interpolant to [0,1]),
// and the palette feeds straight into a `vec3 mix()`. It mirrors the shape of
// `noise.ts` / `terrain.ts` — named exports, fixed constants up top, jsdoc per
// export — and imports nothing outside `src/world`, so tree-shaking keeps it out
// of the shipped bundle until that wiring slice imports it.

// --- Wave constants (art-tunable) -----------------------------------------
// Two sub-decimetre amplitudes; the wave height is bounded by |h| <= A1 + A2 by
// construction. Tune these to scale the visible swell without changing the
// `waveHeight` signature.
/** Primary swell amplitude, world units. Art-tunable. */
export const A1 = 0.06;
/** Secondary ripple amplitude, world units. Art-tunable. */
export const A2 = 0.04;

// --- Foam band -------------------------------------------------------------
// Edge ordering is load-bearing: FOAM_DEPTH_START < FOAM_DEPTH_END so the foam
// term is `1 - smoothstep(START, END, depth)`. GLSL `smoothstep` is undefined
// when edge0 > edge1, so the reversed-edge form is forbidden — this ordering is
// what makes the headless math a faithful transcription on a mediump GPU.
/** Water depth at which foam begins to fade out, world units (shore side). */
export const FOAM_DEPTH_START = 0.0;
/** Water depth past which there is no foam (open water), world units. */
export const FOAM_DEPTH_END = 1.5;

// --- Palette (single source of truth) -------------------------------------
// sRGB-authored 0..1 tuples to match the renderer's SRGBColorSpace convention,
// so the later patch feeds them straight into a `vec3` mix(). The two blues
// bracket the centralised `#2e6f9e` Water token (art-direction.md): WATER_SHALLOW
// is that token as the lighter anchor, WATER_DEEP a darker companion (#193d57).
/** Lighter water blue (head-on view). sRGB 0..1 — the `#2e6f9e` Water token. */
export const WATER_SHALLOW = [0x2e / 255, 0x6f / 255, 0x9e / 255] as const;
/** Darker water blue (grazing view). sRGB 0..1 — `#193d57`, darker than shallow. */
export const WATER_DEEP = [0x19 / 255, 0x3d / 255, 0x57 / 255] as const;

/**
 * Clamp a scalar to [0,1]. Branch-free in spirit, GLSL `clamp(x,0,1)` exact.
 * NaN folds to 0 (neither comparison is true → final branch), keeping callers
 * finite and in-gamut on degenerate input.
 */
export function clamp01(v: number): number {
  return v > 1 ? 1 : v > 0 ? v : 0;
}

/**
 * GLSL-equivalent `smoothstep(edge0, edge1, x)`: 0 for `x <= edge0`, 1 for
 * `x >= edge1`, and a smooth cubic `t*t*(3-2*t)` ramp between, where the
 * interpolant `t` is clamped to [0,1] (exactly matching GLSL, and the local
 * `smooth()` fade used in `noise.ts`/`terrain.ts`). Callers must pass
 * `edge0 < edge1`; like GLSL, equal-or-reversed edges are not meaningful.
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
