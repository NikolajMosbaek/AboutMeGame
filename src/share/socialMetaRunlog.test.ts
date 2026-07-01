import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CANONICAL_ORIGIN, SOCIAL_PREVIEW_FILENAME } from "./socialMeta.ts";

/*
 * F1 slice 1 (#129) — T8: run-log presence + honesty lint.
 *
 * This file lives in src/ so `npm test` (vitest include = src/**) runs it, but it
 * guards a DOCS deliverable: the converged-design run log
 *   docs/team/runs/2026-07-01-f1-social-preview-meta-129.md
 * Guardrail 4 (Auditable) requires that run log to record the load-bearing,
 * hard-to-verify facts of this slice so the audit trail cannot silently regress to
 * a green-but-empty stub. It mirrors the tokens *.runlog.test.ts precedent: a
 * pure-string presence/content lint over a committed run-log markdown, NOT a
 * re-derivation of a runtime value.
 *
 * The load-bearing claims T8 must stand behind:
 *   - the measured `du -sh dist` delta against the REAL 752K baseline (issue's
 *     736K is stale), the delta being only the new image's tens of KB, and the
 *     total staying well under the 6 MB cap in docs/perf-budget.md;
 *   - the one-line SVG-to-PNG regenerate command;
 *   - the AC1 tension: %BASE_URL% sources ONLY the path segment while the emitted
 *     og/twitter/url hrefs are intentionally ABSOLUTE, because unfurl crawlers do
 *     not resolve relative/path-only hrefs;
 *   - the canonical-origin literal named as a SECOND deployment knob alongside
 *     VITE_BASE (a custom domain would change both);
 *   - the third-party unfurl render (Facebook/X/LinkedIn/Slack debuggers) flagged
 *     NEEDS-VERIFICATION, since CI cannot exercise third-party crawlers.
 */

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// src/share -> repo root is two levels up.
const REPO_ROOT = join(MODULE_DIR, "..", "..");
const RUNLOG = join(
  REPO_ROOT,
  "docs",
  "team",
  "runs",
  "2026-07-01-f1-social-preview-meta-129.md",
);

const log = (): string => readFileSync(RUNLOG, "utf8");

/** Pull every integer that reads as a byte/KB figure out of a line. */
function numbersOn(line: string): number[] {
  return (line.match(/[0-9][0-9.,]*/g) ?? []).map((n) =>
    Number(n.replace(/,/g, "")),
  );
}

describe("F1 #129 — social-preview run log exists and names the slice", () => {
  it("the run log exists under docs/team/runs/", () => {
    expect(existsSync(RUNLOG)).toBe(true);
  });

  it("names the slice it records (F1 #129, social preview / share card)", () => {
    const lc = log().toLowerCase();
    expect(log()).toContain("#129");
    expect(lc).toMatch(/social[- ]preview|share card|social-preview\.png/);
  });

  it("lives only under docs/ — the deliverable adds no .claude files", () => {
    expect(RUNLOG).toContain(join("docs", "team", "runs"));
    expect(RUNLOG).not.toContain(".claude");
  });
});

describe("F1 #129 — run log records the measured du -sh dist delta vs the REAL 752K baseline", () => {
  it("cites a measured `du -sh dist` (not an asserted constant)", () => {
    const lc = log().toLowerCase();
    expect(lc).toContain("du -sh dist");
  });

  it("names the REAL 752K baseline and flags the issue's 736K as stale", () => {
    const text = log();
    const lc = text.toLowerCase();
    expect(text).toMatch(/752\s*K/i);
    // The stale figure must be named AND disclaimed as stale, not silently used.
    expect(text).toMatch(/736\s*K/i);
    expect(lc).toMatch(/stale/);
  });

  it("states the delta is only the new image's tens of KB", () => {
    const lc = log().toLowerCase();
    expect(lc).toMatch(/delta/);
    // The image weighs a few tens of KB — the actual ~33 KB figure is cited.
    const tensOfKb = log()
      .split("\n")
      .some((l) => /delta|image|social-preview\.png/i.test(l) && numbersOn(l).some((n) => n >= 10 && n < 100));
    expect(tensOfKb, "a cited tens-of-KB image/delta figure").toBe(true);
  });

  it("states the total stays well under the 6 MB cap in docs/perf-budget.md", () => {
    const text = log();
    const lc = text.toLowerCase();
    expect(text).toMatch(/6\s*MB/i);
    expect(lc).toContain("perf-budget");
  });
});

describe("F1 #129 — run log records the one-line SVG-to-PNG regenerate command", () => {
  it("names the offline regenerate command", () => {
    const text = log();
    expect(text).toContain("node scripts/render-social-preview.mjs");
  });

  it("frames it as an offline authoring-time step on the already-present playwright dep (no new/runtime dep)", () => {
    const lc = log().toLowerCase();
    expect(lc).toContain("playwright");
    expect(lc).toMatch(/offline|authoring[- ]time/);
    expect(lc).toMatch(/no (new|runtime) (dep|dependency)/);
  });
});

describe("F1 #129 — run log records the AC1 %BASE_URL% / absolute-href rationale", () => {
  it("states %BASE_URL% sources only the path segment", () => {
    const text = log();
    const lc = text.toLowerCase();
    expect(text).toContain("%BASE_URL%");
    expect(lc).toMatch(/path segment/);
  });

  it("states the emitted og/twitter/url hrefs are intentionally ABSOLUTE because crawlers do not resolve relative/path-only hrefs", () => {
    const lc = log().toLowerCase();
    expect(lc).toMatch(/absolute/);
    expect(lc).toMatch(/crawler|unfurl/);
    // The "why": crawlers do not resolve relative / path-only hrefs.
    expect(lc).toMatch(/do not resolve|don't resolve|cannot resolve/);
    expect(lc).toMatch(/relative|path-only/);
  });
});

describe("F1 #129 — run log names VITE_BASE + the canonical origin as the two deployment knobs", () => {
  it("names VITE_BASE as a deployment knob", () => {
    expect(log()).toContain("VITE_BASE");
  });

  it("names the canonical-origin literal as the SECOND knob (custom domain would change both)", () => {
    const text = log();
    const lc = text.toLowerCase();
    // The exact origin literal, single-sourced in socialMeta.ts, appears verbatim.
    expect(text).toContain(CANONICAL_ORIGIN);
    expect(lc).toMatch(/second (deployment )?knob|two (deployment )?knobs|alongside/);
    expect(lc).toMatch(/custom domain/);
  });

  it("references the single-sourced asset filename constant", () => {
    expect(log()).toContain(SOCIAL_PREVIEW_FILENAME);
  });
});

describe("F1 #129 — run log flags the third-party unfurl render as NEEDS VERIFICATION", () => {
  // Isolate the NEEDS VERIFICATION section so the lint reasons over the gap body,
  // not a stray mention of the word elsewhere.
  const needsVerificationSection = (): string => {
    const text = log();
    const start = text.search(/^#+\s*NEEDS VERIFICATION/im);
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = text.slice(start);
    const afterHeaderLine = rest.indexOf("\n") + 1;
    const body = rest.slice(afterHeaderLine);
    const nextHeading = body.search(/^#+\s/m);
    return nextHeading === -1 ? rest : rest.slice(0, afterHeaderLine + nextHeading);
  };

  it("carries the literal 'NEEDS VERIFICATION' flag", () => {
    expect(log()).toMatch(/NEEDS VERIFICATION/);
  });

  it("names the third-party sharing debuggers CI cannot exercise", () => {
    const lc = needsVerificationSection().toLowerCase();
    expect(lc).toMatch(/facebook/);
    expect(lc).toMatch(/twitter|x\b|x\/|\bx sharing|x debugger/);
    expect(lc).toMatch(/linkedin/);
    expect(lc).toMatch(/slack/);
    expect(lc).toMatch(/debugger|crawler|unfurl/);
  });

  it("states CI cannot exercise third-party crawlers", () => {
    const lc = needsVerificationSection().toLowerCase();
    expect(lc).toMatch(/ci cannot|cannot exercise|headless/);
  });

  it("does not CLAIM the third-party unfurl as verified/proven", () => {
    const lc = needsVerificationSection().toLowerCase();
    // Strip honest negated forms before scanning, so only an affirmative claim of
    // success fails the lint.
    const withoutHonestNegations = lc
      .replace(/cannot be proven/g, "")
      .replace(/not (?:yet )?(?:asserted|proven|verified)/g, "")
      .replace(/\bunproven\b/g, "")
      .replace(/never (?:asserted|verified|proven)/g, "");
    expect(withoutHonestNegations).not.toMatch(/\bverified\b/);
    expect(withoutHonestNegations).not.toMatch(/\bproven\b/);
    expect(withoutHonestNegations).not.toMatch(/\bproved\b/);
  });
});
