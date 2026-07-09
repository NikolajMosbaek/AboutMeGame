import { describe, expect, it, vi } from "vitest";
import { createHudStore } from "./hudStore.ts";

describe("hudStore", () => {
  it("starts at rest, facing north, not sprinting", () => {
    const store = createHudStore();
    expect(store.getSnapshot()).toEqual({ speed: 0, sprinting: false, heading: 0 });
  });

  it("returns a stable snapshot reference while nothing changes", () => {
    const store = createHudStore();
    const first = store.getSnapshot();
    store.set({ speed: 0, sprinting: false, heading: 0 });
    expect(store.getSnapshot()).toBe(first);
  });

  it("rounds speed to integers and only emits on a real change", () => {
    const store = createHudStore();
    const listener = vi.fn();
    store.subscribe(listener);

    // 12.4 and 12.6 round to 12 and 13 respectively.
    store.set({ speed: 12.4, sprinting: false, heading: 0 });
    expect(store.getSnapshot().speed).toBe(12);
    expect(listener).toHaveBeenCalledTimes(1);

    // Same rounded value → no new snapshot, no emit (throttles per-frame churn).
    const before = store.getSnapshot();
    store.set({ speed: 12.49, sprinting: false, heading: 0 });
    expect(store.getSnapshot()).toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);

    // A rounded change emits once.
    store.set({ speed: 12.6, sprinting: false, heading: 0 });
    expect(store.getSnapshot().speed).toBe(13);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("emits when sprint flips, and normalises heading into 0..359", () => {
    const store = createHudStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ speed: 0, sprinting: true, heading: -90 });
    expect(store.getSnapshot()).toEqual({ speed: 0, sprinting: true, heading: 270 });
    expect(listener).toHaveBeenCalledOnce();
    // 450 normalises to the same 90… 
    store.set({ speed: 0, sprinting: true, heading: 450 });
    expect(store.getSnapshot().heading).toBe(90);
  });

  it("stops notifying after unsubscribe", () => {
    const store = createHudStore();
    const listener = vi.fn();
    const unsub = store.subscribe(listener);
    unsub();
    store.set({ speed: 5, sprinting: true, heading: 10 });
    expect(listener).not.toHaveBeenCalled();
  });
});
