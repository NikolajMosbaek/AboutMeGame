import { describe, expect, it } from "vitest";
import { announcementFor } from "./discoveryAnnounce.ts";
import type { DiscoverySnapshot } from "../discovery/discoveryStore.ts";

/** Build a snapshot with just the fields the announcer reads. */
function snap(over: Partial<DiscoverySnapshot> = {}): DiscoverySnapshot {
  return {
    nearby: null,
    open: null,
    discoveredIds: [],
    discoveredCount: 0,
    total: 13,
    completed: false,
    ...over,
  };
}

describe("announcementFor", () => {
  it("announces the freshly-opened landmark with its progress count", () => {
    const prev = snap({ discoveredCount: 2, discoveredIds: ["a", "b"] });
    const next = snap({
      discoveredCount: 3,
      discoveredIds: ["a", "b", "c"],
      open: {
        id: "c",
        order: 5,
        title: "Root-Cause Quarry",
        body: "…",
        interaction: { type: "plain" },
        guessChoice: null,
        bodyUnlocked: true,
      },
    });
    expect(announcementFor(prev, next)).toBe("Found Root-Cause Quarry — page 3 of 13");
  });

  it("says nothing when the discovered count is unchanged", () => {
    const prev = snap({ discoveredCount: 3, discoveredIds: ["a", "b", "c"] });
    // Re-opening an already-discovered landmark must not re-announce.
    const next = snap({
      discoveredCount: 3,
      discoveredIds: ["a", "b", "c"],
      open: {
        id: "a",
        order: 1,
        title: "Arrivals Gate",
        body: "…",
        interaction: { type: "plain" },
        guessChoice: null,
        bodyUnlocked: true,
      },
    });
    expect(announcementFor(prev, next)).toBeNull();
  });

  it("says nothing when nothing is open even if the count somehow grew", () => {
    const prev = snap({ discoveredCount: 0 });
    const next = snap({ discoveredCount: 1, discoveredIds: ["a"], open: null });
    expect(announcementFor(prev, next)).toBeNull();
  });

  it("says nothing on the very first (initial) snapshot", () => {
    // Loading saved progress sets discoveredCount > 0 with no prior snapshot;
    // a null prev must not blurt out a stale count on mount.
    const next = snap({ discoveredCount: 4, discoveredIds: ["a", "b", "c", "d"] });
    expect(announcementFor(null, next)).toBeNull();
  });
});
