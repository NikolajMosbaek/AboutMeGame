import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This file lives under src/ so `npm test` (vitest include = src/**) runs it,
// but it guards a DOCS-AND-GOVERNANCE deliverable: SEC1 closing slice (#139)
// adds two root files (LICENSE, SECURITY.md), corrects the stale 'review gate'
// line in docs/perf-budget.md to describe the already-shipped automated bundle
// gate, points the charter at that doc by reference, and reconciles the README
// License section. A pure-string, no-network assertion over the committed files
// is the honest check here — there is nothing to execute; the prose either says
// the right thing or it does not.
//
// Single-sourcing is the invariant: every threshold/flag/number lives in exactly
// ONE place (PERF_BUDGET in perfBudget.ts for the caps), and every document
// points at it rather than restating it. So this test must itself restate NO
// caps — it asserts the documents POINT at PERF_BUDGET, never that they contain
// a literal cap value. There is deliberately no `400` or `6000` literal below.
//
// The sharpest landmine: the existing supplyChainAuditCi.test.ts asserts the
// charter MUST NOT contain 'Supply-chain audit', 'audit:ci', or '--omit=dev'.
// This suite asserts the same forbidden tokens stay absent so the new charter
// pointer line cannot be phrased in a way that turns that sibling test red.

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// src/perf -> repo root is two levels up.
const REPO_ROOT = join(MODULE_DIR, "..", "..");

const LICENSE = join(REPO_ROOT, "LICENSE");
const SECURITY = join(REPO_ROOT, "SECURITY.md");
const PERF_BUDGET_DOC = join(REPO_ROOT, "docs", "perf-budget.md");
const CHARTER_DOC = join(REPO_ROOT, "docs", "team", "charter.md");
const README = join(REPO_ROOT, "README.md");

const read = (path: string): string => readFileSync(path, "utf8");

describe("SEC1 / #139 — (a) root LICENSE is MIT with the owner-of-record line", () => {
  it("a LICENSE file exists at the repo root", () => {
    expect(existsSync(LICENSE)).toBe(true);
  });

  it("it is the MIT license", () => {
    expect(read(LICENSE)).toMatch(/MIT/);
  });

  it("it carries the 2026 / Nikolaj Simonsen copyright line", () => {
    // Year 2026 (first commit and HEAD both 2026); holder = the human git author
    // identity, NOT the GitHub org slug. The decider recorded MIT-by-default and
    // this exact holder/year as a reversible owner-of-record call.
    expect(read(LICENSE)).toMatch(/Copyright \(c\) 2026 Nikolaj Simonsen/);
  });
});

describe("SEC1 / #139 — (b) root SECURITY.md scoped to the client-only SPA reality", () => {
  const security = (): string => read(SECURITY);

  it("a SECURITY.md file exists at the repo root", () => {
    expect(existsSync(SECURITY)).toBe(true);
  });

  it("states the static client-only / no-backend scope", () => {
    expect(security()).toMatch(/client-only|client only/i);
    expect(security()).toMatch(/no backend|no back-end|no server/i);
  });

  it("states there is no auth and no PII collected or transmitted", () => {
    expect(security()).toMatch(/no auth|no authentication/i);
    expect(security()).toMatch(/no (personal data|pii)/i);
  });

  it("documents exactly one disclosure path: GitHub private vulnerability reporting", () => {
    expect(security()).toMatch(/private vulnerability reporting/i);
  });

  it("states the supply-chain posture by reference (Dependabot + the npm-audit gate)", () => {
    expect(security()).toMatch(/Dependabot/);
    expect(security()).toMatch(/audit/i);
    // By reference, not by restatement: point at the canonical doc, do not
    // re-spell the gate flags or the threshold here.
    expect(security()).toMatch(/perf-budget\.md/);
  });

  it("does not depend on or mention the license decision", () => {
    // SECURITY.md ships independently of the license choice — it must not name
    // MIT or otherwise couple itself to a decision that is reversible on its own.
    expect(security()).not.toMatch(/\bMIT\b/);
    expect(security()).not.toMatch(/\blicense\b/i);
  });
});

describe("SEC1 / #139 — (c) docs/perf-budget.md documents the automated bundle gate", () => {
  const perfDoc = (): string => read(PERF_BUDGET_DOC);

  it("no longer calls the bundle cap a 'review gate'", () => {
    expect(perfDoc()).not.toMatch(/review gate/);
  });

  it("names the automated check (npm run check:bundle / the measuring script)", () => {
    expect(perfDoc()).toMatch(/check:bundle/);
    expect(perfDoc()).toMatch(/scripts\/check-bundle-size\.mjs/);
  });

  it("references PERF_BUDGET as the single source of the caps", () => {
    expect(perfDoc()).toMatch(/PERF_BUDGET/);
  });

  it("still documents the #138 audit carve-out (not regressed)", () => {
    // The bundle-line edit must not disturb slice #138's Supply-chain audit
    // subsection. Guard its load-bearing phrases.
    expect(perfDoc()).toMatch(/Supply-chain audit/);
    expect(perfDoc()).toMatch(/high or critical/i);
  });
});

describe("SEC1 / #139 — (d) docs/team/charter.md points at the policy by reference only", () => {
  const charter = (): string => read(CHARTER_DOC);

  it("references docs/perf-budget.md and PERF_BUDGET", () => {
    expect(charter()).toMatch(/perf-budget\.md/);
    expect(charter()).toMatch(/PERF_BUDGET/);
  });

  it("contains NONE of the forbidden tokens (keeps supplyChainAuditCi.test.ts green)", () => {
    // Mirror of supplyChainAuditCi.test.ts's 'canonical policy is NOT duplicated
    // in the charter' guard — restated here so the new pointer line cannot drift
    // into wording that turns the sibling test red.
    expect(charter()).not.toMatch(/Supply-chain audit/i);
    expect(charter()).not.toMatch(/audit:ci/);
    expect(charter()).not.toMatch(/--omit=dev/);
  });
});

describe("SEC1 / #139 — (e) README License section is one coherent story", () => {
  const readme = (): string => read(README);

  it("points the code license at the new root LICENSE", () => {
    expect(readme()).toMatch(/LICENSE/);
  });

  it("preserves the content/ carve-out grounded in PROVENANCE.md", () => {
    expect(readme()).toMatch(/content\/PROVENANCE\.md/);
  });
});
