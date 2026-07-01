// F1 slice 2 (#130) — the share-outcome contract and (in later tasks) the full
// behaviour matrix for the DI-injected useShare hook. Everything in here runs
// headless: capabilities are plain fakes, never a real navigator.

import { describe, expect, it, vi } from "vitest";
import { performShare, type ShareCapabilities, type ShareOutcome } from "./useShare.ts";

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
