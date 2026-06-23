import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * MOB2 #153 slice 1 — run-log presence + honesty lint (T5).
 *
 * This file lives in src/ so `npm test` (vitest include = src/**) runs it, but it
 * guards a DOCS deliverable: the converged-design run log
 *   docs/team/runs/2026-06-24-mob2-top-hud-safe-area-153-slice1.md
 * Guardrail 4 (Auditable) and the charter's "never a silent pass" policy require
 * that run log to (a) exist, (b) name the on-device clearance gap as a non-silent
 * NEEDS-VERIFICATION item the headless gates cannot prove, and (c) report the
 * honest build deltas — JS/asset ~0 and CSS GROWS a few hundred authored bytes,
 * explicitly NOT "zero bytes".
 *
 * It is a presence/text lint over a docs deliverable, NOT a re-derivation of a
 * runtime value (jsdom evaluates no env()/@media; the rendered notch clearance is
 * the very NEEDS-VERIFICATION item this lint pins, not something it can assert).
 */

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// src -> repo root is one level up.
const REPO_ROOT = join(MODULE_DIR, "..");
const RUNLOG = join(
  REPO_ROOT,
  "docs",
  "team",
  "runs",
  "2026-06-24-mob2-top-hud-safe-area-153-slice1.md",
);

const log = (): string => readFileSync(RUNLOG, "utf8");

describe("MOB2 #153 — converged-design run log exists and is auditable", () => {
  it("the run log exists under docs/team/runs/", () => {
    expect(existsSync(RUNLOG)).toBe(true);
  });

  it("names the slice it records (MOB2 #153, top-HUD safe-area)", () => {
    const lc = log().toLowerCase();
    expect(lc).toContain("mob2");
    expect(log()).toContain("#153");
    expect(lc).toMatch(/top hud|top-hud|top-anchored/);
  });
});

describe("MOB2 #153 — run log flags the on-device clearance gap as NEEDS VERIFICATION", () => {
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

  it("enumerates the notched-iPhone clearance gap (portrait + landscape, URL bar shown + collapsed)", () => {
    const section = needsVerificationSection();
    const lc = section.toLowerCase();
    expect(lc).toMatch(/notch|notched|dynamic island|status bar/);
    expect(lc).toMatch(/portrait/);
    expect(lc).toMatch(/landscape/);
    expect(lc).toMatch(/url bar/);
    // The Settings gateway: the menu button sits below the inset AND opens on tap.
    expect(lc).toMatch(/menu|settings/);
    expect(lc).toMatch(/tap/);
  });

  it("records the gap as unprovable by headless Vitest / desktop-Chromium Playwright", () => {
    const lc = needsVerificationSection().toLowerCase();
    expect(lc).toMatch(/vitest/);
    expect(lc).toMatch(/playwright|chromium/);
  });

  it("does not CLAIM the on-device clearance as verified/proven", () => {
    const lc = needsVerificationSection().toLowerCase();
    // Strip the honest negated forms before scanning, so only an affirmative
    // claim of success fails the lint.
    const withoutHonestNegations = lc
      .replace(/cannot be proven/g, "")
      .replace(/not (?:yet )?(?:asserted|proven|verified)/g, "")
      .replace(/\bunproven\b/g, "")
      .replace(/never asserted/g, "");
    expect(withoutHonestNegations).not.toMatch(/\bverified\b/);
    expect(withoutHonestNegations).not.toMatch(/\bproven\b/);
    expect(withoutHonestNegations).not.toMatch(/\bproved\b/);
  });
});

describe("MOB2 #153 — run log reports the honest build deltas (NOT 'zero bytes')", () => {
  it("states JS / asset delta is ~0", () => {
    const lc = log().toLowerCase();
    expect(lc).toMatch(/229\.10|js.*(~0|unchanged)|asset.*(~0|unchanged)/);
  });

  it("states the CSS GROWS a few hundred authored bytes, NOT zero", () => {
    const lc = log().toLowerCase();
    // Must assert CSS growth explicitly.
    expect(lc).toMatch(/css.*(grow|few hundred|hundred authored bytes)/);
    // Must explicitly disclaim the false "zero bytes" framing.
    expect(lc).toMatch(/not[\s'"]*zero bytes|zero bytes/);
  });
});

describe("MOB2 #153 — run log records the D1 empirical idiom finding and D4 belt-and-suspenders", () => {
  it("records the empirical max() probe (8px desktop / 47px notch)", () => {
    const text = log();
    expect(text).toMatch(/max\(var\(--space-1\), var\(--safe-top\)\)/);
    expect(text).toContain("8px");
    expect(text).toContain("47px");
  });

  it("states D4 plainly as belt-and-suspenders for the standalone .discovery-progress render path", () => {
    const lc = log().toLowerCase();
    expect(lc).toContain(".discovery-progress");
    expect(lc).toMatch(/belt-and-suspenders|belt and suspenders|defense-in-depth|defence-in-depth/);
    expect(lc).toMatch(/standalone/);
  });
});
