import { describe, expect, it } from "vitest";
import { nextUndiscovered } from "./nextUndiscovered.ts";

/**
 * Headless unit tests (no WebGL) for the cyclic-successor selector that names
 * the next-by-order undiscovered POI behind the in-panel "Next: <title> →".
 * Input is the minimal `{ id; order; title }` projection.
 */
const POIS = [
  { id: "p1", order: 1, title: "One" },
  { id: "p2", order: 2, title: "Two" },
  { id: "p3", order: 3, title: "Three" },
  { id: "p4", order: 4, title: "Four" },
  { id: "p5", order: 5, title: "Five" },
];

describe("nextUndiscovered", () => {
  it("mid-journey: returns the first undiscovered POI with order > current", () => {
    // current=3 open; nothing else discovered -> next is 4.
    const result = nextUndiscovered(POIS, ["p3"], "p3", 3);
    expect(result).toEqual({ id: "p4", order: 4, title: "Four" });
  });

  it("just-after-current: skips discovered and returns the next contiguous undiscovered", () => {
    // current=2 open, 3 already discovered -> next undiscovered is 4.
    const result = nextUndiscovered(POIS, ["p2", "p3"], "p2", 2);
    expect(result).toEqual({ id: "p4", order: 4, title: "Four" });
  });

  it("wrap: when current is the highest order, wraps to the lowest-order remaining", () => {
    // current=5 open (highest); 4 discovered -> wrap to lowest remaining (p1).
    const result = nextUndiscovered(POIS, ["p4", "p5"], "p5", 5);
    expect(result).toEqual({ id: "p1", order: 1, title: "One" });
  });

  it("all-discovered: returns null when no other undiscovered POI remains", () => {
    const result = nextUndiscovered(
      POIS,
      ["p1", "p2", "p3", "p4", "p5"],
      "p3",
      3,
    );
    expect(result).toBeNull();
  });

  it("load-bearing: excludes currentId independently even when already in discoveredIds", () => {
    // The runtime state while the panel is open: the current id is ALREADY in
    // discoveredIds. The selector must still exclude it independently and
    // return the next-by-order undiscovered POI, not null.
    const result = nextUndiscovered(POIS, ["p3"], "p3", 3);
    expect(result).toEqual({ id: "p4", order: 4, title: "Four" });
  });

  it("sorts ascending by order defensively, with id tiebreak, ignoring array order", () => {
    const shuffled = [
      { id: "p4", order: 4, title: "Four" },
      { id: "p1", order: 1, title: "One" },
      { id: "p3", order: 3, title: "Three" },
      { id: "p2", order: 2, title: "Two" },
    ];
    const result = nextUndiscovered(shuffled, ["p1"], "p1", 1);
    expect(result).toEqual({ id: "p2", order: 2, title: "Two" });
  });

  it("wraps to the lowest remaining when current is highest and others are undiscovered", () => {
    const result = nextUndiscovered(POIS, ["p5"], "p5", 5);
    expect(result).toEqual({ id: "p1", order: 1, title: "One" });
  });
});
