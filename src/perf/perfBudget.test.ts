import { describe, expect, it } from "vitest";
import { checkFrame, PERF_BUDGET } from "./perfBudget.ts";

describe("perf budget", () => {
  it("a healthy frame is within budget", () => {
    const verdict = checkFrame({ fps: 60, drawCalls: 40, triangles: 120_000 });
    expect(verdict.withinBudget).toBe(true);
    expect(verdict.breaches).toEqual([]);
  });

  it("flags a low frame rate", () => {
    const verdict = checkFrame({ fps: 22, drawCalls: 40, triangles: 1000 });
    expect(verdict.withinBudget).toBe(false);
    expect(verdict.breaches.join(" ")).toMatch(/fps/);
  });

  it("flags too many draw calls and triangles, listing each breach", () => {
    const verdict = checkFrame({
      fps: 60,
      drawCalls: PERF_BUDGET.maxDrawCalls + 1,
      triangles: PERF_BUDGET.maxTriangles + 1,
    });
    expect(verdict.withinBudget).toBe(false);
    expect(verdict.breaches.length).toBe(2);
  });

  it("frame budget is the inverse of the mobile fps target", () => {
    expect(PERF_BUDGET.frameBudgetMsMobile).toBeCloseTo(
      1000 / PERF_BUDGET.targetFpsMobile,
      6,
    );
  });
});
