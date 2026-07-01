import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * F1 slice 3 (#131) — T10: run-log presence + honesty lint.
 *
 * This file lives in src/ so `npm test` (vitest include = src/**) runs it, but
 * it guards a DOCS deliverable: the run log
 *   docs/team/runs/2026-07-02-f1-share-cta-completion-panel-131.md
 * Guardrail 4 (Auditable) requires the log to record the load-bearing,
 * hard-to-verify facts of this slice so the audit trail cannot silently regress
 * to a green-but-empty stub. It mirrors src/share/socialMetaRunlog.test.ts and
 * src/ui/titleControlsChannel.runlog.test.ts: a pure-string presence/content
 * lint over committed markdown, NOT a re-derivation of any runtime value.
 *
 * The honesty commitments T10 must stand behind:
 *   - the CORRECTED dev-URL statement: a dev-server share copies origin + '/'
 *     (https://nikolajmosbaek.github.io/) — a WRONG link missing the
 *     /AboutMeGame/ base — correct only in production builds; the prior
 *     "canonical prod URL by design" claim is retracted;
 *   - the TitleScreen Share CTA omission and its zero-added-scope rationale;
 *   - the three-entry NEEDS VERIFICATION list: native share sheet on a real
 *     device, real screen-reader utterance, and the disabled-focus-drop
 *     restore branch (dead code in jsdom, which never blurs on disable);
 *   - the three-not-four CompletionPanel test-file count;
 *   - the unpinnable shipped-URL note (Vitest BASE_URL is '/'; socialUrlHref
 *     is the unit seam, realShareUrl is verified by diff review);
 *   - PR wiring: references #131, closes epic #124, unblocks A1 (#146).
 *
 * Like titleControlsChannel.runlog.test.ts, this lint asserts the PRESENCE and
 * SHAPE of the required claims — never a pinned ossifying count (the stale
 * MOB1-pinned-baseline trap).
 */

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// src/ui -> repo root is two levels up.
const REPO_ROOT = join(MODULE_DIR, "..", "..");
const RUNLOG = join(
  REPO_ROOT,
  "docs",
  "team",
  "runs",
  "2026-07-02-f1-share-cta-completion-panel-131.md",
);

const log = (): string => readFileSync(RUNLOG, "utf8");

describe("F1 #131 / T10 — run log exists at the hard-coded path and is auditable", () => {
  it("the run log exists under docs/team/runs/ at the exact path the lint pins", () => {
    expect(existsSync(RUNLOG)).toBe(true);
  });

  it("lives only under docs/ — the deliverable adds no .claude files", () => {
    expect(RUNLOG).toContain(join("docs", "team", "runs"));
    expect(RUNLOG).not.toContain(".claude");
  });

  it("names the slice it records (F1 #131, Share CTA on the CompletionPanel)", () => {
    const lc = log().toLowerCase();
    expect(log()).toContain("#131");
    expect(lc).toMatch(/share cta/);
    expect(lc).toMatch(/completionpanel|completion panel/);
  });
});

describe("F1 #131 / T10 — corrected dev-URL statement (prior claim retracted)", () => {
  it("states the dev-mode share copies origin + '/' — the literal wrong link", () => {
    // Origin + '/' NOT followed by AboutMeGame: the wrong dev link itself, not
    // the correct production URL that shares the same prefix.
    expect(log()).toMatch(/https:\/\/nikolajmosbaek\.github\.io\/(?!AboutMeGame)/);
  });

  it("calls the dev link WRONG and names the missing /AboutMeGame/ base", () => {
    const lc = log().toLowerCase();
    expect(lc).toMatch(/wrong/);
    expect(log()).toContain("/AboutMeGame/");
    expect(lc).toMatch(/missing/);
  });

  it("scopes the defect to dev only — correct in production builds", () => {
    const lc = log().toLowerCase();
    expect(lc).toMatch(/dev[- ]only|only in dev|dev server|dev mode/);
    expect(lc).toMatch(/production build/);
  });

  it("retracts the prior 'canonical prod URL by design' claim explicitly", () => {
    expect(log().toLowerCase()).toMatch(/retract/);
  });
});

describe("F1 #131 / T10 — TitleScreen Share CTA omission + zero-added-scope rationale", () => {
  it("records the TitleScreen CTA as omitted", () => {
    const lc = log().toLowerCase();
    expect(lc).toContain("titlescreen");
    expect(lc).toMatch(/omitted|omission/);
  });

  it("gives the zero-added-scope rationale (no dialog/CTA row, no live-region host, no trap)", () => {
    const lc = log().toLowerCase();
    expect(lc).toMatch(/zero[- ]added[- ]scope|added scope/);
    expect(lc).toMatch(/live[- ]region host/);
    expect(lc).toMatch(/trap/);
  });

  it("names extraction as premature with only one call site", () => {
    const lc = log().toLowerCase();
    expect(lc).toMatch(/premature/);
    expect(lc).toMatch(/one call site|second (concrete )?call site/);
  });
});

describe("F1 #131 / T10 — three-not-four CompletionPanel test-file count", () => {
  it("names all three pre-existing CompletionPanel test files", () => {
    const text = log();
    expect(text).toContain("CompletionPanel.test.tsx");
    expect(text).toContain("CompletionPanel.replay.test.tsx");
    expect(text).toContain("CompletionPanel.a11y.test.tsx");
  });

  it("counts what exists: three, not four", () => {
    expect(log().toLowerCase()).toMatch(/three, not four/);
  });

  it("records that the pre-existing files pass unmodified (byte-identical)", () => {
    expect(log().toLowerCase()).toMatch(/byte[- ]identical/);
  });
});

describe("F1 #131 / T10 — the shipped URL string cannot be pinned headlessly", () => {
  it("states Vitest's BASE_URL is '/' so the exact shipped string is unpinnable", () => {
    const text = log();
    const lc = text.toLowerCase();
    expect(text).toContain("BASE_URL");
    expect(lc).toMatch(/cannot be pinned|unpinnable/);
    expect(lc).toMatch(/headless|vitest/);
  });

  it("names socialUrlHref as the unit seam and realShareUrl as diff-review-verified", () => {
    const text = log();
    expect(text).toContain("socialUrlHref");
    expect(text.toLowerCase()).toMatch(/unit seam/);
    expect(text).toContain("realShareUrl");
    expect(text.toLowerCase()).toMatch(/diff review/);
    expect(text).toContain("socialMeta.test.ts");
  });
});

describe("F1 #131 / T10 — PR wiring: references #131, closes epic #124, unblocks A1 (#146)", () => {
  it("records that the PR references #131", () => {
    expect(log()).toContain("#131");
  });

  it("records that merging closes epic #124 (F1)", () => {
    const text = log();
    expect(text).toContain("#124");
    expect(text.toLowerCase()).toMatch(/close[sd]? (the )?epic|epic #124/);
  });

  it("records that it unblocks A1 (#146)", () => {
    const text = log();
    expect(text).toContain("#146");
    expect(text.toLowerCase()).toMatch(/unblock/);
  });
});

describe("F1 #131 / T10 — NEEDS VERIFICATION carries all three honest gaps", () => {
  // Isolate the NEEDS VERIFICATION section so the lint reasons over the gap
  // body, not a stray mention of the word elsewhere.
  const needsVerificationSection = (): string => {
    const text = log();
    const start = text.search(/^#+\s*NEEDS VERIFICATION/im);
    expect(start, "a NEEDS VERIFICATION heading").toBeGreaterThanOrEqual(0);
    const rest = text.slice(start);
    const afterHeaderLine = rest.indexOf("\n") + 1;
    const body = rest.slice(afterHeaderLine);
    const nextHeading = body.search(/^#{1,2}\s/m);
    return nextHeading === -1
      ? rest
      : rest.slice(0, afterHeaderLine + nextHeading);
  };

  it("carries the literal 'NEEDS VERIFICATION' heading", () => {
    expect(log()).toMatch(/^#+\s*NEEDS VERIFICATION/im);
  });

  it("entry 1: native share sheet behaviour on a real device", () => {
    const lc = needsVerificationSection().toLowerCase();
    expect(lc).toMatch(/share[- ]sheet|share sheet/);
    expect(lc).toMatch(/real device|on[- ]device/);
  });

  it("entry 2: real screen-reader utterance (RTL proves DOM shape/text only)", () => {
    const lc = needsVerificationSection().toLowerCase();
    expect(lc).toMatch(/screen[- ]reader/);
    expect(lc).toMatch(/utterance/);
    expect(lc).toMatch(/dom shape|dom structure|shape\/text|dom text/);
  });

  it("entry 3: the disabled-focus-drop restore branch is dead code in jsdom", () => {
    const lc = needsVerificationSection().toLowerCase();
    expect(lc).toMatch(/disabled[- ]focus[- ]drop|focus[- ]restore|restore branch/);
    expect(lc).toMatch(/jsdom/);
    expect(lc).toMatch(/dead code|never blurs/);
  });

  it("does not CLAIM any gap as verified/proven (no silent pass)", () => {
    const lc = needsVerificationSection().toLowerCase();
    // Strip honest negated forms before scanning, so only an affirmative claim
    // of success fails the lint.
    const withoutHonestNegations = lc
      .replace(/cannot be proven/g, "")
      .replace(/un(?:provable|proven|pinnable)/g, "")
      .replace(/not (?:yet )?(?:asserted|proven|verified|exercised)/g, "")
      .replace(/never (?:asserted|claimed|verified|proven)/g, "")
      .replace(/needs[\s-]?verification/g, "");
    expect(withoutHonestNegations).not.toMatch(/\bverified\b/);
    expect(withoutHonestNegations).not.toMatch(/\bproven\b/);
    expect(withoutHonestNegations).not.toMatch(/\bproved\b/);
  });
});
