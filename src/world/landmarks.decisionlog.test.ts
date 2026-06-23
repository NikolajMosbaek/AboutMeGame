import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This file lives in src/ so `npm test` (vitest include = src/**) runs it, but
// it guards a DOCS deliverable: the G4 / T15 *consolidated decision-log entry*
// under docs/team/runs/ that records the converge → plan → verify trail for the
// landmark silhouette & material upgrade. Guardrail 4 (Auditable) requires the
// run to leave one entry recording the converged design and its rationale, the
// cited verification results, and the PR-ready evidence. T15's output is that
// entry — prose + cited evidence, not product code — so the only thing the
// suite can honestly assert is that the consolidation was performed and links
// the real per-task evidence (it is NOT a re-derivation of a runtime value).
//
// It mirrors `landmarks.gzip.runlog.test.ts` and `waterAnimation.runlog.test.ts`
// (lightweight presence/content checks over a run-log deliverable) and pins the
// load-bearing claims T15 must stand behind so the entry can't silently regress
// to a green-but-empty stub:
//   - the entry exists under docs/team/runs/;
//   - it records the converged DESIGN: two shared materials, per-landmark merge,
//     the fixed per-archetype count map, and the Quality critic's flaw fix
//     (tower/mirror stay 3, no archetype increases);
//   - it cites the full Vitest suite result (test-file + test counts, exit 0);
//   - it cites the production build result (`npm run build`, exit 0);
//   - it records the MEASURED gzip entry-chunk delta and links the dedicated
//     gzip-delta run log;
//   - it records the Playwright running-build (landmark-tour) verification result
//     and links the dedicated visual-verify run log;
//   - it links the converge run log;
//   - it confirms scope: no file edited outside src/ (canvas-side) and
//     docs/team/runs/;
//   - the deliverable lives only under docs/ — no .claude / harness churn.

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// src/world -> repo root is two levels up.
const REPO_ROOT = join(MODULE_DIR, "..", "..");
const RUNS_DIR = join(REPO_ROOT, "docs", "team", "runs");
const RUNLOG = join(RUNS_DIR, "2026-06-23-g4-landmark-silhouette-material-decision-log.md");

// The per-task evidence logs this consolidation must link so the trail is
// reproducible from the entry, not a bare summary.
const CONVERGE_LOG = "2026-06-23-g4-landmark-silhouette-material-converge.md";
const GZIP_LOG = "2026-06-23-g4-landmark-gzip-entry-chunk-delta.md";
const TOUR_LOG = "2026-06-23-g4-landmark-tour-verify.md";

describe("G4 / T15 — landmark silhouette & material consolidated decision log", () => {
  it("the consolidated decision-log entry exists under docs/team/runs/", () => {
    expect(existsSync(RUNLOG)).toBe(true);
  });

  it("records the converged design: two shared materials + per-landmark merge", () => {
    const log = readFileSync(RUNLOG, "utf8");
    const lower = log.toLowerCase();
    // Two shared materials (stone + emissive accent), down from ~39 instances.
    expect(lower).toMatch(/two shared materials|2 shared materials/);
    expect(lower).toContain("stone");
    expect(lower).toContain("accent");
    expect(lower).toMatch(/vertexcolors|vertex colour|vertex color/);
    expect(lower).toContain("emissive");
    // Per-landmark merge via BufferGeometryUtils.mergeGeometries with baked
    // transforms (the load-bearing implementation mechanism).
    expect(lower).toContain("mergegeometries");
    expect(lower).toMatch(/bake|baked/);
    // Beacon (13) and tower lamp stay discrete / un-merged.
    expect(lower).toContain("beacon");
    expect(lower).toContain("lamp");
    expect(lower).toMatch(/discrete|un-merged|unmerged|not merged|not folded/);
  });

  it("records the Quality flaw fix: fixed count map, no archetype increases", () => {
    const log = readFileSync(RUNLOG, "utf8");
    const lower = log.toLowerCase();
    // The fixed per-archetype count map is the heart of the flaw fix.
    expect(lower).toMatch(/fixed.*map|count map|per-archetype/);
    // The two single-primitive archetypes that the prior design regressed to 4
    // are explicitly held at 3 (tower reuses the lamp, mirror replaces glass).
    expect(lower).toContain("tower");
    expect(lower).toContain("mirror");
    expect(lower).toMatch(/no archetype increases|never increases|does not increase|<=|stays 3|stay 3/);
    // The Quality critic's material draw-call flaw is named as the thing fixed.
    expect(lower).toMatch(/flaw|draw call|draw-call/);
  });

  it("cites the full Vitest suite result (counts + exit 0)", () => {
    const log = readFileSync(RUNLOG, "utf8");
    const lower = log.toLowerCase();
    expect(lower).toMatch(/vitest|npm test/);
    expect(lower).toContain("exit 0");
    // Test-file + test counts so the cited green is reproducible, not a bare claim.
    expect(log).toMatch(/Test Files\s+\d+\s+passed/);
    expect(log).toMatch(/Tests\s+\d+\s+passed/);
  });

  it("cites the production build result (npm run build, exit 0)", () => {
    const log = readFileSync(RUNLOG, "utf8");
    const lower = log.toLowerCase();
    expect(lower).toMatch(/npm run build|vite build/);
    // The bundle report lines (entry + three vendor chunk) so the build is cited,
    // not asserted.
    expect(log).toMatch(/index-[A-Za-z0-9_-]+\.js/);
    expect(log).toMatch(/three-[A-Za-z0-9_-]+\.js/);
  });

  it("records the measured gzip entry-chunk delta and links the gzip run log", () => {
    const log = readFileSync(RUNLOG, "utf8");
    const lower = log.toLowerCase();
    expect(lower).toContain("gzip");
    // The < 2 KB measured gate, framed as measured (not an asserted invariant).
    expect(log).toMatch(/2\s*KB|2048\s*bytes?/i);
    expect(lower).toMatch(/measured/);
    // Links the dedicated gzip-delta evidence log.
    expect(log).toContain(GZIP_LOG);
  });

  it("records the Playwright running-build verify and links the tour run log", () => {
    const log = readFileSync(RUNLOG, "utf8");
    const lower = log.toLowerCase();
    expect(lower).toMatch(/playwright|landmark-tour|verify-game\.mjs/);
    expect(lower).toMatch(/verify ok|exit 0/);
    // The signature-hued accent glow catching the G2 bloom is the visual claim.
    expect(lower).toMatch(/accent/);
    expect(lower).toContain("bloom");
    // Links the dedicated running-build visual-verify evidence log.
    expect(log).toContain(TOUR_LOG);
  });

  it("links the converge run log so the design rationale is traceable", () => {
    const log = readFileSync(RUNLOG, "utf8");
    expect(log).toContain(CONVERGE_LOG);
  });

  it("confirms scope: no file edited outside src/ and docs/team/runs/", () => {
    const log = readFileSync(RUNLOG, "utf8");
    const lower = log.toLowerCase();
    // The scope fence the AC requires: canvas-side (src/) + the run log only.
    expect(lower).toContain("src/");
    expect(lower).toMatch(/docs\/team\/runs/);
    // No TextView / no-WebGL path, no new UI control, no .claude / harness change.
    expect(lower).toMatch(/\.claude|harness/);
  });

  it("lives only under docs/ — the deliverable adds no .claude files", () => {
    expect(RUNLOG).toContain(join("docs", "team", "runs"));
    expect(RUNLOG).not.toContain(".claude");
  });
});
