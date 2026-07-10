// Pure sun-intensity -> IBL-intensity mapping (visual-overhaul slice 2).
//
// `scene.environmentIntensity` scales how much the baked sky environment map
// contributes to every standard material's ambient term. It should track the
// day cycle (dimmer during the low-sun dawn/dusk/evening keyframes, full at
// noon) without ever going overbright or fully dark — the world must stay
// readable at every phase (mirrors dayCycle.ts's own "no-night floors"
// discipline, restated here rather than imported, see below).
//
// Deliberately import-free of `./dayCycle` (and of three/DOM): it takes a
// plain `sunIntensity` number (whatever the day cycle currently reports),
// so it never needs to import the palette type at all — a caller anywhere
// (envLightSystem.ts, tests) can feed it `dayCycle.getPalette().sunIntensity`
// without this module ever touching `dayCycle.ts`.

/**
 * `dayCycle.ts`'s NOON keyframe's `sunIntensity` (its brightest value) and its
 * exported `MIN_SUN_INTENSITY` floor (its dimmest, held by every other
 * keyframe) — RE-STATED here as plain numbers, not imported, mirroring
 * `dayCycle.ts`'s own convention for its sun-direction constants ("re-derived,
 * not shared", see that file's header) so this module has zero dependencies.
 */
const NOON_SUN_INTENSITY = 1.6;
const MIN_SUN_INTENSITY = 0.9;

/** The dimmest the environment map's contribution ever falls to — never fully
 *  dark ambient, even at the day cycle's dimmest (evening) keyframe. */
export const MIN_ENV_INTENSITY = 0.55;
/** The brightest the environment contributes — full strength at noon. */
export const MAX_ENV_INTENSITY = 1.0;

/** GLSL/three-`clamp(x, 0, 1)`-exact clamp; `NaN` folds to 0. */
function clamp01(v: number): number {
  return v > 1 ? 1 : v > 0 ? v : 0;
}

/**
 * Map the day cycle's current sun intensity to `scene.environmentIntensity`.
 * Linearly rescales `[MIN_SUN_INTENSITY, NOON_SUN_INTENSITY]` (the day cycle's
 * own floor/ceiling, see `dayCycle.ts`'s `KEYFRAMES`) onto
 * `[MIN_ENV_INTENSITY, MAX_ENV_INTENSITY]`, clamping any sun intensity outside
 * that range (a total function — never NaN/Infinity/out-of-band for any
 * finite input).
 */
export function environmentIntensityForSunIntensity(sunIntensity: number): number {
  const t = clamp01(
    (sunIntensity - MIN_SUN_INTENSITY) / (NOON_SUN_INTENSITY - MIN_SUN_INTENSITY),
  );
  return MIN_ENV_INTENSITY + (MAX_ENV_INTENSITY - MIN_ENV_INTENSITY) * t;
}
