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
//
// EXPORTED so the GLSL `onBeforeCompile` emitter and {@link waveGradient} read
// the SAME numbers as {@link waveHeight} — one source of truth, never a second
// hand-copy of the magic constants in shader text or in the analytic gradient.
/** Primary wavenumber (spatial frequency along +x). */
export const K1 = 0.18;
/** Primary phase speed (temporal frequency of the +x sine). */
export const S1 = 0.9;
/** Secondary wavenumber (spatial frequency along the (0.6,0.8) diagonal). */
export const K2 = 0.27;
/** Secondary phase speed (temporal frequency of the diagonal sine). */
export const S2 = 1.3;

// Unit-ish crest direction of the second sine: the (0.6, 0.8) diagonal (a 3-4-5
// direction, |(0.6,0.8)| = 1). EXPORTED for the SAME single-source reason as the
// frequencies above — {@link waveHeight}, {@link waveGradient} and the GLSL
// emitter all read these, so the diagonal weight is never a second hand-copy of
// `0.6`/`0.8` in the analytic gradient or the shader text.
/** Second sine's crest-direction x-weight (the 0.6 of the (0.6,0.8) diagonal). */
export const DIR2_X = 0.6;
/** Second sine's crest-direction z-weight (the 0.8 of the (0.6,0.8) diagonal). */
export const DIR2_Z = 0.8;

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
    A2 * Math.sin((x * DIR2_X + z * DIR2_Z) * K2 + t * S2)
  );
}

/**
 * Analytic surface gradient of {@link waveHeight} — its exact closed-form
 * partials `∂h/∂x` and `∂h/∂z` at world `(x, z)` and time `t`.
 *
 * Differentiating the two-sine {@link waveHeight} term by term:
 * - `d/dx[ A1·sin(x·K1 + t·S1) ] = A1·K1·cos(x·K1 + t·S1)`
 * - the diagonal sine `A2·sin((x·0.6 + z·0.8)·K2 + t·S2)` has inner derivative
 *   `0.6·K2` in x and `0.8·K2` in z (the (0.6, 0.8) crest direction), so it
 *   contributes `A2·(0.6·K2)·cos(φ)` to `∂h/∂x` and `A2·(0.8·K2)·cos(φ)` to
 *   `∂h/∂z`, sharing the single phase `φ = (x·0.6 + z·0.8)·K2 + t·S2`.
 *
 * The first sine carries no z, so `∂h/∂z` has only the diagonal term. This is
 * the SINGLE SOURCE OF TRUTH for the lit vertex normal: the visual slice forms
 * `objectNormal = normalize(vec3(-dHdx, 1, -dHdz))` from these same partials so
 * the shaded normal can never diverge from the displaced silhouette (both flow
 * from the same {@link A1}/{@link A2}/{@link K1}/{@link S1}/{@link K2}/{@link S2}
 * constants). Pure, deterministic, branch-free; allocates one small result
 * object per call (off the per-frame path — used only by the build-time emitter
 * and the headless gradient tests).
 */
export function waveGradient(
  x: number,
  z: number,
  t: number,
): { dHdx: number; dHdz: number } {
  const phase2 = (x * DIR2_X + z * DIR2_Z) * K2 + t * S2;
  const cos2 = Math.cos(phase2);
  return {
    dHdx: A1 * K1 * Math.cos(x * K1 + t * S1) + A2 * (DIR2_X * K2) * cos2,
    dHdz: A2 * (DIR2_Z * K2) * cos2,
  };
}

// --- Shared GLSL emitter (one source of truth for both vertex anchors) ------
// The G1 animation slice perturbs the water in the vertex stage at TWO anchors,
// both reading the raw `position` attribute (model space == world XZ here): a
// normal recompute at `#include <beginnormal_vertex>` and a y-displacement at
// `#include <begin_vertex>`. Both must transcribe the SAME two-sine math as
// {@link waveHeight}/{@link waveGradient}, or the lit normal and the displaced
// silhouette silently diverge. Rather than hand-copy the closed form into each
// anchor (the dead-code/divergence trap the prior round hit), this single
// emitter builds callable GLSL `waveHeight`/`waveGradient` definitions by
// INTERPOLATING the SAME exported A1/A2/K1/S1/K2/S2 + DIR2_X/DIR2_Z constants —
// no second literal copy of the magic numbers anywhere.

/**
 * Format a JS number as a GLSL float literal — always with a decimal point, so
 * an integer-valued constant like `1` becomes `1.0` (GLSL `1` is an `int` and
 * would not type-check where a `float` is wanted). Round-trips exactly:
 * `Number(glslFloat(v)) === v`, so interpolating an exported constant into the
 * shader text loses no precision and stays the single source of truth.
 */
export function glslFloat(v: number): string {
  const s = String(v);
  // `String` already gives full round-trip precision; only add `.0` when the
  // textual form has no `.` and no exponent (e.g. "1", "-2" → "1.0", "-2.0").
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

/**
 * Emit the shared GLSL for the two vertex anchors: callable `waveHeight` and
 * `waveGradient` function definitions whose bodies are the EXACT transcription
 * of the TS {@link waveHeight}/{@link waveGradient}, with every constant
 * interpolated from the SAME exports via {@link glslFloat} (never a hand-typed
 * duplicate). `waveGradient` returns a `vec2(dHdx, dHdz)`, so anchor A can form
 * `objectNormal = normalize(vec3(-g.x, 1.0, -g.y))` and anchor B can add
 * `waveHeight(...)` to `transformed.y`, both from one body of math.
 *
 * Pure and deterministic: a build-time string builder, byte-identical on every
 * call, allocating only the returned string (off any per-frame path).
 */
export function waveGlsl(): string {
  const a1 = glslFloat(A1);
  const a2 = glslFloat(A2);
  const k1 = glslFloat(K1);
  const s1 = glslFloat(S1);
  const k2 = glslFloat(K2);
  const s2 = glslFloat(S2);
  const dx = glslFloat(DIR2_X);
  const dz = glslFloat(DIR2_Z);
  // Shared inner phases, written once so height and gradient cannot drift apart:
  //   phase1 = x*K1 + t*S1            (the +x sine)
  //   phase2 = (x*DIR2_X + z*DIR2_Z)*K2 + t*S2   (the diagonal sine)
  const phase1 = `x * ${k1} + t * ${s1}`;
  const phase2 = `( x * ${dx} + z * ${dz} ) * ${k2} + t * ${s2}`;
  return (
    `float waveHeight( float x, float z, float t ) {\n` +
    `\treturn ${a1} * sin( ${phase1} )\n` +
    `\t     + ${a2} * sin( ${phase2} );\n` +
    `}\n` +
    `vec2 waveGradient( float x, float z, float t ) {\n` +
    `\tfloat cos2 = cos( ${phase2} );\n` +
    `\tfloat dHdx = ${a1} * ${k1} * cos( ${phase1} ) + ${a2} * ( ${dx} * ${k2} ) * cos2;\n` +
    `\tfloat dHdz = ${a2} * ( ${dz} * ${k2} ) * cos2;\n` +
    `\treturn vec2( dHdx, dHdz );\n` +
    `}\n`
  );
}

// --- Time wrap (float32 precision guard) -----------------------------------
// The live system accumulates time as a scalar; on a long-lived tab that scalar
// would grow without bound and lose precision in the `sin()` argument on a
// mediump mobile GPU. Wrapping the accumulator modulo a shared period keeps the
// argument small. The period must be common to BOTH sines so neither term jumps
// at the wrap: each temporal phase must complete a WHOLE number of 2π cycles
// over one period. With speeds S1 = 0.9 and S2 = 1.3, S1/S2 = 9/13, so the
// smallest common period is `2π·9/S1 = 2π·13/S2 = 20π` — both phases close on an
// exact cycle, making `waveHeight(x, z, WRAP_PERIOD) == waveHeight(x, z, 0)`.
/**
 * Shared continuous wrap period for the time accumulator, in the same time
 * units as {@link waveHeight}'s `t`. Derived (not hand-typed) as the smallest
 * `T` for which both `T·S1` and `T·S2` are whole multiples of `2π`, so wrapping
 * `t` modulo `T` is seamless for BOTH sine terms — no visible jump at the wrap.
 */
export const WRAP_PERIOD = (() => {
  // n_i = T·S_i / (2π) must be integers. The smallest T comes from the smallest
  // integers (n1, n2) with n1/n2 = S1/S2. Recover them by scaling S1/S2 to
  // integers via their precision (S1=0.9, S2=1.3 → tenths → 9/13, already
  // coprime), then T = 2π·n1/S1.
  const SCALE = 10; // both speeds are exact in tenths
  let m1 = Math.round(S1 * SCALE);
  let m2 = Math.round(S2 * SCALE);
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(m1, m2);
  m1 /= g;
  m2 /= g;
  // Whole-cycle counts (m1, m2) with m1/m2 = S1/S2, so T·S1 = 2π·m1 and
  // T·S2 = 2π·m2 are the SAME T by construction. Compute it from S1.
  return (2 * Math.PI * m1) / S1;
})();

// --- Foam band -------------------------------------------------------------
// Edge ordering is load-bearing: FOAM_DEPTH_START < FOAM_DEPTH_END so the foam
// term is `1 - smoothstep(START, END, depth)`. GLSL `smoothstep` is undefined
// when edge0 > edge1, so the reversed-edge form is forbidden — this ordering is
// what makes the headless math a faithful transcription on a mediump GPU.
/** Water depth at which foam begins to fade out, world units (shore side). */
export const FOAM_DEPTH_START = 0.0;
/** Water depth past which there is no foam (open water), world units. */
export const FOAM_DEPTH_END = 1.5;

/**
 * Shoreline foam intensity in [0,1] as a function of vertical water `depth`.
 *
 * Implemented ONLY as `1 - smoothstep(FOAM_DEPTH_START, FOAM_DEPTH_END, depth)`
 * with `FOAM_DEPTH_START < FOAM_DEPTH_END` (edge0 < edge1). The reversed-edge
 * form `smoothstep(END, START, depth)` is forbidden: GLSL `smoothstep` is
 * undefined when `edge0 > edge1`, so it would pass green here yet be undefined
 * behaviour in the faithful `onBeforeCompile` transcription on a mediump mobile
 * GPU. Returns ~0 in deep/open water (`depth >= FOAM_DEPTH_END`) and ramps up to
 * the full foam value (1) as `depth -> 0` near the coast; the shared
 * {@link smoothstep} clamps its interpolant, so the tails are exactly 0 / 1
 * beyond the edges and degenerate/negative `depth` stays finite and in-gamut.
 *
 * `depth` is the VERTICAL water depth — 0 at the shore, positive offshore. The
 * later wiring slice feeds it as `seaLevel - groundHeight` (NOT the radial
 * `coastRadius`/`islandRadius` bands).
 */
export function shorelineFoam(depth: number): number {
  return 1 - smoothstep(FOAM_DEPTH_START, FOAM_DEPTH_END, depth);
}

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
