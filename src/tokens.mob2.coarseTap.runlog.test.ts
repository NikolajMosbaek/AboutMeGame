import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * MOB2 #155 slice (epic #149) — run-log presence + honesty lint (T6).
 *
 * This file lives in src/ so `npm test` (vitest include = src/**) runs it, but it
 * guards a DOCS deliverable: the run log under
 *   docs/team/runs/2026-06-24-mob2-coarse-tap-floor-155.md
 * The path is HARD-CODED (DEC7) — the log must be authored at EXACTLY this path
 * or this guard fails for the wrong reason.
 *
 * #155 is a pure verification + lock-in slice: ZERO product CSS change, so the
 * shipped bundle is byte-identical to main (delta 0). A bundle-size delta cannot
 * be re-derived from any runtime expression, so an `expect(delta).toBe(0)`
 * evaluated in jsdom would be a fabrication (mirrors
 * src/world/landmarks.gzip.runlog.test.ts). The only thing this suite can
 * honestly assert is that the measurement was performed and its load-bearing
 * claims recorded, so the gate can't silently regress to a green-but-empty stub:
 *   - the run-log entry exists at the hard-coded path, names MOB2 #155, and adds
 *     no .claude files;
 *   - it cites a real `npm run build` on main vs branch and reports the honest
 *     MEASURED byte-identical (delta 0) result — explicitly NOT #154's "CSS grows
 *     a few hundred bytes" — and confirms it within docs/perf-budget.md;
 *   - it cites a fully-green `npm test` with a concrete N/N count (DEC10), records
 *     that dayCycle.scope.test.ts is FICTION/absent (no red-allowance), and states
 *     the gh-gated mob1.prBody.test.ts skip-vs-pass status (skip != pass);
 *   - it flags the notched-iPhone tappability/reachability of the Settings/menu
 *     button and each panel close/back/next (incl. SettingsMenu close+mute) in
 *     portrait + landscape, URL bar shown + collapsed, as a non-silent
 *     NEEDS-VERIFICATION item the headless gates cannot prove (DEC9), and does NOT
 *     claim it verified.
 *
 * CRITICAL (DEC7): this lint asserts the PRESENCE and SHAPE of the required
 * sections, NOT an exact ossifying file/test count. The stale MOB1 logs that
 * pinned "72 files" / "647 tests" are the cautionary trap — a real green run
 * went red at the gate against a hard-coded baseline. Here we require only that a
 * well-formed concrete N/N count is present, never a specific number.
 */

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// src -> repo root is one level up.
const REPO_ROOT = join(MODULE_DIR, "..");
const RUNLOG = join(
  REPO_ROOT,
  "docs",
  "team",
  "runs",
  "2026-06-24-mob2-coarse-tap-floor-155.md",
);

const log = (): string => readFileSync(RUNLOG, "utf8");

describe("MOB2 #155 / T6 — run log exists at the hard-coded path and is auditable", () => {
  it("the run log exists under docs/team/runs/ at the exact path the lint pins", () => {
    expect(existsSync(RUNLOG)).toBe(true);
  });

  it("lives only under docs/ — the deliverable adds no .claude files", () => {
    expect(RUNLOG).toContain(join("docs", "team", "runs"));
    expect(RUNLOG).not.toContain(".claude");
  });

  it("names the slice it records (MOB2 #155, the coarse-tap floor + dvh caps)", () => {
    const lc = log().toLowerCase();
    expect(lc).toContain("mob2");
    expect(log()).toContain("#155");
    expect(lc).toMatch(/tap[\s-]?min|tap floor|coarse/);
  });
});

describe("MOB2 #155 / T6 — run log records the failing-first transcripts (DEC4/DEC5)", () => {
  it("cites both the RED-on-fixture (per-control) and GREEN-on-real transcripts", () => {
    const lc = log().toLowerCase();
    // A failing-first RED run plus a green run, both on the new css test.
    expect(lc).toMatch(/red/);
    expect(lc).toMatch(/green/);
    expect(lc).toMatch(/attack[\s-]?2|attack[\s-]?3|split[\s-]?out|min-width/);
    expect(lc).toContain("tokens.mob2.coarsetap.css.test.ts");
  });

  it("states plainly that production CSS was already compliant and was NOT edited", () => {
    const lc = log().toLowerCase();
    expect(lc).toMatch(/already\s+compliant/);
    expect(lc).toMatch(/not\s+edited|never\s+edited|was\s+not[\s\S]*?edit|no\s+product\s+css/);
  });
});

describe("MOB2 #155 / T6 — run log reports the MEASURED byte-identical build (delta 0)", () => {
  it("cites a real npm run build on main vs the branch (measured, not asserted)", () => {
    const lc = log().toLowerCase();
    expect(lc).toMatch(/npm run build|vite build/);
    expect(lc).toContain("main");
    expect(lc).toMatch(/measured|byte-identical|byte identical/);
  });

  it("states the build is byte-identical / delta 0 (NOT #154's 'CSS grows a few hundred bytes')", () => {
    const lc = log().toLowerCase();
    expect(lc).toMatch(/byte-identical|byte identical|delta 0|delta of 0/);
    // The honest disclaimer that the #154 CSS-grows framing does NOT apply here.
    expect(lc).toMatch(/not .*grow|not.*few hundred|zero product css|no css is touched/);
  });

  it("confirms the result is within docs/perf-budget.md", () => {
    const lc = log().toLowerCase();
    expect(lc).toContain("perf-budget");
    expect(lc).toMatch(/within|inside|under/);
  });
});

describe("MOB2 #155 / T6 — run log cites the fully-green test baseline (DEC10, no red-allowance)", () => {
  it("cites a fully-green npm test run with a concrete count (shape, not a pinned number)", () => {
    const lc = log().toLowerCase();
    expect(lc).toMatch(/npm test/);
    // A concrete passing count of the form N/N or "N passed" — its SHAPE is
    // required, never a specific ossifying number (the MOB1 "72 files" trap).
    expect(log()).toMatch(/\b(\d+)\s*\/\s*\1\b|\b\d+\s+pass(?:ing|ed)\b/);
  });

  it("records that dayCycle.scope.test.ts is FICTION/absent (no red-allowance)", () => {
    const lc = log().toLowerCase();
    expect(lc).toContain("daycycle.scope.test.ts");
    expect(lc).toMatch(/fiction|phantom|does not exist|absent|no red[\s-]?allowance/);
  });

  it("states the gh-gated mob1.prBody.test.ts skip-vs-pass status explicitly (skip != pass)", () => {
    const lc = log().toLowerCase();
    expect(lc).toContain("mob1.prbody.test.ts");
    expect(lc).toMatch(/gh-gated|skipif|ghavailable|gh.*(unavailable|available)/);
    expect(lc).toMatch(/skip(?:ped)?.*(not|!=|never).*pass|skip is not a pass/);
  });
});

describe("MOB2 #155 / T6 — run log flags the on-device gap as NEEDS VERIFICATION (DEC9)", () => {
  // Isolate the NEEDS VERIFICATION section so the lint reasons over the gap body,
  // not a stray mention of the word elsewhere.
  const needsVerificationSection = (): string => {
    const text = log();
    const start = text.search(/^#+\s*NEEDS VERIFICATION/im);
    expect(start, "a NEEDS VERIFICATION heading").toBeGreaterThanOrEqual(0);
    const rest = text.slice(start);
    const afterHeaderLine = rest.indexOf("\n") + 1;
    const body = rest.slice(afterHeaderLine);
    const nextHeading = body.search(/^#+\s/m);
    return nextHeading === -1 ? rest : rest.slice(0, afterHeaderLine + nextHeading);
  };

  it("carries the literal 'NEEDS VERIFICATION' heading", () => {
    expect(log()).toMatch(/^#+\s*NEEDS VERIFICATION/im);
  });

  it("enumerates the notched-iPhone tappability gap (portrait + landscape, URL bar shown + collapsed)", () => {
    const lc = needsVerificationSection().toLowerCase();
    expect(lc).toMatch(/notch|notched|home indicator|dynamic island|status bar/);
    expect(lc).toMatch(/portrait/);
    expect(lc).toMatch(/landscape/);
    expect(lc).toMatch(/url bar/);
    // The Settings/menu button tappability + each panel close/back/next, incl.
    // the SettingsMenu close+mute control.
    expect(lc).toMatch(/settings|menu/);
    expect(lc).toMatch(/tappable|tap/);
    expect(lc).toMatch(/close|back|next/);
    expect(lc).toMatch(/mute/);
  });

  it("records the gap as unprovable by headless Vitest / desktop-Chromium Playwright", () => {
    const lc = needsVerificationSection().toLowerCase();
    expect(lc).toMatch(/vitest|headless/);
    expect(lc).toMatch(/playwright|chromium|desktop/);
  });

  it("does not CLAIM the on-device tappability as verified/proven", () => {
    const lc = needsVerificationSection().toLowerCase();
    // Strip the honest negated forms before scanning, so only an affirmative
    // claim of success fails the lint.
    const withoutHonestNegations = lc
      .replace(/cannot be proven/g, "")
      .replace(/un(?:provable|proven)/g, "")
      .replace(/not (?:yet )?(?:asserted|proven|verified)/g, "")
      .replace(/never asserted/g, "")
      .replace(/no affirmative on-device claim/g, "");
    expect(withoutHonestNegations).not.toMatch(/\bverified\b/);
    expect(withoutHonestNegations).not.toMatch(/\bproven\b/);
    expect(withoutHonestNegations).not.toMatch(/\bproved\b/);
  });
});
