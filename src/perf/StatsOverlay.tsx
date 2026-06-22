import { useEffect, useState } from "react";
import type { Engine } from "../engine/Engine.ts";
import { checkFrame, PERF_BUDGET } from "./perfBudget.ts";

export interface StatsOverlayProps {
  engine: Engine;
  /** How often to sample (ms). 250ms reads smoothly without churn. */
  intervalMs?: number;
}

/**
 * Runtime perf/stats overlay (issue #14): live fps, draw calls and triangles,
 * sampled from the engine and checked against `PERF_BUDGET`. Turns red the
 * moment a frame breaches the budget, so a regression is visible while playing.
 * Polls `getState()` on a timer rather than per-frame, so the overlay itself
 * costs almost nothing.
 */
export function StatsOverlay({ engine, intervalMs = 250 }: StatsOverlayProps) {
  const [state, setState] = useState(() => engine.getState());

  useEffect(() => {
    const id = setInterval(() => setState(engine.getState()), intervalMs);
    return () => clearInterval(id);
  }, [engine, intervalMs]);

  const verdict = checkFrame(
    { fps: state.fps, drawCalls: state.drawCalls, triangles: state.triangles },
    PERF_BUDGET,
  );

  return (
    <div
      className={`stats-overlay${verdict.withinBudget ? "" : " stats-overlay--breach"}`}
      role="status"
      aria-label="performance statistics"
    >
      <span>{state.fps.toFixed(0)} fps</span>
      <span>{state.drawCalls} draws</span>
      <span>{(state.triangles / 1000).toFixed(0)}k tris</span>
      {!verdict.withinBudget && (
        <span className="stats-overlay__breach" title={verdict.breaches.join("; ")}>
          ⚠ over budget
        </span>
      )}
    </div>
  );
}
