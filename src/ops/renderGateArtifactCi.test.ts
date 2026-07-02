import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import yaml from "js-yaml";

/*
 * Q1 (#134) — render-gate evidence artifact guard.
 *
 * The render-gate job's verdict is the exit code of `npm run verify`; its
 * EVIDENCE is the screenshot the verifier drops at the repo root. This guard
 * pins the upload step's parsed structure so the evidence channel cannot rot
 * silently:
 *
 *  - `if: always()` — a red run is exactly when the screenshot matters most;
 *    without it the artifact only survives green runs and the gate loses its
 *    diagnostic value.
 *  - `path: *.png` (repo-root-only glob) — safe ONLY while zero committed PNGs
 *    sit at the repo root. 28 committed PNGs live under public/,
 *    docs/team/runs/assets/, and .claude/skills/ (they are NOT gitignored);
 *    widening to the recursive double-star glob would bury the one-frame run
 *    evidence under committed assets. The git-invariant test below keeps that
 *    premise true.
 *  - `if-no-files-found: warn` — a build-phase red legitimately produces no
 *    PNG; it must not stack a second red on top of the real one.
 *
 * Structural assertions go through a YAML parse (regex over raw text passes on
 * indentation YAML would reject); only the pinned rationale COMMENT is asserted
 * on raw text, because comments do not survive parsing.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CI_YML = resolve(REPO_ROOT, ".github", "workflows", "ci.yml");

interface WorkflowStep {
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
}

interface Workflow {
  jobs?: Record<string, { steps?: WorkflowStep[] }>;
}

const raw = readFileSync(CI_YML, "utf8");
const workflow = yaml.load(raw) as Workflow;
const steps = workflow.jobs?.["render-gate"]?.steps ?? [];

describe("Q1 #134 — render-gate uploads the verifier screenshot as run evidence", () => {
  it("the final render-gate step is actions/upload-artifact@v4", () => {
    expect(steps.length).toBeGreaterThan(0);
    const last = steps[steps.length - 1];
    expect(last.uses).toBe("actions/upload-artifact@v4");
  });

  it("exactly one upload-artifact step exists in render-gate", () => {
    const uploads = steps.filter((s) =>
      (s.uses ?? "").startsWith("actions/upload-artifact"),
    );
    expect(uploads).toHaveLength(1);
  });

  it("uploads on BOTH green and red outcomes via `if: always()`", () => {
    const last = steps[steps.length - 1];
    expect(last.if).toBe("always()");
  });

  it("names the artifact render-verifier-screenshot and globs repo-root PNGs only", () => {
    const last = steps[steps.length - 1];
    expect(last.with?.name).toBe("render-verifier-screenshot");
    expect(last.with?.path).toBe("*.png");
  });

  it("sets if-no-files-found: warn explicitly (a pre-screenshot red must not stack a second red)", () => {
    const last = steps[steps.length - 1];
    expect(last.with?.["if-no-files-found"]).toBe("warn");
  });

  it("pins the glob rationale in a ci.yml comment: root is clean, never widen to **/*.png", () => {
    // Comments vanish in the parse, so this one assertion reads the raw text.
    expect(raw).toContain("never widen this path to `**/*.png`");
    expect(raw).toContain("zero committed PNGs sit at the repo root");
    expect(raw).toContain("NOT gitignored");
  });

  it("the glob's premise holds: no committed PNG at the repo root (git ls-files)", () => {
    // The `*.png` glob is safe only while the repo root stays PNG-free. The
    // verifier's screenshots land at the root untracked, so a filesystem
    // check would false-red after a local `npm run verify`; the tracked-file
    // list is the honest source. If this reds, someone committed a root-level
    // PNG — move it (public/ or docs/team/runs/assets/) rather than widening
    // the glob.
    const tracked = execSync('git ls-files -- "*.png"', {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    const atRoot = tracked.filter((p) => !p.includes("/"));
    expect(atRoot).toEqual([]);
  });
});
