import { describe, expect, it } from "vitest";
// node:child_process is typed locally in ship.d.ts so this gate needs no
// @types/node dependency and tsc --noEmit stays green.
import { execFileSync } from "node:child_process";

/**
 * Pre-ship verification gate (T11 / D14).
 *
 * Before opening the PR for the first vertical slice we prove two things about
 * the git state mechanically, so a green suite is a precondition for shipping:
 *
 *  1. The slice diff against its base branch (feat/agent-team-harness) touches
 *     only the intended slice files — no stray edits sneak into the PR.
 *  2. The commit that ships the slice carries a Conventional-Commits `feat:`
 *     subject, as required by .claude/rules/commit-and-pr-prefixes.md and D14.
 *
 * The base branch is where this slice was cut from; the bootstrap scaffold
 * (package.json, tsconfig, vite.config, the SPA shell, version.ts) rides along
 * because the project was scaffolded on the same lineage, so those are part of
 * the legitimate slice surface here.
 */

const BASE = "feat/agent-team-harness";

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/** Files the slice is allowed to add or change relative to the base branch. */
const ALLOWED_SLICE_FILES = new Set<string>([
  // The load-bearing slice itself.
  "src/game.ts",
  "src/game.test.ts",
  "src/App.tsx",
  "src/App.test.tsx",
  "src/screens/TitleScreen.tsx",
  "src/screens/TitleScreen.test.tsx",
  "src/screens/PromptScreen.tsx",
  "src/screens/PromptScreen.test.tsx",
  "src/screens/RevealScreen.tsx",
  "src/screens/RevealScreen.test.tsx",
  "src/screens/screenStyles.test.tsx",
  "src/tokens.css",
  "src/ship.test.ts",
  "src/ship.d.ts",
  // Backlog reconciliation (D13).
  "docs/team/backlog.md",
  "docs/team/charter.md",
  // Bootstrap scaffold carried on the same branch lineage.
  ".claude/CLAUDE.md",
  ".gitignore",
  "index.html",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "src/main.tsx",
  "src/setupTests.ts",
  "src/version.ts",
]);

describe("pre-ship verification gate", () => {
  it("changes only intended slice files relative to the base branch", () => {
    const changed = git("diff", "--name-only", `${BASE}...HEAD`)
      .split("\n")
      .filter(Boolean);

    expect(changed.length).toBeGreaterThan(0);

    const unexpected = changed.filter((f) => !ALLOWED_SLICE_FILES.has(f));
    expect(unexpected).toEqual([]);
  });

  it("ships the slice with a Conventional-Commits feat: subject", () => {
    const subjects = git("log", "--format=%s", `${BASE}..HEAD`)
      .split("\n")
      .filter(Boolean);

    expect(subjects.length).toBeGreaterThan(0);

    // Every commit on the slice branch follows Conventional Commits, and the
    // slice is shipped under at least one `feat` commit.
    const conventional =
      /^(feat|fix|refactor|docs|test|chore|style|ci|build|perf)(\([a-z0-9-]+\))?: .+/;
    for (const subject of subjects) {
      expect(subject, `subject is not Conventional Commits: "${subject}"`).toMatch(
        conventional,
      );
    }

    const hasFeat = subjects.some((s) => /^feat(\([a-z0-9-]+\))?: /.test(s));
    expect(hasFeat, "no feat: commit ships the slice").toBe(true);
  });
});
