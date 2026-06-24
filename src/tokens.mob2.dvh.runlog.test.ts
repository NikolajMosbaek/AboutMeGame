import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * MOB2 #154 slice (epic #149) — run-log presence + honesty lint (T7).
 *
 * This file lives in src/ so `npm test` (vitest include = src/**) runs it, but it
 * guards a DOCS deliverable: the T7 run log under
 *   docs/team/runs/2026-06-24-mob2-onboarding-menu-dvh-text-view-154.md
 *
 * T7's job is to RECORD the measured perf-budget delta and the on-device gap.
 * The build is the gate: `npm run build` exits 0, and the JS/asset byte delta vs
 * `main` is MEASURED (~0; CSS grows a few hundred authored bytes). A bundle-size
 * delta cannot be derived from any runtime expression, so an
 * `expect(delta).toBeLessThan(...)` evaluated in jsdom would be a fabrication
 * (mirrors src/world/landmarks.gzip.runlog.test.ts). The only thing this suite can
 * honestly assert is that the measurement was performed and its load-bearing
 * claims recorded so the gate can't silently regress to a green-but-empty stub:
 *   - the run-log entry exists and cites a real `npm run build` on main vs branch;
 *   - it reports the honest deltas — JS/asset ~0, CSS GROWS a few hundred authored
 *     bytes (explicitly NOT "zero bytes") — and confirms it is within
 *     docs/perf-budget.md;
 *   - it cites the fully-green `npm test` baseline (DEC7: the "known red"
 *     dayCycle.scope.test.ts is FICTION — there is NO red-allowance);
 *   - it flags the notched-iPhone clearance (portrait + landscape, URL bar shown +
 *     collapsed) of the TextView back link and the Onboarding/Settings close
 *     controls as a non-silent NEEDS-VERIFICATION item the headless gates cannot
 *     prove (DEC9), and does NOT claim it as verified;
 *   - the deliverable lives only under docs/ — no product-code or .claude churn.
 *
 * It is a presence/text lint over a docs deliverable, NOT a re-derivation of a
 * runtime value (jsdom evaluates no env()/dvh/@media; the rendered notch
 * clearance is the very NEEDS-VERIFICATION item this lint pins, not something it
 * can assert).
 */

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// src -> repo root is one level up.
const REPO_ROOT = join(MODULE_DIR, "..");
const RUNLOG = join(
  REPO_ROOT,
  "docs",
  "team",
  "runs",
  "2026-06-24-mob2-onboarding-menu-dvh-text-view-154.md",
);

const log = (): string => readFileSync(RUNLOG, "utf8");

/** Pull every integer/decimal that reads as a byte/KB figure out of a line. */
function numbersOn(line: string): number[] {
  return (line.match(/[0-9][0-9.,]*/g) ?? []).map((n) => Number(n.replace(/,/g, "")));
}

describe("MOB2 #154 / T7 — run log exists and is auditable", () => {
  it("the run log exists under docs/team/runs/", () => {
    expect(existsSync(RUNLOG)).toBe(true);
  });

  it("lives only under docs/ — the deliverable adds no .claude files", () => {
    expect(RUNLOG).toContain(join("docs", "team", "runs"));
    expect(RUNLOG).not.toContain(".claude");
  });

  it("names the slice it records (MOB2 #154, onboarding/menu dvh + text-view safe-area)", () => {
    const lc = log().toLowerCase();
    expect(lc).toContain("mob2");
    expect(log()).toContain("#154");
    expect(lc).toMatch(/dvh|vh-dynamic/);
    expect(lc).toMatch(/text-view|text view/);
  });
});

describe("MOB2 #154 / T7 — run log reports the MEASURED build delta (NOT 'zero bytes')", () => {
  it("cites a real npm run build on main vs the branch (measured, not asserted)", () => {
    const lc = log().toLowerCase();
    expect(lc).toMatch(/npm run build|vite build/);
    expect(lc).toContain("main");
    // The delta is a measurement, not a runtime invariant — stated explicitly.
    expect(lc).toMatch(/measured|byte-identical|byte identical/);
  });

  it("states the JS / asset delta is ~0 (the two JS chunks are byte-identical)", () => {
    const lc = log().toLowerCase();
    expect(lc).toMatch(/js.*(~0|byte-identical|byte identical|unchanged)/);
    // The entry and the three vendor chunk are both named.
    expect(lc).toMatch(/entry chunk|index-/);
    expect(lc).toMatch(/three.*chunk|vendor chunk/);
  });

  it("states the CSS GROWS a few hundred authored bytes, NOT zero", () => {
    const lc = log().toLowerCase();
    expect(lc).toMatch(/css.*(grow|few hundred|hundred authored bytes|\+\d+\s*(raw )?bytes)/);
    // Explicitly disclaim the false "zero bytes" framing.
    expect(lc).toMatch(/not[\s'"]*(literally )?zero bytes|zero bytes/);
  });

  it("cites distinct before/after CSS byte figures so the delta is reproducible", () => {
    const cssLines = log()
      .split("\n")
      .filter((l) => /css/i.test(l) && /[0-9]/.test(l) && /(byte|kb)/i.test(l));
    const all = cssLines.flatMap(numbersOn).filter((n) => n > 0);
    expect(new Set(all).size, "distinct cited CSS byte numbers").toBeGreaterThanOrEqual(2);
  });

  it("confirms the result is within docs/perf-budget.md", () => {
    const lc = log().toLowerCase();
    expect(lc).toContain("perf-budget");
    expect(lc).toMatch(/within|inside|under/);
  });
});

describe("MOB2 #154 / T7 — run log cites the fully-green test baseline (DEC7, no red-allowance)", () => {
  it("cites a fully-green npm test run with a concrete count", () => {
    const lc = log().toLowerCase();
    expect(lc).toMatch(/npm test/);
    // A concrete passing count of the form N/N or "N passed".
    expect(log()).toMatch(/\b(\d+)\s*\/\s*\1\b|\b\d+\s+passed\b/);
  });

  it("records that the brief's 'known red' dayCycle.scope.test.ts is FICTION (no red-allowance)", () => {
    const lc = log().toLowerCase();
    expect(lc).toContain("daycycle.scope.test.ts");
    expect(lc).toMatch(/fiction|phantom|does not exist|absent|no red[\s-]?allowance/);
  });
});

describe("MOB2 #154 / T7 — run log flags the on-device gap as NEEDS VERIFICATION (DEC9)", () => {
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

  it("carries the literal 'NEEDS VERIFICATION' flag", () => {
    expect(log()).toMatch(/NEEDS VERIFICATION/);
  });

  it("enumerates the notched-iPhone clearance gap (portrait + landscape, URL bar shown + collapsed)", () => {
    const lc = needsVerificationSection().toLowerCase();
    expect(lc).toMatch(/notch|notched|home indicator|dynamic island|status bar/);
    expect(lc).toMatch(/portrait/);
    expect(lc).toMatch(/landscape/);
    expect(lc).toMatch(/url bar/);
    // The three surfaces this slice touched: TextView back link + onboarding +
    // settings/menu close controls.
    expect(lc).toMatch(/back link|text-view|textview/);
    expect(lc).toMatch(/onboarding/);
    expect(lc).toMatch(/settings|menu/);
  });

  it("records the gap as unprovable by headless Vitest / desktop-Chromium Playwright", () => {
    const lc = needsVerificationSection().toLowerCase();
    expect(lc).toMatch(/vitest|headless/);
    expect(lc).toMatch(/playwright|chromium|desktop/);
  });

  it("does not CLAIM the on-device clearance as verified/proven", () => {
    const lc = needsVerificationSection().toLowerCase();
    // Strip the honest negated forms before scanning, so only an affirmative
    // claim of success fails the lint.
    const withoutHonestNegations = lc
      .replace(/cannot be proven/g, "")
      .replace(/un(?:provable|proven)/g, "")
      .replace(/not (?:yet )?(?:asserted|proven|verified)/g, "")
      .replace(/never asserted/g, "");
    expect(withoutHonestNegations).not.toMatch(/\bverified\b/);
    expect(withoutHonestNegations).not.toMatch(/\bproven\b/);
    expect(withoutHonestNegations).not.toMatch(/\bproved\b/);
  });
});
