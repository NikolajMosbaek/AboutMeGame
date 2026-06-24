import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This file lives under src/ so `npm test` (vitest include = src/**) runs it,
// but it guards a CI-CONFIG deliverable: SEC1 slice 2 / T8 wires the
// bundle-size gate into the pull-request workflow. The gate only protects the
// 400 KB JS-gzip / 6 MB initial-download caps if it actually runs in CI, AFTER
// the build has produced `dist/`. A pure-string assertion over the committed
// workflow YAML is the honest check here — the runner can't execute the GitHub
// Actions job, but it CAN prove the step exists, names the right script, runs
// strictly after Build, never silently swallows a red (`continue-on-error` /
// `|| true`), and that the separate deploy workflow was not touched.

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// src/perf -> repo root is two levels up.
const REPO_ROOT = join(MODULE_DIR, "..", "..");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github", "workflows");
const CI_YML = join(WORKFLOWS_DIR, "ci.yml");
const DEPLOY_YML = join(WORKFLOWS_DIR, "deploy.yml");

const ci = readFileSync(CI_YML, "utf8");

describe("SEC1 / T8 — bundle-size gate wired into CI", () => {
  it("ci.yml defines a 'Check bundle size' step that runs `npm run check:bundle`", () => {
    // The step must exist and run the single-sourced gate script — not an
    // inline re-implementation of the budget logic.
    expect(ci).toMatch(/name:\s*Check bundle size/);
    expect(ci).toMatch(/run:\s*npm run check:bundle/);
  });

  it("the Check bundle size step runs strictly AFTER the Build step", () => {
    // dist/ only exists once `vite build` has run, so the gate is meaningless
    // unless it follows Build. Assert ordering by character position of each
    // step's `name:` marker in the (ordered) YAML step list.
    const buildIdx = ci.search(/name:\s*Build/);
    const checkIdx = ci.search(/name:\s*Check bundle size/);
    expect(buildIdx).toBeGreaterThan(-1);
    expect(checkIdx).toBeGreaterThan(-1);
    expect(checkIdx).toBeGreaterThan(buildIdx);
  });

  it("the gate runs in the same job as Build (Lint -> Build -> Test -> Check bundle size)", () => {
    // One job so the build artifact is in scope; assert the full intended order.
    const lintIdx = ci.search(/name:\s*Lint/);
    const buildIdx = ci.search(/name:\s*Build/);
    const testIdx = ci.search(/name:\s*Test/);
    const checkIdx = ci.search(/name:\s*Check bundle size/);
    expect(lintIdx).toBeGreaterThan(-1);
    expect(lintIdx).toBeLessThan(buildIdx);
    expect(buildIdx).toBeLessThan(testIdx);
    expect(testIdx).toBeLessThan(checkIdx);
  });

  it("the gate never swallows a red — no continue-on-error and no `|| true`", () => {
    // An over-budget bundle MUST fail the job and block the green-only merge.
    expect(ci).not.toMatch(/continue-on-error/);
    expect(ci).not.toMatch(/\|\|\s*true/);
  });

  it("does not touch the deploy workflow — no bundle gate added to deploy.yml", () => {
    const deploy = readFileSync(DEPLOY_YML, "utf8");
    expect(deploy).not.toMatch(/check:bundle/);
    expect(deploy).not.toMatch(/Check bundle size/);
  });
});
