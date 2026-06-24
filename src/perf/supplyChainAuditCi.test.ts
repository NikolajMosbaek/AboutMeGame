import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This file lives under src/ so `npm test` (vitest include = src/**) runs it,
// but it guards a CI-CONFIG deliverable: SEC1 slice 4 / T1 wires a supply-chain
// audit gate into the pull-request workflow. The gate fails a PR on high/
// critical advisories in SHIPPED dependencies (react / react-dom / three) while
// deliberately excluding dev-only tooling advisories (esbuild/vite/vitest
// family) that never reach a user's browser. A pure-string, no-network
// assertion over the committed package.json + workflow YAML is the honest check
// here — the runner can't execute `npm audit` against the live Advisory DB, but
// it CAN prove the policy is single-sourced and not silently weakened: the exact
// `--omit=dev --audit-level=high` flag string is locked (dropping the carve-out
// or moving the threshold fails CI), the CI step exists and names the script,
// it runs BEFORE Build (the audit reads the installed tree + lockfile, never
// dist/, so it must not depend on a successful build), the gate never swallows
// a red (`continue-on-error` / `|| true`), and the separate deploy workflow was
// not touched.

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// src/perf -> repo root is two levels up.
const REPO_ROOT = join(MODULE_DIR, "..", "..");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github", "workflows");
const PACKAGE_JSON = join(REPO_ROOT, "package.json");
const CI_YML = join(WORKFLOWS_DIR, "ci.yml");
const DEPLOY_YML = join(WORKFLOWS_DIR, "deploy.yml");

const AUDIT_SCRIPT = "npm audit --omit=dev --audit-level=high";
const STEP_NAME = "Audit shipped dependencies (high/critical)";

const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as {
  scripts?: Record<string, string>;
};
const ci = readFileSync(CI_YML, "utf8");

describe("SEC1 / T1 — supply-chain audit gate wired into CI", () => {
  it("package.json single-sources the gate flags in the audit:ci script", () => {
    // The exact flag string is the single source of truth for the policy:
    // `--omit=dev` is the carve-out that scopes the gate to shipped deps, and
    // `--audit-level=high` blocks high AND critical. Locking the literal string
    // means dropping the carve-out, or widening/narrowing the level, fails CI.
    expect(pkg.scripts?.["audit:ci"]).toBe(AUDIT_SCRIPT);
  });

  it("ci.yml defines the audit step that runs `npm run audit:ci`", () => {
    // The step must exist and run the single-sourced gate script — not an
    // inline re-spelling of the audit flags.
    expect(ci).toContain(`name: ${STEP_NAME}`);
    expect(ci).toMatch(/run:\s*npm run audit:ci/);
  });

  it("the audit step runs BEFORE the Build step (does not depend on a build)", () => {
    // `npm audit` reads only the installed tree + lockfile against the advisory
    // DB — it never needs dist/. Running it before Build fails fast on a
    // supply-chain advisory for the cheapest, clearest signal. Assert ordering
    // by character position of the `npm run audit:ci` invocation vs. the Build
    // step's name marker in the (ordered) YAML step list.
    const auditIdx = ci.search(/run:\s*npm run audit:ci/);
    const buildIdx = ci.search(/name:\s*Build/);
    expect(auditIdx).toBeGreaterThan(-1);
    expect(buildIdx).toBeGreaterThan(-1);
    expect(auditIdx).toBeLessThan(buildIdx);
  });

  it("the gate never swallows a red — no continue-on-error and no `|| true`", () => {
    // A high/critical advisory in a shipped dep MUST fail the job and block the
    // green-only merge. (Shared invariant with the bundle-size gate.)
    expect(ci).not.toMatch(/continue-on-error/);
    expect(ci).not.toMatch(/\|\|\s*true/);
  });

  it("does not touch the deploy workflow — no audit gate added to deploy.yml", () => {
    const deploy = readFileSync(DEPLOY_YML, "utf8");
    expect(deploy).not.toContain("audit:ci");
    expect(deploy).not.toContain(STEP_NAME);
  });
});
