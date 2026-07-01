import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This file lives under src/ so `npm test` (vitest include = src/**) runs it,
// but it guards a CI-CONFIG deliverable: F1 slice 1 / T7 wires the Seam B
// post-build social-meta check into the pull-request workflow. The runner can't
// execute the GitHub Actions job, but a pure-string assertion over the
// committed workflow YAML CAN prove the step exists, names the right script,
// runs strictly AFTER Build (so dist/index.html exists), never silently
// swallows a red (`continue-on-error` / `|| true`), and — crucially — that the
// separate deploy workflow was NOT given a real-dist social-meta step:
// deploy.yml runs `npm test` BEFORE `npm run build` against a gitignored dist,
// so a dist-reading step there would break the deploy-to-Pages gate on every
// merge. This mirrors src/perf/bundleBudgetCi.test.ts (the proven two-seam
// split: pure-string source/CI checks in `npm test`, real-dist reads in a
// post-build CLI step only).

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// src/share -> repo root is two levels up.
const REPO_ROOT = join(MODULE_DIR, "..", "..");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github", "workflows");
const CI_YML = join(WORKFLOWS_DIR, "ci.yml");
const DEPLOY_YML = join(WORKFLOWS_DIR, "deploy.yml");

const ci = readFileSync(CI_YML, "utf8");
const deploy = readFileSync(DEPLOY_YML, "utf8");

describe("F1 / T7 — Seam B social-meta check wired into CI", () => {
  it("ci.yml defines a 'Check social meta' step that runs `npm run check:social`", () => {
    // The step must exist and run the single-sourced Seam B script — not an
    // inline re-implementation of the social-meta assertions.
    expect(ci).toMatch(/name:\s*Check social meta/);
    expect(ci).toMatch(/run:\s*npm run check:social/);
  });

  it("the Check social meta step runs strictly AFTER the Build step", () => {
    // dist/index.html only exists once `vite build` has run, so the Seam B
    // check is meaningless unless it follows Build. Assert ordering by the
    // character position of each step's `name:` marker in the (ordered) YAML.
    const buildIdx = ci.search(/name:\s*Build/);
    const checkIdx = ci.search(/name:\s*Check social meta/);
    expect(buildIdx).toBeGreaterThan(-1);
    expect(checkIdx).toBeGreaterThan(-1);
    expect(checkIdx).toBeGreaterThan(buildIdx);
  });

  it("the gate never swallows a red — no continue-on-error and no `|| true`", () => {
    // A broken/absent unfurl href MUST fail the job and block the green-only
    // merge; the step is not allowed to pass silently on a red.
    expect(ci).not.toMatch(/continue-on-error/);
    expect(ci).not.toMatch(/\|\|\s*true/);
  });

  it("does NOT add a real-dist social-meta step to deploy.yml", () => {
    // deploy.yml runs `npm test` BEFORE `npm run build` on a gitignored dist;
    // a dist-reading social-meta step there would throw on every merge and
    // break the deploy-to-Pages gate. It must carry neither the step nor the
    // script.
    expect(deploy).not.toMatch(/Check social meta/);
    expect(deploy).not.toMatch(/check:social/);
  });
});
