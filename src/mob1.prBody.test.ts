import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";

/*
 * MOB1 #148 — PR-honesty lint (T5).
 *
 * T5 opens the PR for branch `fix/mob1-safe-area-eager-touch` against `main`
 * with a body that matches the diff and is honest about scope. Per converge
 * decision D4 the work on this branch is the bundled #148 (safe-area + dvh CSS
 * tokens) + #151 (eager-mount touch-control seam) effort PLUS its honesty
 * follow-up (the corrected run log and the lint guarding it), so the PR body
 * MUST:
 *   - exist and target `main`;
 *   - name slice #151 (the eager-mount seam) so the bundled scope is visible,
 *     not hidden;
 *   - carry a dedicated NEEDS VERIFICATION heading for the on-device checks the
 *     headless suite cannot prove (charter "never a silent pass");
 *   - NOT carry the retracted false "CSS-only" / "CSS/DOM-only" scope claim the
 *     diff contradicts.
 *
 * This is a presence/absence text lint over the live PR body, read through the
 * GitHub CLI (`gh pr view ... --json`). `gh` is the source of truth for whether
 * the PR exists; the body fields are scanned for the required and forbidden
 * substrings. If `gh` is unavailable / unauthenticated the lint is skipped
 * rather than failing CI on an environment gap.
 */

const BRANCH = "fix/mob1-safe-area-eager-touch";

interface PrView {
  number: number;
  baseRefName: string;
  body: string;
}

function ghAvailable(): boolean {
  try {
    execFileSync("gh", ["auth", "status"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function viewPr(): PrView | null {
  try {
    const out = execFileSync(
      "gh",
      ["pr", "view", BRANCH, "--json", "number,baseRefName,body"],
      { encoding: "utf8" },
    );
    return JSON.parse(out) as PrView;
  } catch {
    return null;
  }
}

const run = ghAvailable() ? describe : describe.skip;

run("MOB1 #148 — the PR for the branch exists and its body is honest about scope", () => {
  it("a PR exists for the branch and targets main", () => {
    const pr = viewPr();
    expect(pr, "expected an open PR for " + BRANCH).not.toBeNull();
    expect(pr!.number).toBeGreaterThan(0);
    expect(pr!.baseRefName).toBe("main");
  });

  it("names slice #151 so the bundled eager-mount scope is visible, not hidden", () => {
    const pr = viewPr();
    expect(pr).not.toBeNull();
    expect(pr!.body).toContain("#151");
  });

  it("carries a dedicated NEEDS VERIFICATION heading for the on-device checks", () => {
    const pr = viewPr();
    expect(pr).not.toBeNull();
    expect(pr!.body).toMatch(/^#+\s*NEEDS VERIFICATION/im);
  });

  it("does NOT carry the retracted false 'CSS-only' / 'CSS/DOM-only' scope claim", () => {
    const pr = viewPr();
    expect(pr).not.toBeNull();
    expect(pr!.body).not.toContain("CSS-only");
    expect(pr!.body).not.toContain("CSS/DOM-only");
  });
});
