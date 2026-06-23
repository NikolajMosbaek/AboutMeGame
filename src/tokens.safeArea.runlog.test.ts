import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * MOB1 #148 — scope-honesty lint over the EARLIER run-log draft (T1).
 *
 * This file lives in src/ so `npm test` (vitest include = src/**) runs it, but it
 * guards a DOCS deliverable: the run log
 *   docs/team/runs/2026-06-24-safe-area-touch-anchoring-mob1.md
 * which recorded MOB1 under a STALE, narrower framing — "CSS/DOM-only,
 * input.ts untouched, #151 out of scope". Per converge decision D4 that framing
 * is FALSE against the shipped diff: branch fix/mob1-safe-area-eager-touch ships
 * BOTH slice #148 (safe-area + dvh CSS tokens, a2b629f) AND slice #151 (eager-mount
 * touch controls via the injectable createInput seam, 17e66c1: +60/-10 in
 * src/movement/input.ts, +49 in input.test.ts). Guardrail 4 (Auditable) and the
 * charter's "never a silent pass" policy require the run log to name the true
 * bundled scope, not a claim the diff contradicts.
 *
 * So this lint pins the corrected log to:
 *   - exist;
 *   - name BOTH bundled slices ("slice #148" AND "slice #151");
 *   - name the touched implementation file ("input.ts");
 *   - state #152 (first-tap / touchActive) remains out of scope;
 *   - NOT carry the two false-claim substrings ("CSS/DOM-only",
 *     "input.ts untouched").
 * It is a presence/absence text lint over a docs deliverable, not a re-derivation
 * of a runtime value (jsdom cannot evaluate env()/dvh; on-device clearance is a
 * separate NEEDS-VERIFICATION item in the run log).
 */

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// src -> repo root is one level up.
const REPO_ROOT = join(MODULE_DIR, "..");
const RUNLOG = join(
  REPO_ROOT,
  "docs",
  "team",
  "runs",
  "2026-06-24-safe-area-touch-anchoring-mob1.md",
);

describe("MOB1 #148 — earlier run-log draft states the truthful bundled scope", () => {
  it("the run log exists under docs/team/runs/", () => {
    expect(existsSync(RUNLOG)).toBe(true);
  });

  it("names BOTH bundled slices — #148 (safe-area/dvh) AND #151 (eager-mount)", () => {
    const log = readFileSync(RUNLOG, "utf8");
    expect(log).toContain("slice #148");
    expect(log).toContain("slice #151");
  });

  it("names the touched implementation file (input.ts) the diff actually changed", () => {
    const log = readFileSync(RUNLOG, "utf8");
    expect(log).toContain("input.ts");
  });

  it("keeps #152 first-tap/touchActive explicitly out of scope", () => {
    const log = readFileSync(RUNLOG, "utf8");
    expect(log).toContain("#152");
  });

  it("does NOT carry the false 'CSS/DOM-only' scope claim the diff contradicts", () => {
    const log = readFileSync(RUNLOG, "utf8");
    expect(log).not.toContain("CSS/DOM-only");
  });

  it("does NOT carry the false 'input.ts untouched' claim", () => {
    const log = readFileSync(RUNLOG, "utf8");
    expect(log).not.toContain("input.ts untouched");
  });
});

/*
 * MOB1 #148 — baseline-honesty lint over the run log (T2).
 *
 * Per converge decision AC3/AC4 the run log MUST quote the true current green
 * baseline of `npm test`, not the stale "69 files / 613 tests" figure that
 * predates the committed tokens.css / quality / run-log / eager-mount tests.
 * The corrected baseline this run is 72 files / 642 tests (the +3 files / +29
 * tests over the original brief's "69 files / 613 tests" are tokens.css.test.ts,
 * tokens.safeArea.quality.test.ts, tokens.safeArea.runlog.test.ts, and the
 * eager-mount input.test.ts additions). This lint pins the log to that corrected
 * figure and forbids the stale strings re-appearing.
 */
describe("MOB1 #148 — run log quotes the true current green test baseline", () => {
  it("states the corrected baseline file count (72 files)", () => {
    const log = readFileSync(RUNLOG, "utf8");
    expect(log).toContain("72 files");
  });

  it("states the corrected baseline test count (642 tests)", () => {
    const log = readFileSync(RUNLOG, "utf8");
    expect(log).toContain("642 tests");
  });

  it("no longer carries the stale '69 files' baseline figure", () => {
    const log = readFileSync(RUNLOG, "utf8");
    expect(log).not.toContain("69 files");
  });

  it("no longer carries the stale '613 tests' baseline figure", () => {
    const log = readFileSync(RUNLOG, "utf8");
    expect(log).not.toContain("613 tests");
  });
});
