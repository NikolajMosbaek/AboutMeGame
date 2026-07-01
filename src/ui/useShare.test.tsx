// F1 slice 2 (#130) — the share-outcome contract and (in later tasks) the full
// behaviour matrix for the DI-injected useShare hook. Everything in here runs
// headless: capabilities are plain fakes, never a real navigator.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  performShare,
  useShare,
  type ShareCapabilities,
  type ShareOutcome,
} from "./useShare.ts";

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

describe("performShare rejection classifier — AbortError vs everything else (#130)", () => {
  const url = "https://example.test/AboutMeGame/";

  it("share rejects with an Error whose name is 'AbortError' → 'cancelled', clipboard positively never called", async () => {
    const share = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("user dismissed"), { name: "AbortError" }),
      );
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(
      performShare({ share, clipboard: { writeText } }, url),
    ).resolves.toBe("cancelled");

    // The user acted deliberately: the fallback must NOT fire — a surprise
    // clipboard write after dismissing the sheet would be hostile.
    expect(writeText).not.toHaveBeenCalled();
  });

  it("share rejects with a DOMException-shaped plain object named 'AbortError' (how real Safari rejects) → 'cancelled', clipboard never called", async () => {
    // Deliberately NOT an Error instance: the classifier must compare
    // err?.name as a string, never rely on instanceof DOMException — the
    // constructor identity differs across realms and test environments.
    const abortLike = {
      name: "AbortError",
      message: "Abort due to cancellation of share.",
      code: 20,
    };
    const share = vi.fn().mockRejectedValue(abortLike);
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(
      performShare({ share, clipboard: { writeText } }, url),
    ).resolves.toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("share synchronously THROWS an AbortError-named error → 'cancelled', clipboard never called, promise never rejects", async () => {
    const share = vi.fn((): Promise<void> => {
      throw Object.assign(new Error("sync abort"), { name: "AbortError" });
    });
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(
      performShare({ share, clipboard: { writeText } }, url),
    ).resolves.toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("share rejects with a non-abort error (NotAllowedError) → falls back to the clipboard → 'copied'", async () => {
    const share = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("gesture expired"), { name: "NotAllowedError" }),
      );
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(
      performShare({ share, clipboard: { writeText } }, url),
    ).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(url);
  });

  it("share rejects with a bare string (non-Error value) → classifies safely onto the non-abort path, fallback fires", async () => {
    // "nope"?.name is undefined — the classifier must not throw on it.
    const share = vi.fn().mockRejectedValue("nope");
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(
      performShare({ share, clipboard: { writeText } }, url),
    ).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(url);
  });

  it("share rejects with undefined → classifies safely onto the non-abort path; no clipboard capability → 'failed', never a throw", async () => {
    // undefined?.name must short-circuit, not TypeError inside the classifier.
    const share = vi.fn().mockRejectedValue(undefined);

    await expect(performShare({ share }, url)).resolves.toBe("failed");
  });
});

describe("performShare fallback tie-breaker — rule (e) wins when the awaited fallback fails (#130)", () => {
  const url = "https://example.test/AboutMeGame/";
  const notAllowed = () =>
    Object.assign(new Error("gesture expired"), { name: "NotAllowedError" });

  it("THE PINNED COMBINED CASE: share rejects NotAllowedError AND writeText rejects NotAllowedError → 'failed', never a throw", async () => {
    // On Safari both APIs are gesture-gated: a NotAllowedError after a
    // NotAllowedError is the expected real-device path, not exotic. The
    // fallback's own rejection must resolve "failed" — rule (e) beats the
    // fallback's "copied" promise of rule (c).
    const share = vi.fn().mockRejectedValue(notAllowed());
    const writeText = vi.fn().mockRejectedValue(notAllowed());

    await expect(
      performShare({ share, clipboard: { writeText } }, url),
    ).resolves.toBe("failed");

    // "failed" is the awaited fallback's verdict, not a skip: writeText WAS
    // routed to, with the exact injected url.
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(url);
  });

  it("share rejects non-abort AND writeText synchronously THROWS → 'failed', promise never rejects", async () => {
    const share = vi.fn().mockRejectedValue(notAllowed());
    const writeText = vi.fn((): Promise<void> => {
      throw notAllowed();
    });

    await expect(
      performShare({ share, clipboard: { writeText } }, url),
    ).resolves.toBe("failed");
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("share rejects non-abort and writeText is absent (partial-capability clipboard) → 'failed' without throwing", async () => {
    const share = vi.fn().mockRejectedValue(notAllowed());

    await expect(performShare({ share, clipboard: {} }, url)).resolves.toBe(
      "failed",
    );
  });
});

describe("performShare never-rejects invariant — one enclosing net (#130)", () => {
  const url = "https://example.test/AboutMeGame/";

  it("share throws synchronously (non-abort) with no clipboard injected → resolves 'failed', never rejects", async () => {
    const share = vi.fn((): Promise<void> => {
      throw Object.assign(new Error("boom"), { name: "TypeError" });
    });

    await expect(performShare({ share }, url)).resolves.toBe("failed");
  });

  it("writeText throws synchronously on the share-absent path → resolves 'failed', never rejects", async () => {
    const writeText = vi.fn((): Promise<void> => {
      throw new Error("clipboard blew up");
    });

    await expect(
      performShare({ clipboard: { writeText } }, url),
    ).resolves.toBe("failed");
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("writeText rejects on the share-absent path → resolves 'failed', never rejects", async () => {
    const writeText = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("denied"), { name: "NotAllowedError" }),
      );

    await expect(
      performShare({ clipboard: { writeText } }, url),
    ).resolves.toBe("failed");
  });

  it("share rejects with a bare string and no clipboard → resolves 'failed', never rejects", async () => {
    const share = vi.fn().mockRejectedValue("nope");

    await expect(performShare({ share }, url)).resolves.toBe("failed");
  });

  it("share rejects with undefined and no clipboard → resolves 'failed', never rejects", async () => {
    const share = vi.fn().mockRejectedValue(undefined);

    await expect(performShare({ share }, url)).resolves.toBe("failed");
  });

  it("a hostile rejection value whose `name` getter itself throws → resolves 'failed' — only the enclosing net can catch this, no branch classifier can", async () => {
    // isAbortError reads err?.name; a throwing getter detonates INSIDE the
    // catch block, past every inner try/catch. Without the enclosing net,
    // performShare rejects and a fire-and-forget caller leaks an unhandled
    // rejection.
    const hostile = {};
    Object.defineProperty(hostile, "name", {
      get(): string {
        throw new Error("gotcha");
      },
    });
    const share = vi.fn().mockRejectedValue(hostile);
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(
      performShare({ share, clipboard: { writeText } }, url),
    ).resolves.toBe("failed");
  });

  it("every branch of the full matrix resolves to a ShareOutcome member — no path rejects", async () => {
    const abort = () =>
      Object.assign(new Error("dismissed"), { name: "AbortError" });
    const notAllowed = () =>
      Object.assign(new Error("gesture expired"), { name: "NotAllowedError" });
    const resolvingWriteText = () => vi.fn().mockResolvedValue(undefined);

    const matrix: readonly ShareCapabilities[] = [
      {}, // both capabilities absent
      { clipboard: {} }, // partial-capability WebView
      { clipboard: { writeText: resolvingWriteText() } }, // clipboard-only happy path
      { clipboard: { writeText: vi.fn().mockRejectedValue(notAllowed()) } }, // clipboard-only rejection
      { share: vi.fn().mockResolvedValue(undefined) }, // share happy path
      { share: vi.fn().mockRejectedValue(abort()) }, // user dismissed
      { share: vi.fn().mockRejectedValue(notAllowed()) }, // non-abort, no fallback
      { share: vi.fn().mockRejectedValue("nope") }, // string rejection value
      { share: vi.fn().mockRejectedValue(undefined) }, // undefined rejection value
      {
        share: vi.fn((): Promise<void> => {
          throw notAllowed();
        }),
      }, // synchronous throw
      {
        share: vi.fn().mockRejectedValue(notAllowed()),
        clipboard: { writeText: resolvingWriteText() },
      }, // fallback succeeds
      {
        share: vi.fn().mockRejectedValue(notAllowed()),
        clipboard: { writeText: vi.fn().mockRejectedValue(notAllowed()) },
      }, // the Safari double-NotAllowedError path
    ];

    const members: readonly ShareOutcome[] = [
      "shared",
      "copied",
      "cancelled",
      "failed",
    ];
    for (const capabilities of matrix) {
      // A bare await: if any path rejected, this test itself would go red —
      // the await IS the never-rejects assertion.
      const outcome = await performShare(capabilities, url);
      expect(members).toContain(outcome);
    }
  });
});

describe("useShare hook — stateless useCallback binder (#130)", () => {
  const url = "https://example.test/AboutMeGame/";

  it("re-rendering with the same capabilities/url references keeps share referentially identical; a new url yields a new one", () => {
    // One stable capabilities object across re-renders — the documented caller
    // obligation (#131 memoizes or hoists it). The identity guarantee below is
    // conditional on exactly this.
    const capabilities: ShareCapabilities = {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    };

    const { result, rerender } = renderHook(
      ({ caps, href }: { caps: ShareCapabilities; href: string }) =>
        useShare(caps, href),
      { initialProps: { caps: capabilities, href: url } },
    );
    const first = result.current.share;

    // Same references → the useCallback keyed on [capabilities, url] must
    // hand back the very same function, so #131 can pass it to a memoized
    // button without busting its render.
    rerender({ caps: capabilities, href: url });
    expect(result.current.share).toBe(first);

    // A different url re-keys the binder: a stale closure over the old url
    // would share the wrong link, so the identity MUST change.
    rerender({ caps: capabilities, href: `${url}?v=2` });
    expect(result.current.share).not.toBe(first);
  });

  it("two concurrent share() invocations resolve independently — no re-entrancy latch, no shared state, no unhandled rejection", async () => {
    // A deferred fake: each call gets its own manually-settled promise, so
    // both invocations are genuinely in flight at the same time.
    const settlers: Array<{
      resolve: () => void;
      reject: (err: unknown) => void;
    }> = [];
    const share = vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          settlers.push({ resolve: () => resolve(), reject });
        }),
    );

    const { result } = renderHook(() => useShare({ share }, url));

    const p1 = result.current.share();
    const p2 = result.current.share();

    // No latch in the hook: both calls reached the capability. Double-tap
    // protection is #131's disabled-while-pending button, by design.
    expect(share).toHaveBeenCalledTimes(2);

    // Settle them differently and OUT OF ORDER: if the hook held any shared
    // outcome state, one call's result would leak into the other's.
    settlers[1].resolve();
    settlers[0].reject(
      Object.assign(new Error("gesture expired"), { name: "NotAllowedError" }),
    );

    // Both promises RESOLVE — p1's non-abort rejection with no clipboard
    // capability classifies to "failed", never a throw. Awaiting both is also
    // the unhandled-rejection guard: Vitest fails the run on a stray one.
    await expect(p2).resolves.toBe("shared");
    await expect(p1).resolves.toBe("failed");
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
