// Pure scheduling logic for regenerating the sky-driven IBL environment map
// (PMREM) as the day cycle moves (visual-overhaul slice 2). Kept import-free
// of `./dayCycle` (and of three/DOM/WebGL) so it stays headless-testable — the
// WebGL-touching bake itself lives in `envLightSystem.ts`, which owns nothing
// but "call `paletteDelta`/`shouldRebake` and act on the answer."
//
// The design goal: regenerate the environment map when the sky has visibly
// moved, but never more often than roughly once every couple of seconds — a
// PMREM bake is real GPU cost (several cubemap-face renders plus a filter
// pass), so this is the knob that keeps it "transient work, not a steady
// per-frame cost" (see docs/perf-budget.md).

/**
 * The 3 colour channels the environment bake actually depends on — the sky
 * dome's gradient plus the sun colour that tints its glow. A `DayPalette`
 * (`./dayCycle.ts`) satisfies this structurally; this module never imports
 * that file (keeping `dayCycle.ts`'s locked single-importer contract intact —
 * see `dayCycle.test.ts`'s tree-shaking guard), it just duck-types the fields
 * it needs.
 */
export interface EnvColorSample {
  sunColor: readonly [number, number, number];
  domeTop: readonly [number, number, number];
  domeBottom: readonly [number, number, number];
}

export interface EnvBakeConfig {
  /** Minimum real seconds between successive rebakes, however fast the sky is
   *  moving — the "capped at ~1 regen every couple of seconds" rule. */
  minIntervalSeconds: number;
  /** Minimum summed colour delta (sun colour + dome top + dome bottom, each an
   *  absolute per-channel sum) that justifies spending a rebake. */
  deltaThreshold: number;
}

/**
 * The tuned defaults. Measured against the actual day-cycle pace
 * (`PERIOD_SECONDS` = 180s per full loop, `dayCycleSystem.ts`): sweeping
 * `dayPalette` across one whole loop at 60 Hz and feeding real consecutive
 * palettes through this scheduler yields a rebake roughly every 2.0–2.1s
 * almost everywhere in the loop (a rebake close to the `minIntervalSeconds`
 * cap — see `envBakeScheduler.test.ts`'s swept measurement) — so in practice
 * the cadence is governed by the interval cap, and the delta gate exists to
 * skip a bake entirely once the palette has stopped moving (reduced motion's
 * golden-hour pin, or a stalled/backgrounded tab), however long it's been.
 */
export const DEFAULT_ENV_BAKE_CONFIG: EnvBakeConfig = {
  minIntervalSeconds: 2,
  deltaThreshold: 0.05,
};

function colorDelta(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

/**
 * Summed absolute colour drift between two samples across the 3 channels the
 * bake depends on. 0 when identical (e.g. the reduced-motion golden-hour pin,
 * which resamples the SAME palette every frame).
 */
export function paletteDelta(a: EnvColorSample, b: EnvColorSample): number {
  return (
    colorDelta(a.sunColor, b.sunColor) +
    colorDelta(a.domeTop, b.domeTop) +
    colorDelta(a.domeBottom, b.domeBottom)
  );
}

/**
 * Decide whether a rebake is due right now. `secondsSinceLastBake` gates the
 * cadence cap FIRST (so a fast-moving palette can never rebake more often
 * than the cap allows); only once past the cap does `delta` (from
 * {@link paletteDelta}) need to have moved past `config.deltaThreshold` — so a
 * palette that has stopped changing never rebakes again, however long it's
 * been held.
 */
export function shouldRebake(
  secondsSinceLastBake: number,
  delta: number,
  config: EnvBakeConfig,
): boolean {
  if (secondsSinceLastBake < config.minIntervalSeconds) return false;
  return delta >= config.deltaThreshold;
}
