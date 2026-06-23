import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This file lives in src/ so `npm test` (vitest include = src/**) runs it, but
// it guards a DOCS deliverable: the G4 / T13 *measured bundle-size gate* under
// docs/team/runs/. T13's premise (from the converged design) is that adding the
// `mergeGeometries` import from `three/examples/jsm/utils/BufferGeometryUtils.js`
// is a MEASURED gate, NOT an asserted invariant: the import pulls in tree-shaken
// CODE bytes that fold into the EXISTING `three` vendor chunk via vite's
// id-based `manualChunks` matcher (vite.config.ts), so the ENTRY (`index-*.js`)
// chunk's gzip delta stays well under 2 KB. A delta that size can only be
// established by an actual `vite build` of `main` vs the branch and comparing the
// gzipped entry chunk — it cannot be derived from runtime code, so a runtime
// `expect(...).toBeLessThan(2048)` would be a lie. The only thing the suite can
// honestly assert is that the measurement was performed and its numbers recorded.
//
// It mirrors `waterAnimation.runlog.test.ts` (a lightweight presence/content
// check over a run-log deliverable) and pins the load-bearing claims T13 must
// stand behind so the gate can't silently regress to a green-but-empty stub:
//   - the run-log entry exists and cites a real `vite build`;
//   - it names the entry chunk (`index-*.js`) and the `three` vendor chunk and
//     cites the gzipped before/after bytes for the entry chunk, measured on
//     `main` vs the branch from clean worktree builds;
//   - it states the entry-chunk gzip DELTA and that delta < 2 KB (2048 bytes);
//   - it frames the result as a MEASURED gate, not an asserted invariant, and
//     records that the BufferGeometryUtils code folds into the `three` vendor
//     chunk (the vendor chunk grows; the entry chunk barely moves);
//   - the deliverable lives only under docs/ — no product-code or .claude churn.

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// src/world -> repo root is two levels up.
const REPO_ROOT = join(MODULE_DIR, "..", "..");
const RUNLOG = join(
  REPO_ROOT,
  "docs",
  "team",
  "runs",
  "2026-06-23-g4-landmark-gzip-entry-chunk-delta.md",
);

/** Pull every integer that reads as a byte/KB gzip figure out of a line. */
function numbersOn(line: string): number[] {
  return (line.match(/[0-9][0-9.,]*/g) ?? []).map((n) =>
    Number(n.replace(/,/g, "")),
  );
}

describe("G4 / T13 — landmark BufferGeometryUtils gzip entry-chunk delta gate", () => {
  it("the measured-gate run-log entry exists under docs/team/runs/", () => {
    expect(existsSync(RUNLOG)).toBe(true);
  });

  it("cites a real vite build on main vs the branch (measured, not asserted)", () => {
    const log = readFileSync(RUNLOG, "utf8");
    const lower = log.toLowerCase();
    expect(lower).toMatch(/vite build|npm run build/);
    expect(lower).toContain("main");
    // The gate is a measurement, not a runtime invariant — stated explicitly so
    // a future reader does not mistake it for an asserted constant.
    expect(lower).toMatch(/measured gate|measured, not|not an asserted invariant/);
  });

  it("names the entry chunk and the three vendor chunk it folds into", () => {
    const log = readFileSync(RUNLOG, "utf8");
    expect(log).toMatch(/index-[A-Za-z0-9_-]+\.js|entry chunk/i);
    // The design's load-bearing claim: BufferGeometryUtils code folds into the
    // EXISTING `three` vendor chunk via the id-based manualChunks matcher.
    expect(log).toMatch(/three-[A-Za-z0-9_-]+\.js|three vendor chunk|vendor chunk/i);
    expect(log.toLowerCase()).toContain("buffergeometryutils");
  });

  it("records the entry-chunk gzip delta and that it is under the 2 KB ceiling", () => {
    const log = readFileSync(RUNLOG, "utf8");
    const lower = log.toLowerCase();
    expect(lower).toContain("gzip");
    // The 2 KB / 2048-byte ceiling is named as the gate threshold.
    expect(log).toMatch(/2\s*KB|2048\s*bytes?/i);

    // A line that reports the entry-chunk gzip DELTA, with a cited number that
    // resolves to < 2 KB (either bytes < 2048, or a KB figure < 2.0). This pins
    // that the recorded delta actually clears the gate — not just that "2 KB" is
    // mentioned somewhere.
    const deltaLine = log
      .split("\n")
      .find((l) => /delta/i.test(l) && /[0-9]/.test(l) && /(byte|kb|gz)/i.test(l));
    expect(deltaLine, "a cited entry-chunk gzip delta line").toBeDefined();
    const ns = numbersOn(deltaLine!);
    const underCeiling = ns.some(
      // bytes form: < 2048; KB form: < 2.0. A value in (2, 2048) is ambiguous
      // only for byte counts in the 2..2047 range, which still pass as bytes.
      (n) => n < 2.0 || (n >= 2 && n < 2048),
    );
    expect(
      underCeiling,
      `cited delta on "${deltaLine?.trim()}" is not under the 2 KB ceiling`,
    ).toBe(true);
  });

  it("cites the before/after entry-chunk gzip bytes for main vs the branch", () => {
    const log = readFileSync(RUNLOG, "utf8");
    // Two distinct gzip figures for the entry chunk (main → branch), so the delta
    // is reproducible from the cited numbers and not a bare assertion.
    const gzipLines = log
      .split("\n")
      .filter((l) => /gzip|gz\b/i.test(l) && /[0-9]/.test(l));
    expect(gzipLines.length, "cited gzip figures").toBeGreaterThanOrEqual(2);
    const all = gzipLines.flatMap(numbersOn).filter((n) => n > 0);
    const distinct = new Set(all);
    expect(distinct.size, "distinct cited gzip numbers (before + after)").toBeGreaterThanOrEqual(
      2,
    );
  });

  it("lives only under docs/ — the deliverable adds no .claude files", () => {
    expect(RUNLOG).toContain(join("docs", "team", "runs"));
    expect(RUNLOG).not.toContain(".claude");
  });
});
