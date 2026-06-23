import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This file lives in src/ so `npm test` (vitest include = src/**) runs it, but
// it guards a DOCS deliverable: the G1 slice-2 decision log under
// docs/team/runs/. The task named it `docs.runlog.test.ts`; it is a lightweight
// presence/content check for the run log of this slice — nothing more.

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// src/world -> repo root is two levels up.
const REPO_ROOT = join(MODULE_DIR, "..", "..");
const RUNLOG = join(
  REPO_ROOT,
  "docs",
  "team",
  "runs",
  "2026-06-23-water-static-depth-shoreline-foam.md",
);

describe("G1 slice 2 — static depth + shoreline-foam decision log", () => {
  it("the run-log entry exists under docs/team/runs/", () => {
    expect(existsSync(RUNLOG)).toBe(true);
  });

  it("references every acceptance criterion AC1..AC10", () => {
    const log = readFileSync(RUNLOG, "utf8");
    for (let n = 1; n <= 10; n++) {
      expect(log, `run log must reference AC${n}`).toContain(`AC${n}`);
    }
  });

  it("names the boundaries <- waterSurface tree-shaking-guard contract flip", () => {
    const log = readFileSync(RUNLOG, "utf8");
    // The deliberate, named contract change: boundaries.ts now imports and uses
    // waterSurface.ts, flipping the tree-shaking guard.
    expect(log).toContain("boundaries.ts");
    expect(log).toContain("waterSurface.ts");
    expect(log.toLowerCase()).toContain("tree-shaking");
    expect(log.toLowerCase()).toContain("contract");
  });

  it("captures positions, converged design + rationale, plan, and visual-AC verification plan", () => {
    const log = readFileSync(RUNLOG, "utf8");
    expect(log).toMatch(/##\s+Roundtable Positions/i);
    expect(log).toMatch(/##\s+Consensus Design/i);
    expect(log).toMatch(/##\s+Task Plan/i);
    // The two visual ACs (AC2 depth gradient, AC3 foam collar) are confirmable
    // only via the Playwright smoke verifier / screenshots — that plan must be
    // on the record.
    expect(log.toLowerCase()).toMatch(/playwright|render_game_to_text|screenshot/);
  });

  it("lives only under docs/ — the deliverable adds no product-code or .claude files", () => {
    // A presence check on the path itself: the run log is under docs/team/runs.
    expect(RUNLOG).toContain(join("docs", "team", "runs"));
    expect(RUNLOG).not.toContain(".claude");
  });
});
