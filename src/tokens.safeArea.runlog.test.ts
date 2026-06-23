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
 * The corrected baseline this run is 72 files / 647 tests (the +3 files / +34
 * tests over the original brief's "69 files / 613 tests" are tokens.css.test.ts,
 * tokens.safeArea.quality.test.ts, tokens.safeArea.runlog.test.ts, and the
 * eager-mount input.test.ts additions — the latest +5 are the T4
 * NEEDS-VERIFICATION checklist-completeness assertions below). This lint pins the
 * log to that corrected figure and forbids the stale strings re-appearing.
 */
describe("MOB1 #148 — run log quotes the true current green test baseline", () => {
  it("states the corrected baseline file count (72 files)", () => {
    const log = readFileSync(RUNLOG, "utf8");
    expect(log).toContain("72 files");
  });

  it("states the corrected baseline test count (647 tests)", () => {
    const log = readFileSync(RUNLOG, "utf8");
    expect(log).toContain("647 tests");
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

/*
 * MOB1 — NEEDS-VERIFICATION on-device checklist completeness + honesty lint (T4).
 *
 * Per converge decisions D5 / AC5 / AC6 the run log MUST consolidate the three
 * on-device checks the headless suite cannot prove, and MUST flag each as
 * NEEDS VERIFICATION rather than assert it as proven (charter: "never a silent
 * pass" — Vitest + desktop-Chromium cannot reproduce the OS gesture inset or
 * evaluate env()/dvh on a real phone). The three categories that must each be
 * enumerated:
 *   (a) home-indicator / USE-tap clearance — iOS Safari portrait + landscape,
 *       URL bar shown AND collapsed, and Android Chrome; a deliberate tap reaches
 *       the relocated USE button;
 *   (b) .reveal-prompt readable and not visually overlapped by the relocated
 *       buttons in portrait and landscape;
 *   (c) audio — silent-switch-on moved-USE tap still drives the reveal, and a
 *       post-background return tap still resumes a suspended context
 *       (installAudioResume is window-bound, so re-anchoring cannot break unlock).
 *
 * This is a text lint over the docs deliverable: it pins the section to enumerate
 * all three categories and forbids any of them being phrased as already
 * "verified" / "proven" (the literal section title "NEEDS VERIFICATION" is the
 * flag, not a claim, so the lint targets assertion-phrasing, not the bare word).
 */
describe("MOB1 — run log consolidates the three on-device NEEDS-VERIFICATION checks", () => {
  // Isolate the NEEDS VERIFICATION section so the lint reasons over the checklist
  // body, not the title line that legitimately contains the word "VERIFICATION".
  const needsVerificationSection = (): string => {
    const log = readFileSync(RUNLOG, "utf8");
    const start = log.search(/^#+\s*NEEDS VERIFICATION/im);
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = log.slice(start);
    // Skip past the header line itself before scanning for the next heading, so
    // the search doesn't immediately re-match the same "## NEEDS VERIFICATION".
    const afterHeaderLine = rest.indexOf("\n") + 1;
    const body = rest.slice(afterHeaderLine);
    // The section runs to the next markdown heading (or EOF).
    const nextHeading = body.search(/^#+\s/m);
    return nextHeading === -1 ? rest : rest.slice(0, afterHeaderLine + nextHeading);
  };

  it("has a dedicated NEEDS VERIFICATION section", () => {
    const log = readFileSync(RUNLOG, "utf8");
    expect(log).toMatch(/NEEDS VERIFICATION/);
  });

  it("(a) enumerates the home-indicator / USE-tap clearance check across iOS + Android, both orientations and URL-bar states", () => {
    const section = needsVerificationSection();
    const lc = section.toLowerCase();
    expect(lc).toMatch(/home-indicator|home indicator|gesture inset/);
    expect(lc).toContain("ios");
    expect(lc).toMatch(/android/);
    expect(lc).toMatch(/use button|use tap|use → reveal|tap reaches/);
    expect(lc).toMatch(/portrait/);
    expect(lc).toMatch(/landscape/);
    expect(lc).toMatch(/url bar/);
  });

  it("(b) enumerates the .reveal-prompt overlap check in portrait and landscape", () => {
    const section = needsVerificationSection();
    const lc = section.toLowerCase();
    expect(lc).toContain(".reveal-prompt");
    expect(lc).toMatch(/overlap/);
    expect(lc).toMatch(/portrait/);
    expect(lc).toMatch(/landscape/);
  });

  it("(c) enumerates the audio-unlock checks (silent-switch reveal + post-background resume)", () => {
    const section = needsVerificationSection();
    const lc = section.toLowerCase();
    expect(lc).toMatch(/audio/);
    expect(lc).toMatch(/silent switch|silent-switch/);
    expect(lc).toMatch(/background/);
    expect(lc).toMatch(/resume/);
    // The window-bound rationale must be recorded so the audio items read as
    // confirmation checks, not as a regression introduced by this slice.
    expect(lc).toContain("installaudioresume");
    expect(lc).toMatch(/window/);
  });

  it("flags the checklist as NOT YET PROVEN — no item CLAIMS to be 'verified' or 'proven'", () => {
    const section = needsVerificationSection();
    const lc = section.toLowerCase();
    // Guard against assertion-phrasing that would claim on-device success the
    // headless gates cannot deliver. The honest NEGATED forms ("cannot be
    // proven", "not asserted", "unproven") are exactly the framing we want, so
    // strip them before scanning — only an AFFIRMATIVE claim of having
    // verified/proven should fail this lint.
    const withoutHonestNegations = lc
      .replace(/cannot be proven/g, "")
      .replace(/not (?:yet )?(?:asserted|proven|verified)/g, "")
      .replace(/\bunproven\b/g, "")
      .replace(/never asserted/g, "");
    expect(withoutHonestNegations).not.toMatch(/\bverified\b/);
    expect(withoutHonestNegations).not.toMatch(/\bproven\b/);
    expect(withoutHonestNegations).not.toMatch(/\bproved\b/);
    // It must positively say these are flagged, not asserted.
    expect(lc).toMatch(/flagged, not asserted|not asserted|cannot be proven/);
  });
});
