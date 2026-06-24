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
const PERF_BUDGET_DOC = join(REPO_ROOT, "docs", "perf-budget.md");
const CHARTER_DOC = join(REPO_ROOT, "docs", "team", "charter.md");

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

describe("SEC1 / T5 — supply-chain audit policy documented once", () => {
  // T1–T4 prove the gate is wired and not silently weakened; this block guards
  // the canonical PROSE policy. The carve-out ('dev-only advisories are
  // excluded because they never reach a user's browser') is the one thing the
  // flag string alone can't explain, so it must be written down exactly once —
  // in docs/perf-budget.md's 'How it is enforced' section — and NOT duplicated
  // in the charter (the charter mandates single-sourcing; dual-sourcing
  // reintroduces the drift that retired backlog.md). No network: pure string
  // assertions over the committed markdown.
  const perfDoc = readFileSync(PERF_BUDGET_DOC, "utf8");

  it("docs/perf-budget.md has exactly one 'Supply-chain audit' subsection", () => {
    const headings = perfDoc.match(/^#{2,4}\s+Supply-chain audit\s*$/gim) ?? [];
    expect(headings).toHaveLength(1);
  });

  it("the subsection sits under the 'How it is enforced' section", () => {
    const enforcedIdx = perfDoc.search(/^##\s+How it is enforced\s*$/im);
    const subsectionIdx = perfDoc.search(/^#{3,4}\s+Supply-chain audit\s*$/im);
    expect(enforcedIdx).toBeGreaterThan(-1);
    expect(subsectionIdx).toBeGreaterThan(-1);
    // The subsection comes after the section heading, and no later top-level
    // (## ) heading intervenes — i.e. it is a child of 'How it is enforced'.
    expect(subsectionIdx).toBeGreaterThan(enforcedIdx);
    const between = perfDoc.slice(enforcedIdx + 1, subsectionIdx);
    expect(between).not.toMatch(/^##\s+\S/m);
  });

  it("the policy names the shipped closure react / react-dom / three", () => {
    expect(perfDoc).toMatch(/react-dom/);
    expect(perfDoc).toMatch(/\bthree\b/);
    expect(perfDoc).toMatch(/\breact\b/);
  });

  it("the policy states the high+critical threshold (moderate/low do not block)", () => {
    // 'audit passes' must never be misread as 'zero advisories': the doc must
    // say high covers critical too, AND that moderate/low in shipped deps do
    // not block (a deliberate threshold choice).
    expect(perfDoc).toMatch(/high/i);
    expect(perfDoc).toMatch(/critical/i);
    expect(perfDoc).toMatch(/moderate/i);
    expect(perfDoc).toMatch(/\blow\b/i);
  });

  it("the policy explains the dependencies-vs-devDependencies carve-out line", () => {
    // The line is drawn by dependency-graph membership, explicitly NOT a
    // hardcoded allowlist (the doc must name both halves and reject the
    // allowlist reading rather than merely avoiding the word).
    expect(perfDoc).toMatch(/devDependencies/);
    expect(perfDoc).toMatch(/\bdependencies\b/);
    expect(perfDoc).toMatch(/not\b[^.]*allowlist/i);
  });

  it("the policy notes the dev-only exclusion is deferred / tracked (H2 / Dependabot #137)", () => {
    expect(perfDoc).toMatch(/Dependabot/);
    expect(perfDoc).toMatch(/#137/);
  });

  it("the policy notes the gate is advisory-DB-time-sensitive (green can later go red)", () => {
    // A previously-green PR can later go red with no code change — triage, never
    // silence. The doc must say so and forbid the swallow.
    expect(perfDoc).toMatch(/Advisory\s+DB|advisory\s+database/i);
    expect(perfDoc).toMatch(/continue-on-error/);
    expect(perfDoc).toMatch(/\|\| true/);
  });

  it("the canonical policy is NOT duplicated in the charter", () => {
    const charter = readFileSync(CHARTER_DOC, "utf8");
    expect(charter).not.toMatch(/Supply-chain audit/i);
    expect(charter).not.toMatch(/audit:ci/);
    expect(charter).not.toMatch(/--omit=dev/);
  });
});
