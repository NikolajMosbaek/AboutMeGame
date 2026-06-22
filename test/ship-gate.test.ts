import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Ship gate (T11).
//
// The ship task lands the two corrections as separate Conventional Commits on
// `bootstrap/stack-and-scaffold` and opens a PR to `main`. This gate proves the
// resulting PR is in the state the task contract requires, asserted against the
// real PR on GitHub via the `gh` CLI (not a local guess):
//
//   - a PR is OPEN from head `bootstrap/stack-and-scaffold` into base `main`;
//   - the source branch is explicitly NOT `feat/vertical-slice`;
//   - the PR body records the `npm audit` caveat (1 critical / 1 high of 5) and
//     the absence of CI, so a later run does not inherit them silently;
//   - no merge has been performed (the PR is not merged), honouring "no
//     auto-merge until told gates passed".
//
// It shells out to `gh` and reaches the network, so — like the install/build/
// dev gates — it lives outside src/, runs under the node environment with a
// long timeout via its own config, and is invoked through
// `npm run test:ship-gate`, not the fast `npm test` unit suite.

const HEAD_BRANCH = "bootstrap/stack-and-scaffold";
const BASE_BRANCH = "main";

interface PullRequest {
  number: number;
  state: string;
  baseRefName: string;
  headRefName: string;
  mergedAt: string | null;
  body: string;
}

/** Read the PR opened from the bootstrap branch via the gh CLI. */
function readPullRequest(): PullRequest {
  const raw = execFileSync(
    "gh",
    [
      "pr",
      "view",
      HEAD_BRANCH,
      "--json",
      "number,state,baseRefName,headRefName,mergedAt,body",
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(raw) as PullRequest;
}

describe("ship gate (PR to main)", () => {
  const pr = readPullRequest();

  it("is OPEN from bootstrap/stack-and-scaffold into main", () => {
    expect(pr.state).toBe("OPEN");
    expect(pr.headRefName).toBe(HEAD_BRANCH);
    expect(pr.baseRefName).toBe(BASE_BRANCH);
  });

  it("does NOT source from feat/vertical-slice", () => {
    expect(pr.headRefName).not.toBe("feat/vertical-slice");
  });

  it("notes the npm audit caveat (1 critical / 1 high of 5) in the body", () => {
    expect(pr.body).toMatch(/audit/i);
    expect(pr.body).toMatch(/critical/i);
    expect(pr.body).toMatch(/high/i);
  });

  it("notes the absence of CI in the body", () => {
    expect(pr.body).toMatch(/\bCI\b/);
  });

  it("has not been merged (no auto-merge until gates passed)", () => {
    expect(pr.state).not.toBe("MERGED");
    expect(pr.mergedAt).toBeNull();
  });
});
