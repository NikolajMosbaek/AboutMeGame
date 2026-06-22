import { describe, expect, it, vi } from "vitest";
import { createHudStore } from "./hudStore.ts";

describe("hudStore", () => {
  it("starts in drive mode at rest", () => {
    const store = createHudStore();
    expect(store.getSnapshot()).toEqual({ mode: "drive", speed: 0, altitude: 0 });
  });

  it("returns a stable snapshot reference while nothing changes", () => {
    const store = createHudStore();
    const first = store.getSnapshot();
    store.set({ mode: "drive", speed: 0, altitude: 0 });
    expect(store.getSnapshot()).toBe(first);
  });

  it("rounds speed/altitude to integers and only emits on a real change", () => {
    const store = createHudStore();
    const listener = vi.fn();
    store.subscribe(listener);

    // 12.4 and 12.6 round to 12 and 13 respectively.
    store.set({ mode: "drive", speed: 12.4, altitude: 0 });
    expect(store.getSnapshot().speed).toBe(12);
    expect(listener).toHaveBeenCalledTimes(1);

    // Same rounded value → no new snapshot, no emit (throttles per-frame churn).
    const before = store.getSnapshot();
    store.set({ mode: "drive", speed: 12.49, altitude: 0 });
    expect(store.getSnapshot()).toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);

    // A rounded change emits once.
    store.set({ mode: "drive", speed: 12.6, altitude: 0 });
    expect(store.getSnapshot().speed).toBe(13);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("emits when the mode changes", () => {
    const store = createHudStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ mode: "fly", speed: 0, altitude: 40 });
    expect(store.getSnapshot()).toEqual({ mode: "fly", speed: 0, altitude: 40 });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("stops notifying after unsubscribe", () => {
    const store = createHudStore();
    const listener = vi.fn();
    const unsub = store.subscribe(listener);
    unsub();
    store.set({ mode: "fly", speed: 5, altitude: 1 });
    expect(listener).not.toHaveBeenCalled();
  });
});
