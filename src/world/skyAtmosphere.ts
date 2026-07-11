// Pure, headless reference math for the atmospheric sky dome fragment shader
// (visual-overhaul slice 5, `sky.ts`'s `buildDomeMaterial`) — the same idiom as
// `waterSurface.ts`/`waterPatch.ts`: small numeric functions the GLSL is a
// direct transcription of (the exact constants below are interpolated
// straight into the shader source, one source of truth), so the atmosphere's
// look is unit-tested without a renderer. No three.js/DOM/WebGL.
//
// The dome shader stays a Preetham/Rayleigh-FLAVOURED approximation, not a
// literal port: a horizon-haze band (density falling off with view-ray
// altitude, standing in for Rayleigh scattering thickening near the horizon),
// a sharp sun disc, and a broad Mie-style forward-scattering halo that warms
// toward amber as the sun nears the horizon. It consumes the palette
// (topColor/bottomColor/sunColor) and the sun DIRECTION exactly as
// `DayCycleSystem` already computes them — no new clock, no new authoring
// surface, only a richer distribution of the same 5-keyframe palette.

function clamp01(v: number): number {
  return v > 1 ? 1 : v > 0 ? v : 0;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** How fast the horizon haze falls off away from `h = 0` (the view ray's
 *  world-space height term, `sky.ts`'s existing `h` — 0 at the horizon, 1 at
 *  the zenith). Higher = a thinner band hugging the horizon exactly. */
export const HAZE_FALLOFF = 6;
/** How much of the haze blend reaches full `bottomColor` at `h = 0`. */
export const HAZE_STRENGTH = 0.55;

/**
 * Horizon-haze blend factor at view-ray height `h` — how much extra
 * `bottomColor` bleeds into the gradient near the horizon, symmetric above
 * and below it (a cheap stand-in for Rayleigh density thickening toward the
 * horizon in every direction, not just upward). 0 at the zenith/nadir
 * extremes, `HAZE_STRENGTH` exactly at `h = 0`.
 */
export function hazeFactor(h: number): number {
  return Math.exp(-Math.abs(h) * HAZE_FALLOFF) * HAZE_STRENGTH;
}

/** The sun disc's inner/outer angular radius, expressed as `cos(angle)`
 *  thresholds against the view/sun dot product (1 = looking straight at the
 *  sun) — a narrow, near-instantaneous rim so the disc reads as a small hard
 *  circle, not a soft blob (that's the halo's job). */
export const SUN_DISC_INNER = 0.9994;
export const SUN_DISC_OUTER = 0.9997;

/**
 * Sun-disc coverage at a view/sun angle whose cosine is `cosAngle` — 0 outside
 * the disc, 1 once fully inside, smoothstepped across the thin rim between
 * {@link SUN_DISC_INNER} and {@link SUN_DISC_OUTER}.
 */
export function sunDiscFactor(cosAngle: number): number {
  return smoothstep(SUN_DISC_INNER, SUN_DISC_OUTER, cosAngle);
}

/** Falloff exponent for the Mie-style forward-scattering halo — high enough
 *  that the glow stays a soft ring around the disc, not a wash across the
 *  whole sky. */
export const SUN_HALO_POWER = 24;

/**
 * Mie-style forward-scattering halo intensity at a view/sun angle whose
 * cosine is `cosAngle` (clamped negative to 0 first — the halo never wraps to
 * the sky's far side). Broad and soft, deliberately distinct from the sharp
 * {@link sunDiscFactor} rim.
 */
export function sunHaloFactor(cosAngle: number): number {
  return Math.pow(clamp01(cosAngle), SUN_HALO_POWER);
}

/**
 * How "low" the sun is, 0 at/above a comfortable elevation and 1 at/below the
 * horizon — drives the warm amber limb-glow tint (dawn/dusk) versus a more
 * neutral glow near noon, and (via {@link fogDensityForElevation}) the
 * horizon fog's density. `sunDirY` is the sun's unit-direction Y component
 * (`= sin(elevation)`, the same quantity `DayCycleSystem` already derives).
 */
export function lowSunFactor(sunDirY: number): number {
  return 1 - clamp01(sunDirY * 2);
}

/** The pre-slice-5 flat fog density (`sky.ts`'s shipped `0.0022`) — held
 *  exactly at a comfortably-high sun elevation (noon and above), so the noon
 *  look stays byte-identical to before this slice. */
export const FOG_DENSITY_BASE = 0.0022;
/** Extra density blended in as the sun gets lower — the dome's horizon haze
 *  band widens at dawn/dusk/evening, so the fog thickens to match rather than
 *  sitting at one flat value regardless of the sky's mood. Bounded so the
 *  draw-distance change stays a mood tune (~30% at the lowest keyframes), not
 *  a visibility regression. */
export const FOG_DENSITY_LOW_SUN_BOOST = 0.001;

/**
 * Fog density for the live `FogExp2` at sun elevation `sunElevation`
 * (radians) — `FOG_DENSITY_BASE` at/above a comfortably high sun (noon:
 * `lowSunFactor` is exactly 0, so this reproduces `0.0022` bit-exact),
 * rising toward `FOG_DENSITY_BASE + FOG_DENSITY_LOW_SUN_BOOST` as the sun
 * drops toward this day cycle's lowest keyframes (dawn/dusk/evening — see
 * `dayCycle.ts`'s documented no-night floor: elevation never actually
 * reaches the horizon in this world).
 */
export function fogDensityForElevation(sunElevation: number): number {
  return FOG_DENSITY_BASE + FOG_DENSITY_LOW_SUN_BOOST * lowSunFactor(Math.sin(sunElevation));
}
