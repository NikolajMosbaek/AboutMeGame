// Speed vignette intensity (#53 movement feedback) — the pure mapping from the
// HUD's speed read to a 0..1 vignette opacity, split out so the curve is
// unit-testable without the DOM. The `SpeedVignette` component pipes the hud
// store through this and drives a CSS custom property.
//
// A DOM vignette is the cheapest possible speed cue — zero extra draw calls and
// no particles in the WebGL path — so it never threatens the perf budget. It is
// non-essential motion, so the component gates it behind reduced motion.

/** Below this speed (m/s) there's no vignette — slow cruising stays clean. */
const SPEED_FLOOR = 28;
/** Speed (m/s) at which the vignette reaches full strength. */
const SPEED_FULL = 90;
/** Cap so even at full boost the edges only darken, never black out the view. */
const MAX_OPACITY = 0.34;

/**
 * Map a speed (m/s) to vignette opacity 0..`MAX_OPACITY`. Ramps linearly from
 * `SPEED_FLOOR` to `SPEED_FULL`, clamped at both ends and rounded to two
 * decimals so it doesn't churn the DOM on sub-pixel speed jitter.
 */
export function vignetteOpacity(speed: number): number {
  if (speed <= SPEED_FLOOR) return 0;
  const t = Math.min((speed - SPEED_FLOOR) / (SPEED_FULL - SPEED_FLOOR), 1);
  return Math.round(t * MAX_OPACITY * 100) / 100;
}
