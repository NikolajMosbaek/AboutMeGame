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

// Fixed, distinct wave directions, spatial frequencies and temporal speeds for
// the two sines. The directions are non-parallel so the crests cross instead of
// reinforcing into a single ridge; baked-in constants keep `waveHeight` a pure,
// deterministic scalar with no per-call allocation.
const K1 = 0.18; // primary wavenumber
const S1 = 0.9; // primary phase speed
const K2 = 0.27; // secondary wavenumber
const S2 = 1.3; // secondary phase speed

/**
 * Vertical displacement of the water surface at world `(x, z)` and time `t`.
 *
 * A sum of EXACTLY two sines along distinct directions, frequencies and speeds:
 * the first runs along +x, the second along the (0.6, 0.8) diagonal, so their
 * crests cross into a gentle chop rather than a single ridge. Pure, branch-free
 * and allocation-free (scalars only), and deterministic — no `Math.random` /
 * `Date.now`. Bounded by construction: `|waveHeight| <= A1 + A2`, since each
 * `sin` term is in [-1, 1].
 *
 * Amplitudes {@link A1}/{@link A2} are art-tunable — the later visual slice can
 * scale the visible swell by editing them without touching this signature, and
 * this maps line-for-line onto the GLSL `onBeforeCompile` vertex patch.
 */
export function waveHeight(x: number, z: number, t: number): number {
  return (
    A1 * Math.sin(x * K1 + t * S1) +
    A2 * Math.sin((x * 0.6 + z * 0.8) * K2 + t * S2)
  );
}

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
 * Art-direction depth/fresnel colour ramp, written into the caller-owned `out`
 * and returned — allocates nothing on the hot path. Per channel it is the
 * linear `mix(WATER_SHALLOW, WATER_DEEP, clamp01(fresnel))`, branch-free:
 * `fresnel = 0` (head-on view) yields the lighter {@link WATER_SHALLOW},
 * `fresnel = 1` (grazing view) the darker {@link WATER_DEEP}.
 *
 * `fresnel` is a caller-supplied ART-DIRECTION ramp parameter, NOT a physical
 * Fresnel term, and this slice does NOT compute it: the real fresnel is the
 * in-shader `pow(1 - dot(N, V), p)` added in a later visual slice, which then
 * feeds its result in here. Authoring the ramp this way (rather than inverting
 * the input) avoids a doubly-inverted result downstream.
 *
 * The palette endpoints are sRGB-authored to match the renderer's
 * `SRGBColorSpace` convention, so the later `onBeforeCompile` patch can feed
 * them straight into a GLSL `vec3 mix()`. `clamp01` keeps degenerate or
 * out-of-range `fresnel` (NaN/Infinity/<0/>1) finite and in-gamut.
 */
export function waterColor(
  fresnel: number,
  out: [number, number, number],
): [number, number, number] {
  const f = clamp01(fresnel);
  out[0] = WATER_SHALLOW[0] + (WATER_DEEP[0] - WATER_SHALLOW[0]) * f;
  out[1] = WATER_SHALLOW[1] + (WATER_DEEP[1] - WATER_SHALLOW[1]) * f;
  out[2] = WATER_SHALLOW[2] + (WATER_DEEP[2] - WATER_SHALLOW[2]) * f;
  return out;
}

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
