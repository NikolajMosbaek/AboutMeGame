import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/*
 * MOB2 #154 (epic #149) — DEC8 scope / MOB1-regression guard (T6).
 *
 * This slice is a deliberately TINY CSS-only pass: it must close exactly the two
 * reachability gaps MOB1 left and touch NOTHING else in src/tokens.css. The
 * companion file tokens.mob2.dvh.css.test.ts proves the two fixes landed; this
 * file proves the BLAST RADIUS — that `git diff main -- src/tokens.css` adds and
 * removes ONLY the three sanctioned change categories:
 *   (A) the .text-view padding split + the new safe-area padding-bottom longhand
 *       (and its explanatory comment),
 *   (B) the two .onboarding,.menu max-height caps converting raw vh -> the
 *       calc(var(--vh-dynamic) * N) dvh form,
 *   (C) the two stale in-media comment blocks updated so the source no longer
 *       claims .onboarding/.menu "stay on vh".
 *
 * and that the MOB1-shipped surfaces this slice promised to leave byte-unchanged
 * (DEC8) do NOT appear as changed lines at all:
 *   - .reveal-panel base max-height (calc(var(--vh-dynamic) * 0.86), :418),
 *   - .completion-panel base max-height (:545),
 *   - the two split-out .reveal-panel media caps (* 0.92 / * 0.96, :1056/:1130),
 *   - both backdrops' padding-bottom + --safe-bottom (:411 / :539),
 *   - the width-only .onboarding (:748) / .menu (:805) base rules (NO invented
 *     max-height), and
 *   - the @media (pointer: coarse) --tap-min block (:1161-…), which keeps the
 *     44px floor on .text-view__back and the .menu__* controls.
 *
 * It reads the diff from git (the source of truth for the blast radius), so it
 * needs a git work-tree with `main` reachable. In an environment where that is
 * unavailable (a shallow checkout missing `main`, no git) the guard SKIPS rather
 * than failing CI on an environment gap — same posture as mob1.prBody.test.ts.
 */

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(MODULE_DIR, "..");

/** True iff we can run `git diff main -- src/tokens.css` in this checkout. */
function diffAvailable(): boolean {
  try {
    // `git rev-parse --verify` is silent and cheap; it confirms `main` resolves.
    execFileSync("git", ["rev-parse", "--verify", "main"], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/** The unified diff of src/tokens.css against `main`, or "" if unobtainable. */
function tokensDiff(): string {
  return execFileSync("git", ["diff", "main", "--", "src/tokens.css"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

/**
 * The added/removed CONTENT lines of the diff — every line that starts with a
 * lone `+`/`-`, excluding the `+++`/`---` file headers. The leading +/- marker
 * is stripped so a matcher reasons over the CSS text itself.
 */
function changedLines(diff: string): string[] {
  return diff
    .split("\n")
    .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
    .map((l) => l.slice(1));
}

// --- The three sanctioned change categories (DEC1-DEC5). A changed line is
// in-scope iff it matches exactly one of these. ---------------------------------

// (A) .text-view padding: the shorthand losing its bottom term, the new
//     safe-area longhand, and the comment that documents it.
const TEXT_VIEW_PADDING = [
  /^\s*padding:\s*var\(--space-4\)\s*var\(--space-3\)(\s*var\(--space-4\))?;\s*$/,
  /^\s*padding-bottom:\s*max\(var\(--space-4\),\s*calc\(var\(--space-4\)\s*\+\s*var\(--safe-bottom\)\)\);\s*$/,
  /home indicator/i,
  /centred-dialog max-height/i,
  /Floor the bottom pad/i,
  /ADD the safe-area inset on a notch/i,
  /end-of-document dismiss control/i,
  /text-view__footer back link/i,
];

// (B) the two .onboarding,.menu caps: raw vh out, dvh calc in.
const ONBOARDING_MENU_CAP = [
  /^\s*max-height:\s*9[26]vh;\s*$/,
  /^\s*max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.9[26]\);\s*$/,
];

// (C) the two stale in-media comment blocks (DEC4). These mention the overlays,
//     the dvh token, the iPhone the P0 targets, and the source-order rationale.
const STALE_COMMENT = [
  /off a tiny screen/i,
  /reveal-panel/i,
  /max-height caps are split out/i,
  /reads the dvh token|share the dvh token|sizes from var\(--vh-dynamic\)/i,
  /static \d*vh|static vh|100vh->100dvh/i,
  /source order|WIN here|win by source/i,
  /onboarding\/\.menu/i,
  /short landscape iPhone|small iPhone the P0 targets|collapsing URL bar/i,
  /out of scope and stay on vh|out of scope\) keep vh/i,
];

const ALLOWED = [...TEXT_VIEW_PADDING, ...ONBOARDING_MENU_CAP, ...STALE_COMMENT];

// --- Forbidden markers (DEC8): if ANY of these appears on a changed line, a
// MOB1 / tap-min / base surface was touched. ------------------------------------
const FORBIDDEN_ON_CHANGED: { label: string; re: RegExp }[] = [
  {
    label: ".reveal-panel / .completion-panel base max-height (calc * 0.86)",
    re: /max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.86\)/,
  },
  {
    label: "a backdrop padding-bottom + --safe-bottom",
    re: /padding-bottom:\s*calc\(var\(--space-2\)\s*\+\s*var\(--safe-bottom\)\)/,
  },
  { label: "the --tap-min floor token", re: /--tap-min/ },
  { label: "a @media (pointer: coarse) prelude", re: /@media\s*\(pointer:\s*coarse\)/ },
  { label: "the .text-view__back coarse-pointer entry", re: /\.text-view__back/ },
  // The width-only base rules: their identifying declarations must never move.
  { label: ".onboarding base max-width", re: /max-width:\s*min\(30rem,\s*92vw\)/ },
  { label: ".menu base width", re: /width:\s*min\(26rem,\s*92vw\)/ },
];

const run = diffAvailable() ? describe : describe.skip;

run("tokens.css — MOB2 #154 DEC8 scope guard (diff blast radius)", () => {
  it("the diff against main is non-empty (the slice has actually landed in tokens.css)", () => {
    const lines = changedLines(tokensDiff());
    // A green-empty diff would make the in-scope/forbidden checks vacuously pass;
    // assert the slice is present so this guard cannot rubber-stamp a no-op.
    expect(lines.length, "expected src/tokens.css to differ from main").toBeGreaterThan(0);
  });

  it("EVERY added/removed line falls into one of the three sanctioned categories (no scope drift)", () => {
    const lines = changedLines(tokensDiff());
    const unclassified = lines.filter((line) => {
      if (line.trim() === "") return false; // blank context inside a hunk
      return !ALLOWED.some((re) => re.test(line));
    });
    expect(
      unclassified,
      "these changed lines are outside the sanctioned .text-view / .onboarding,.menu-cap / stale-comment scope:\n" +
        unclassified.map((l) => `  >${l}<`).join("\n"),
    ).toEqual([]);
  });

  it("touches BOTH .onboarding,.menu caps (each 92vh and 96vh removed, each dvh calc added)", () => {
    const lines = changedLines(tokensDiff());
    const has = (re: RegExp) => lines.some((l) => re.test(l));
    // Removed: the two raw-vh caps.
    expect(has(/^\s*max-height:\s*92vh;\s*$/)).toBe(true);
    expect(has(/^\s*max-height:\s*96vh;\s*$/)).toBe(true);
    // Added: the two dvh calc caps.
    expect(has(/^\s*max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.92\);\s*$/)).toBe(true);
    expect(has(/^\s*max-height:\s*calc\(var\(--vh-dynamic\)\s*\*\s*0\.96\);\s*$/)).toBe(true);
  });

  it("adds the .text-view safe-area padding-bottom longhand", () => {
    const lines = changedLines(tokensDiff());
    expect(
      lines.some((l) =>
        /^\s*padding-bottom:\s*max\(var\(--space-4\),\s*calc\(var\(--space-4\)\s*\+\s*var\(--safe-bottom\)\)\);\s*$/.test(
          l,
        ),
      ),
    ).toBe(true);
  });

  it("NO MOB1 / tap-min / width-only-base surface appears as a changed line (DEC8 byte-unchanged)", () => {
    const lines = changedLines(tokensDiff());
    for (const { label, re } of FORBIDDEN_ON_CHANGED) {
      const hits = lines.filter((l) => re.test(l));
      expect(
        hits,
        `DEC8 violation — ${label} was added/removed by this diff:\n` +
          hits.map((l) => `  >${l}<`).join("\n"),
      ).toEqual([]);
    }
  });

  it("does NOT re-introduce raw vh in any added line (the conversion is one-directional)", () => {
    const diff = tokensDiff();
    const added = diff
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
      .map((l) => l.slice(1));
    // The only raw-vh string the diff may touch is on REMOVED lines (the old
    // 92vh/96vh caps); no ADDED CSS declaration may carry a raw NNvh max-height.
    const addedRawVhCaps = added.filter((l) => /^\s*max-height:\s*\d+vh;\s*$/.test(l));
    expect(addedRawVhCaps).toEqual([]);
  });
});
