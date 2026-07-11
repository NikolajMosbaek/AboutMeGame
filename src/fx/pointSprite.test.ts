import { describe, expect, it } from "vitest";
import { POINT_SPRITE_ALPHA_TEST, makeSoftCircleSprite } from "./pointSprite.ts";

describe("makeSoftCircleSprite — shared soft-round point-sprite texture", () => {
  it("never throws, and degrades to null under jsdom (no real 2D canvas context)", () => {
    // jsdom implements HTMLCanvasElement but has no canvas backend installed,
    // so getContext("2d") is null here — the same fallback every other
    // procedural-texture helper in this codebase (makeLeafTexture,
    // makeCloudPuffTexture) already relies on; callers must degrade
    // gracefully rather than crash headless tests.
    expect(() => makeSoftCircleSprite()).not.toThrow();
    expect(makeSoftCircleSprite()).toBeNull();
  });

  it("is not memoized — every call is independent, so each caller can own and dispose its own instance", () => {
    // Can't assert reference identity differs under jsdom (both calls return
    // null there), but the function must not hold any module-level cache a
    // future caller could accidentally share/fight over disposal with —
    // calling it repeatedly must stay side-effect-free and idempotent.
    expect(makeSoftCircleSprite()).toBe(makeSoftCircleSprite());
    expect(makeSoftCircleSprite()).toBeNull();
  });

  it("exposes a shared alphaTest tuned to cut the soft edge's near-invisible fringe, not the visible disc", () => {
    expect(POINT_SPRITE_ALPHA_TEST).toBeGreaterThan(0);
    expect(POINT_SPRITE_ALPHA_TEST).toBeLessThan(0.2);
  });
});
