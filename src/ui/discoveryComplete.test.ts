import { describe, expect, it } from "vitest";

import type { DiscoverySnapshot } from "../discovery/discoveryStore.ts";
import { completionFor } from "./discoveryComplete.ts";

// Minimal snapshot factory — only the fields the edge function reads matter.
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

describe("completionFor", () => {
  it("returns false on the initial mount (null prev)", () => {
    expect(completionFor(null, snap({ completed: true }))).toBe(false);
  });

  it("fires on the rising edge of completed (false -> true)", () => {
    expect(
      completionFor(snap({ completed: false }), snap({ completed: true })),
    ).toBe(true);
  });

  it("does not double-fire when already completed (true -> true)", () => {
    expect(
      completionFor(snap({ completed: true }), snap({ completed: true })),
    ).toBe(false);
  });

  it("does not fire on a reload at 13/13 (first callback seeded completed:true)", () => {
    // A reload seeds prev from getSnapshot() — already completed — so the very
    // first prev->next pair must NOT fire the panel for stale saved progress.
    expect(
      completionFor(snap({ completed: true }), snap({ completed: true })),
    ).toBe(false);
  });

  it("does not fire when still incomplete (false -> false)", () => {
    expect(
      completionFor(snap({ completed: false }), snap({ completed: false })),
    ).toBe(false);
  });
});
