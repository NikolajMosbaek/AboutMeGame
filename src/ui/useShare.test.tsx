// F1 slice 2 (#130) — the share-outcome contract and (in later tasks) the full
// behaviour matrix for the DI-injected useShare hook. Everything in here runs
// headless: capabilities are plain fakes, never a real navigator.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { performShare, type ShareCapabilities, type ShareOutcome } from "./useShare.ts";

// Directory of THIS test file, used to read the module source for the static
// (grep-style) global-isolation gate below. Mirrors dayCycle.test.ts /
// waterSurface.test.ts, the house source-of-truth for source-scan guards.
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** Strip `//` and block comments only, preserving string/template literals.
 * (Mirrors dayCycle.test.ts.) */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments (incl. jsdoc)
    .replace(/\/\/[^\n]*/g, " "); // line comments
}

/** Strip comments AND string/template literals so the forbidden-global scan
 * (`navigator`, `window`, …) doesn't trip over prose in jsdoc — the mandated
 * JSDoc legitimately names `navigator.share` (Illegal-invocation and
 * composition-point guidance for #131). Mirrors dayCycle.test.ts:381-391. */
function stripCommentsAndStrings(src: string): string {
  return stripComments(src)
    .replace(/"(?:[^"\\]|\\.)*"/g, '""') // double-quoted strings
    .replace(/'(?:[^'\\]|\\.)*'/g, "''") // single-quoted strings
    .replace(/`(?:[^`\\]|\\.)*`/g, "``"); // template literals
}

describe("ShareOutcome contract (#130)", () => {
  it("is a closed four-member union that #131 can exhaustiveness-check with a never guard", () => {
    // (a) Assignability: each of the four designed literals IS a member. A
    // renamed or removed member breaks this line at compile time.
    const allOutcomes: readonly ShareOutcome[] = [
      "shared",
      "copied",
      "cancelled",
      "failed",
    ];

    // (b) Closedness: a switch whose default assigns the value to `never`
    // compiles only if NO fifth member exists — exactly the exhaustiveness
    // guard #131's announcement mapping will use. `npm run build` runs
    // `tsc --noEmit` over src/ (tests included), so this is a hard gate.
    const label = (outcome: ShareOutcome): string => {
      switch (outcome) {
        case "shared":
          return "shared";
        case "copied":
          return "copied";
        case "cancelled":
          return "cancelled";
        case "failed":
          return "failed";
        default: {
          const unreachable: never = outcome;
          return unreachable;
        }
      }
    };

    expect(allOutcomes.map(label)).toEqual([
      "shared",
      "copied",
      "cancelled",
      "failed",
    ]);
  });
});

describe("performShare decision ladder — primary paths (#130)", () => {
  const url = "https://example.test/AboutMeGame/";

  it("share absent + resolving writeText → 'copied', writeText received exactly the injected url", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(
      performShare({ clipboard: { writeText } }, url),
    ).resolves.toBe("copied");

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(url);
  });

  it("share present → called synchronously with { url } before the promise is awaited, resolves 'shared', writeText never called", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);

    const promise = performShare({ share, clipboard: { writeText } }, url);

    // Synchronous invocation: the capability was called before we awaited the
    // returned promise — no await precedes it inside performShare, so the user
    // gesture's transient activation is still live when the sheet opens.
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({ url });

    await expect(promise).resolves.toBe("shared");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("clipboard present but writeText missing (partial-capability WebView) → 'failed' without throwing", async () => {
    await expect(performShare({ clipboard: {} }, url)).resolves.toBe("failed");
  });

  it("writeText present but not a function → 'failed' (typeof guard, never a throw)", async () => {
    const capabilities = {
      clipboard: { writeText: "not-a-function" },
    } as unknown as ShareCapabilities;

    await expect(performShare(capabilities, url)).resolves.toBe("failed");
  });

  it("both capabilities absent → 'failed' without throwing", async () => {
    await expect(performShare({}, url)).resolves.toBe("failed");
  });
});

// --- global isolation (source scan, comment-stripped) -----------------------
// Both the capabilities AND the url are required injected inputs; the module
// must read no global at all. Enforced statically — a grep of the executable
// source, not just review — so a future edit that sneaks `navigator` in (e.g.
// a defaulted parameter) turns the suite red.
describe("useShare.ts global isolation (#130 source-scan gate)", () => {
  const src = readFileSync(join(MODULE_DIR, "useShare.ts"), "utf8");

  it("RAW source mentions navigator.share in JSDoc — the stripper is doing real work, not passing vacuously", () => {
    // The designed JSDoc must name navigator.share (arrow-wrap obligation for
    // #131). If this ever disappears, the comment-stripping in the scan below
    // is no longer proven to be load-bearing — revisit both together.
    expect(src).toContain("navigator.share");
    expect(src).toMatch(/\bnavigator\b/);
  });

  it("comment-stripped source contains no navigator, window, location, or document token", () => {
    const code = stripCommentsAndStrings(src);
    expect(code).not.toMatch(/\bnavigator\b/);
    expect(code).not.toMatch(/\bwindow\b/);
    expect(code).not.toMatch(/\blocation\b/);
    expect(code).not.toMatch(/\bdocument\b/);
  });
});

// --- #131 handoff contract (JSDoc checklist) ---------------------------------
// The JSDoc IS the handoff artifact: #131's live-region switch maps each
// ShareOutcome to an announcement with zero further branching, and its
// composition point follows the caller obligations verbatim. This gate greps
// the RAW source (comments are the contract here — the inverse of the
// isolation scan above) and fails if a rule goes missing, duplicates, or
// drifts into ambiguity.

/** Strip JSDoc line-prefix `*`s and collapse whitespace so multi-line JSDoc
 * sentences match as single strings. */
function normalizeDoc(doc: string): string {
  return doc
    .replace(/^\s*\*\s?/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Count matches of a /g regex. */
function countMatches(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

describe("useShare.ts JSDoc — #131 handoff contract (announcement rules + caller obligations)", () => {
  const src = readFileSync(join(MODULE_DIR, "useShare.ts"), "utf8");

  const outcomeDoc = src.match(/\/\*\*([\s\S]*?)\*\/\s*export type ShareOutcome/);
  const hookDoc = src.match(/\/\*\*([\s\S]*?)\*\/\s*export function useShare/);

  it("every ShareOutcome value maps to exactly ONE announcement rule, and it is the agreed one", () => {
    expect(outcomeDoc).not.toBeNull();
    const normalized = normalizeDoc(outcomeDoc![1]);

    // The union JSDoc holds one bullet per outcome, in declaration order.
    const bullets = normalized.split(/(?=- `")/).slice(1);
    expect(bullets).toHaveLength(4);

    const expected: ReadonlyArray<[outcome: string, rule: string]> = [
      ['`"shared"`', "Announcement: **optional / none**"],
      ['`"copied"`', 'Announcement: **"Link copied", mandatory**'],
      ['`"cancelled"`', "Announcement: **silence**"],
      ['`"failed"`', "Announcement: **recoverable copy**"],
    ];

    expected.forEach(([outcome, rule], i) => {
      expect(bullets[i]).toContain(outcome);
      // Exactly one rule marker per bullet — no second, contradictory rule.
      expect(countMatches(bullets[i], /Announcement:/g)).toBe(1);
      expect(bullets[i]).toContain(rule);
    });

    // The union JSDoc is the SINGLE announcement authority: no stray fifth
    // rule anywhere else in the module for #131 to trip over.
    expect(countMatches(src, /Announcement:/g)).toBe(4);
  });

  it("all four caller obligations are stated in the useShare JSDoc, each exactly once", () => {
    expect(hookDoc).not.toBeNull();
    const normalized = normalizeDoc(hookDoc![1]);

    // Exactly four obligation bullets — the handoff list is closed.
    expect(countMatches(normalized, /- \*\*/g)).toBe(4);

    const obligations: readonly RegExp[] = [
      /Disable the CTA while a `share\(\)` call is pending/g, // disable-while-pending
      /referentially stable `capabilities` and `url`/g, // stable references
      /Arrow-wrap `navigator\.share`/g, // binding trap
      /socialUrlHref\(import\.meta\.env\.BASE_URL\)/g, // canonical URL
    ];
    for (const obligation of obligations) {
      expect(countMatches(normalized, obligation)).toBe(1);
    }

    // The canonical-URL obligation names its single existing source.
    expect(normalized).toContain("src/share/socialMeta.ts");
    // ...and the module names it exactly once — one authority, no echo.
    expect(countMatches(src, /socialUrlHref/g)).toBe(1);
  });

  it('the mandatory copied announcement "Link copied" appears exactly once — one authoritative string for #131 to lift', () => {
    expect(countMatches(src, /Link copied/g)).toBe(1);
  });
});
