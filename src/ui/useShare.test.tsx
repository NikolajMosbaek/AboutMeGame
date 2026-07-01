// F1 slice 2 (#130) — the share-outcome contract and (in later tasks) the full
// behaviour matrix for the DI-injected useShare hook. Everything in here runs
// headless: capabilities are plain fakes, never a real navigator.

import { describe, expect, it } from "vitest";
import type { ShareOutcome } from "./useShare.ts";

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
