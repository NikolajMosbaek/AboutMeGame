import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * A2 #142 slice (final slice of epic #127) — run-log presence + honesty lint (T4).
 *
 * This file lives in src/ so `npm test` (vitest include = src/**) runs it, but it
 * guards a DOCS deliverable: the run log under
 *   docs/team/runs/2026-06-24-a2-title-controls-channel-142.md
 * The path is HARD-CODED — the log must be authored at EXACTLY this path or this
 * guard fails for the wrong reason.
 *
 * #142 drives the single `.title-controls` hint in src/ui/TitleScreen.tsx from
 * the resolved control channel (src/ui/controlScheme.ts) so a coarse-pointer /
 * touch visitor sees touch copy, while keyboard stays the safe default and the
 * desktop copy is byte-for-byte unchanged. The channel->copy mapping is
 * unit-proven via an injected `channel="touch"` prop, but the live
 * `matchMedia('(pointer: coarse)')` resolution on a real phone is NOT something
 * the headless Vitest suite (jsdom has no matchMedia) or the desktop-Chromium
 * Playwright smoke can prove — so it must be flagged NEEDS VERIFICATION, never
 * claimed as an on-device pass (charter standing on-device-gap policy).
 *
 * A bundle-size delta cannot be re-derived from any runtime expression, so an
 * `expect(delta).toBe(...)` evaluated in jsdom would be a fabrication (mirrors
 * src/world/landmarks.gzip.runlog.test.ts). The only thing this suite can
 * honestly assert is that the measurement was performed and its load-bearing
 * claims recorded, so the gate can't silently regress to a green-but-empty stub:
 *   - the run-log entry exists at the hard-coded path, names A2 #142, and adds no
 *     .claude files;
 *   - it cites a real MEASURED `vite build` gzip delta as a concrete byte number
 *     (NOT an asserted ~0), and confirms it within docs/perf-budget.md;
 *   - it flags the live coarse-pointer matchMedia resolution as NEEDS
 *     VERIFICATION on a real device and does NOT claim it verified.
 *
 * CRITICAL: this lint asserts the PRESENCE and SHAPE of the required claims, not
 * an exact ossifying file/test count. The stale MOB1 logs that pinned a hard
 * baseline count are the cautionary trap — a real green run went red at the gate
 * against a hard-coded number. The "first test to write" for T4 is the pair of
 * greps below: the cited measured gzip-delta number AND an explicit
 * "needs verification on device" phrasing for the coarse-pointer matchMedia path.
 */

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// src/ui -> repo root is two levels up.
const REPO_ROOT = join(MODULE_DIR, "..", "..");
const RUNLOG = join(
  REPO_ROOT,
  "docs",
  "team",
  "runs",
  "2026-06-24-a2-title-controls-channel-142.md",
);

const log = (): string => readFileSync(RUNLOG, "utf8");

describe("A2 #142 / T4 — run log exists at the hard-coded path and is auditable", () => {
  it("the run log exists under docs/team/runs/ at the exact path the lint pins", () => {
    expect(existsSync(RUNLOG)).toBe(true);
  });

  it("lives only under docs/ — the deliverable adds no .claude files", () => {
    expect(RUNLOG).toContain(join("docs", "team", "runs"));
    expect(RUNLOG).not.toContain(".claude");
  });

  it("names the slice it records (A2 #142, the title controls channel hint)", () => {
    const lc = log().toLowerCase();
    expect(lc).toContain("a2");
    expect(log()).toContain("#142");
    expect(lc).toMatch(/title-controls|controls hint|control channel|controlscheme/);
  });
});

describe("A2 #142 / T4 — run log records the converged decision", () => {
  it("records the param-default channel = readControlChannel() seam (NOT a useRef)", () => {
    const lc = log().toLowerCase();
    expect(lc).toContain("readcontrolchannel()");
    expect(lc).toMatch(/param[\s-]?default|default parameter|default arg/);
    // The owned disagreement: param-default chosen over a useRef.
    expect(lc).toMatch(/useref/);
  });

  it("records the title-local KEYBOARD_HINT / TOUCH_HINT literals and channel-only consumption", () => {
    const log_ = log();
    expect(log_).toContain("KEYBOARD_HINT");
    expect(log_).toContain("TOUCH_HINT");
    const lc = log_.toLowerCase();
    // Channel is the ONLY thing consumed from controlScheme.ts — not the resolver
    // entry table.
    expect(lc).toMatch(/only.*channel|channel.*only|not.*entries|not.*resolvecontrolscheme/);
  });
});

describe("A2 #142 / T4 — run log cites the MEASURED build/gzip delta (T3, not asserted)", () => {
  it("cites a real vite build / npm run build, measured not asserted", () => {
    const lc = log().toLowerCase();
    expect(lc).toMatch(/npm run build|vite build/);
    expect(lc).toMatch(/measured/);
    // The honest framing: the delta is a measured build figure, never an asserted
    // runtime ~0.
    expect(lc).toMatch(/not asserted|measured, not|never asserted/);
  });

  it("cites a concrete measured gzip-delta byte number (the 'first test to write' grep)", () => {
    // A concrete byte figure of the form '+N bytes' or 'N bytes' — its SHAPE is
    // required (the cited measured delta from T3), never a vague '~0'.
    expect(log()).toMatch(/\+?\d{1,3}\s*bytes/i);
  });

  it("confirms the result is within docs/perf-budget.md (400 KB gz cap)", () => {
    const lc = log().toLowerCase();
    expect(lc).toContain("perf-budget");
    expect(lc).toMatch(/within|inside|under/);
    expect(lc).toMatch(/400\s*kb/);
  });
});

describe("A2 #142 / T4 — run log cites the fully-green test baseline", () => {
  it("cites a fully-green npm test run with a concrete count (shape, not a pinned number)", () => {
    const lc = log().toLowerCase();
    expect(lc).toMatch(/npm test/);
    // A concrete passing count of the form N/N or "N passed" — its SHAPE is
    // required, never a specific ossifying number (the MOB1 pinned-count trap).
    expect(log()).toMatch(/\b(\d+)\s*\/\s*\1\b|\b\d+\s+pass(?:ing|ed)\b/);
  });
});

describe("A2 #142 / T4 — run log flags the on-device gap as NEEDS VERIFICATION", () => {
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

  it("uses the explicit 'needs verification on device' phrasing for the matchMedia path (the 'first test to write' grep)", () => {
    const lc = log().toLowerCase();
    // The explicit needs-verification-on-device phrasing tied to the live
    // coarse-pointer matchMedia resolution.
    expect(lc).toMatch(/needs[\s-]?verification on (?:a )?(?:real )?device/);
    expect(lc).toMatch(/match\s*media|\(pointer:\s*coarse\)|coarse[\s-]?pointer/);
  });

  it("states the channel->copy mapping is unit-proven via the injected channel=\"touch\"", () => {
    const lc = needsVerificationSection().toLowerCase();
    expect(lc).toMatch(/unit[\s-]?proven|injected channel|channel="touch"|channel touch/);
  });

  it("records the gap as unprovable by headless Vitest (jsdom has no matchMedia)", () => {
    const lc = needsVerificationSection().toLowerCase();
    expect(lc).toMatch(/vitest|jsdom|headless/);
    expect(lc).toMatch(/matchmedia|coarse/);
  });

  it("does not CLAIM the on-device coarse-pointer resolution as verified/proven (no silent pass)", () => {
    const lc = needsVerificationSection().toLowerCase();
    // Strip the honest negated forms before scanning, so only an affirmative
    // claim of success fails the lint.
    const withoutHonestNegations = lc
      .replace(/cannot be proven/g, "")
      .replace(/un(?:provable|proven)/g, "")
      .replace(/not (?:yet )?(?:asserted|proven|verified)/g, "")
      .replace(/never (?:asserted|claimed)/g, "")
      .replace(/no (?:silent |affirmative )?on-device (?:pass )?claim/g, "")
      .replace(/needs[\s-]?verification/g, "");
    expect(withoutHonestNegations).not.toMatch(/\bverified\b/);
    expect(withoutHonestNegations).not.toMatch(/\bproven\b/);
    expect(withoutHonestNegations).not.toMatch(/\bproved\b/);
  });
});
