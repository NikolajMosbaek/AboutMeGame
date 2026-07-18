// The performance budget, as code (issue #13).
//
// "Runs on a mid-range phone" is the bar (Epic 6). Expressing the budget as
// typed numbers — not just prose — lets the stats overlay (#14) flag a live
// breach and lets tests assert the bundle/asset caps. The rationale and how it
// was derived live in `docs/perf-budget.md`.

export interface PerfBudget {
  /** Frame-rate floor on the *target mid-range device*. Below this, the quality
   *  scaler (Epic 6) should step down. */
  targetFpsMobile: number;
  /** Desired frame rate on desktop. */
  targetFpsDesktop: number;
  /** Hard frame-time ceiling (ms) on mobile — derived from `targetFpsMobile`. */
  frameBudgetMsMobile: number;
  /** Draw calls per frame. Three.js batches poorly across materials, so this is
   *  the number to watch first when the world grows. */
  maxDrawCalls: number;
  /** Rendered triangles per frame across the whole scene. */
  maxTriangles: number;
  /** Gzipped JS shipped on first load (KB). three is ~155KB gzip of this. */
  maxJsGzipKb: number;
  /** Total bytes downloaded before the world is interactive (KB), incl. assets. */
  maxInitialDownloadKb: number;
  /** Time-to-interactive target on a 4G connection (seconds). */
  maxTimeToInteractiveSec: number;
}

export const PERF_BUDGET: PerfBudget = {
  targetFpsMobile: 30,
  targetFpsDesktop: 60,
  frameBudgetMsMobile: 1000 / 30,
  maxDrawCalls: 150,
  maxTriangles: 500_000,
  // 400 → 432 (2026-07-18, approved): the reactive-jungle epic ("The Jungle
  // Notices You", docs/superpowers/specs/2026-07-18-jungle-notices-you-design.md)
  // ships behavior code only — zero asset bytes — and the cap sat 4.8 KB from
  // full. Deliberate amendment, recorded in docs/perf-budget.md.
  maxJsGzipKb: 432,
  maxInitialDownloadKb: 6_000,
  maxTimeToInteractiveSec: 4,
};

export interface FrameSample {
  fps: number;
  drawCalls: number;
  triangles: number;
}

export interface BudgetVerdict {
  withinBudget: boolean;
  /** Human-readable reasons a sample is over budget (empty when within). */
  breaches: string[];
}

/** Check a live frame sample against the budget. Used by the stats overlay to
 *  turn the read-out red and by perf tests to assert headroom. */
export function checkFrame(
  sample: FrameSample,
  budget: PerfBudget = PERF_BUDGET,
): BudgetVerdict {
  const breaches: string[] = [];
  if (sample.fps < budget.targetFpsMobile) {
    breaches.push(
      `fps ${sample.fps.toFixed(0)} < target ${budget.targetFpsMobile}`,
    );
  }
  if (sample.drawCalls > budget.maxDrawCalls) {
    breaches.push(
      `draw calls ${sample.drawCalls} > max ${budget.maxDrawCalls}`,
    );
  }
  if (sample.triangles > budget.maxTriangles) {
    breaches.push(
      `triangles ${sample.triangles} > max ${budget.maxTriangles}`,
    );
  }
  return { withinBudget: breaches.length === 0, breaches };
}
