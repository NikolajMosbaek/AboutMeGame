// Pure, headless day-cycle palette math — no Three.js, no DOM, no WebGL.
//
// This module is the source of truth for the time-of-day look (G3): a normalized
// loop fraction `t` ∈ [0,1) maps to a warm-daytime {@link DayPalette} — sun
// colour/intensity/direction plus the sky-dome top/bottom and the fog colour —
// by interpolating a small fixed cyclic sRGB keyframe table component-wise. It
// mirrors the shape of `waterSurface.ts` / `noise.ts` / `terrain.ts`: named
// exports, art-tunable constants up top, jsdoc per export, and it imports nothing
// outside `src/world`. Like `waterSurface.ts` before its G1 wiring slice, this is
// authored UNUSED-BUT-EXPORTED on purpose — no production file imports it yet, so
// the bundler tree-shakes it out of the shipped bundle (zero bytes) until the G3
// slice-2 dome/light/fog refactor imports it. Authoring the source of truth first
// lets that refactor be a provable no-op at noon.
//
// The NOON keyframe is anchored bit-exact to today's shipped look in `sky.ts`:
//   domeTop  = SKY_TOP    = #3a78c2
//   domeBottom = SKY_BOTTOM = #cfe4f2   (sky.ts sets fog = horizon = SKY_BOTTOM)
//   fogColor = #cfe4f2                  (so the fog refactor is a no-op at noon)
//   sunColor = #fff1d6, sunIntensity = 1.6
//   sun direction (0.6, 1, 0.4) → elevation/azimuth below.
// `sky.ts` is the ORIGIN of those literals; they are re-derived here (not shared)
// because this module must stay headless and self-contained.
//
// To stay the slice's two-files-only scope fence, this module does NOT import
// `clamp01` from `./waterSurface` (that would make it a fifth importer and break
// the locked `.toEqual(SANCTIONED)` guard at waterSurface.test.ts:677-688). The
// 3-line {@link clamp01} below is INLINED with identical GLSL/NaN-fold semantics.

/** Sun direction `(0.6, 1, 0.4)` from sky.ts, decomposed once here so the noon
 *  keyframe's elevation/azimuth are derived from the SAME numbers, not hand-typed. */
const SUN_DIR_X = 0.6;
const SUN_DIR_Y = 1;
const SUN_DIR_Z = 0.4;
const SUN_HORIZ = Math.hypot(SUN_DIR_X, SUN_DIR_Z);
/** Noon sun elevation above the XZ ground plane (radians): atan2(y, |xz|). */
const NOON_ELEVATION = Math.atan2(SUN_DIR_Y, SUN_HORIZ);
/** Noon sun azimuth (radians), measured clockwise from +Z toward +X: atan2(x, z). */
const NOON_AZIMUTH = Math.atan2(SUN_DIR_X, SUN_DIR_Z);

/** Convert an sRGB hex literal (e.g. `0x3a78c2`) to an sRGB-0..1 RGB tuple — used
 *  ONLY at module load to author the keyframe table from readable hex, never on a
 *  per-call path. */
function srgb(hex: number): readonly [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/**
 * A fully-resolved day-cycle palette for one instant of the loop. Colours are
 * sRGB-authored 0..1 tuples (matching the renderer's `SRGBColorSpace`
 * convention, so slice 2 feeds them straight into colours/uniforms); angles are
 * radians.
 */
export interface DayPalette {
  /** Directional sun/key-light colour, sRGB 0..1. */
  sunColor: readonly [number, number, number];
  /** Directional sun intensity (Three.js light intensity scalar). */
  sunIntensity: number;
  /** Sun elevation above the XZ ground plane, radians (0 = horizon, π/2 = zenith). */
  sunElevation: number;
  /** Sun azimuth, radians, measured CLOCKWISE from +Z toward +X (so +x ↔ atan2(x,z)).
   *  Authored monotone-unwrapped across the loop, so it may exceed 2π near the seam. */
  sunAzimuth: number;
  /** Sky-dome TOP colour (zenith), sRGB 0..1. */
  domeTop: readonly [number, number, number];
  /** Sky-dome BOTTOM colour (horizon), sRGB 0..1. */
  domeBottom: readonly [number, number, number];
  /** Fog colour, sRGB 0..1 — matches the horizon so the world fades into the sky. */
  fogColor: readonly [number, number, number];
}

// --- Readability / no-night floors (exported, satisfied BY CONSTRUCTION) ------
// These are the invariants the keyframe table is authored to respect — NOT a
// runtime Math.max clamp. They are exported so the tests can sweep the whole loop
// and assert the function never dips into night-dark, unreadable values, and so
// slice 2's G2 bloom tuning knows the guaranteed brightest/dimmest bounds.
/** The dimmest sun intensity any keyframe drops to — the loop never goes darker. */
export const MIN_SUN_INTENSITY = 0.9;
/** The dimmest the dome BOTTOM (horizon) ever gets, as Rec.709 relative luma in
 *  sRGB-0..1 — the loop keeps the horizon readable everywhere, never night-black. */
export const MIN_DOME_BOTTOM_LUMA = 0.6;

/**
 * The loop fraction of the GOLDEN dusk keyframe — the warm, low-sun "golden
 * hour" look. Exported so slice 4 can PIN the cycle here under reduced-motion
 * (a flattering still instead of an animated loop).
 */
export const GOLDEN_T = 0.5;

// --- Keyframe table (art-tunable, cyclic) ------------------------------------
// A small fixed loop: warm DAWN → bright NOON → golden DUSK → soft EVENING → back
// to dawn. `t` is the keyframe's loop fraction; rows MUST be sorted ascending and
// span exactly [0, 1] with the last row a CLOSING repeat of the first (same
// colours/intensity/elevation) so the loop wraps with no jump. Azimuth is the one
// field authored MONOTONE-UNWRAPPED: it increases every row and the closing row
// carries `dawn.azimuth + 2π`, so the sun sweeps continuously across the seam and
// the approach-from-below converges to the dawn azimuth (mod 2π). Edit these to
// re-tune the day; `dayPalette` reads them as the single source of truth.
//
// Floors held by construction: every `sunIntensity >= MIN_SUN_INTENSITY` and
// every `domeBottom` luma >= MIN_DOME_BOTTOM_LUMA (see the swept-invariant test).
interface Keyframe extends DayPalette {
  /** Loop fraction in [0,1] at which this keyframe is exact. */
  t: number;
}

/** Dawn azimuth (the loop's reference azimuth); the closing row is this + 2π. */
const DAWN_AZIMUTH = -Math.PI / 3; // sun rising from the east-ish, low and warm

export const KEYFRAMES: readonly Keyframe[] = [
  // DAWN — low warm sun, peachy horizon, gentle key light. (t = 0)
  {
    t: 0,
    sunColor: srgb(0xffcf9e),
    sunIntensity: 1.0,
    sunElevation: 0.12,
    sunAzimuth: DAWN_AZIMUTH,
    domeTop: srgb(0x6f93c8),
    domeBottom: srgb(0xe6c9b0),
    fogColor: srgb(0xe6c9b0),
  },
  // NOON — sky.ts look, bit-exact. The brightest case (G2 bloom anchor). (t = 0.25)
  {
    t: 0.25,
    sunColor: srgb(0xfff1d6),
    sunIntensity: 1.6,
    sunElevation: NOON_ELEVATION,
    sunAzimuth: NOON_AZIMUTH,
    domeTop: srgb(0x3a78c2),
    domeBottom: srgb(0xcfe4f2),
    fogColor: srgb(0xcfe4f2),
  },
  // GOLDEN DUSK — low warm sun on the far side, amber horizon. (t = GOLDEN_T = 0.5)
  {
    t: GOLDEN_T,
    sunColor: srgb(0xffc27a),
    sunIntensity: 1.2,
    sunElevation: 0.16,
    sunAzimuth: Math.PI - 0.4,
    domeTop: srgb(0x5f7fb4),
    domeBottom: srgb(0xf2d9b8),
    fogColor: srgb(0xf2d9b8),
  },
  // SOFT EVENING — overcast-cool but kept READABLE (no night): dim sun, hazy dome.
  // (t = 0.75)
  {
    t: 0.75,
    sunColor: srgb(0xe8ecf5),
    sunIntensity: MIN_SUN_INTENSITY,
    sunElevation: 0.2,
    sunAzimuth: 1.5 * Math.PI - 0.5,
    domeTop: srgb(0x59688a),
    domeBottom: srgb(0xb9c3d6),
    fogColor: srgb(0xb9c3d6),
  },
  // CLOSING DAWN — a repeat of t=0 EXCEPT azimuth = DAWN_AZIMUTH + 2π, so the sun
  // sweep is monotone across the whole loop and the seam is seamless. (t = 1)
  {
    t: 1,
    sunColor: srgb(0xffcf9e),
    sunIntensity: 1.0,
    sunElevation: 0.12,
    sunAzimuth: DAWN_AZIMUTH + 2 * Math.PI,
    domeTop: srgb(0x6f93c8),
    domeBottom: srgb(0xe6c9b0),
    fogColor: srgb(0xe6c9b0),
  },
];

/**
 * Clamp a scalar to [0,1]. GLSL `clamp(x, 0, 1)`-exact and branch-light: `NaN`
 * folds to 0 (neither comparison is true → final branch), keeping callers finite
 * and in-gamut on degenerate input. INLINED here (identical to the `clamp01` in
 * `waterSurface.ts`) rather than imported, so this module stays the G3 slice's
 * only new dependency-free file and does not become a fifth `./waterSurface`
 * importer.
 */
export function clamp01(v: number): number {
  return v > 1 ? 1 : v > 0 ? v : 0;
}

/** Component-wise linear interpolation of two sRGB-0..1 tuples (the colour mix). */
function lerpColor(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  f: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** Scalar linear interpolation. */
function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

/**
 * Map a normalized loop fraction `t` to a {@link DayPalette}, interpolating the
 * {@link KEYFRAMES} table component-wise in sRGB.
 *
 * Total and deterministic. `t` is first made finite-and-in-range: a
 * `Number.isFinite(t)` guard folds `NaN`/`±Infinity` to 0, then a euclidean
 * modulo-1 wraps any real `t` (negative or `>= 1`, including exactly `1.0`) into
 * `[0, 1)` — so EVERY input yields a finite, in-gamut, non-night palette and the
 * loop is seamless. Within the loop it finds the bracketing keyframe pair and
 * lerps each field by the local fraction; when the wrapped `t` lands exactly on a
 * keyframe (notably `f == 0` at the start of a segment, e.g. `t = 0` or `t = 1`)
 * it early-returns that keyframe's EXACT tuples/scalars (no lerp rounding), which
 * is what makes the noon-equals-sky.ts and keyframe-exactness guarantees bit-exact.
 *
 * Colours are sRGB-0..1; angles are radians (azimuth CLOCKWISE from +Z toward +X,
 * authored monotone-unwrapped — see {@link DayPalette}). Allocates one small
 * result palette per call (off any per-frame hot path — slice 2 calls it once per
 * frame at most, sampling into reused objects if needed).
 */
export function dayPalette(t: number): DayPalette {
  // Total-function guard: fold non-finite input to the loop start, then euclidean
  // modulo-1 so any real `t` (incl. <0, >=1, exactly 1.0) wraps into [0,1).
  const tf = Number.isFinite(t) ? t : 0;
  const wrapped = tf - Math.floor(tf); // euclidean mod 1 ∈ [0,1)

  // Find the segment [k0, k1] with k0.t <= wrapped < k1.t. The closing keyframe
  // at t=1 guarantees such a pair exists for every wrapped ∈ [0,1).
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    const k0 = KEYFRAMES[i];
    const k1 = KEYFRAMES[i + 1];
    if (wrapped < k0.t || wrapped >= k1.t) continue;

    const f = clamp01((wrapped - k0.t) / (k1.t - k0.t));
    // Early-return keyframe-exactness at the segment start (f == 0), so on-keyframe
    // inputs (incl. t = 0 / t = 1) return the authored tuples bit-exact.
    if (f === 0) return paletteOf(k0);

    return {
      sunColor: lerpColor(k0.sunColor, k1.sunColor, f),
      sunIntensity: lerp(k0.sunIntensity, k1.sunIntensity, f),
      sunElevation: lerp(k0.sunElevation, k1.sunElevation, f),
      sunAzimuth: lerp(k0.sunAzimuth, k1.sunAzimuth, f),
      domeTop: lerpColor(k0.domeTop, k1.domeTop, f),
      domeBottom: lerpColor(k0.domeBottom, k1.domeBottom, f),
      fogColor: lerpColor(k0.fogColor, k1.fogColor, f),
    };
  }

  // Unreachable for any finite wrapped ∈ [0,1) given the table spans [0,1];
  // return the loop start as a total-function safety net.
  return paletteOf(KEYFRAMES[0]);
}

/** Project a {@link Keyframe} onto a {@link DayPalette} (drops the `t` field),
 *  copying the authored tuples so callers can never mutate the table. */
function paletteOf(k: Keyframe): DayPalette {
  return {
    sunColor: [k.sunColor[0], k.sunColor[1], k.sunColor[2]],
    sunIntensity: k.sunIntensity,
    sunElevation: k.sunElevation,
    sunAzimuth: k.sunAzimuth,
    domeTop: [k.domeTop[0], k.domeTop[1], k.domeTop[2]],
    domeBottom: [k.domeBottom[0], k.domeBottom[1], k.domeBottom[2]],
    fogColor: [k.fogColor[0], k.fogColor[1], k.fogColor[2]],
  };
}
