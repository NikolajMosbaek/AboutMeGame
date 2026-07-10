import { describe, expect, it, vi } from "vitest";
import { compassWithHysteresis, createHudStore } from "./hudStore.ts";

describe("hudStore", () => {
  it("starts at rest, facing north, not sprinting", () => {
    const store = createHudStore();
    expect(store.getSnapshot()).toEqual({ speed: 0, sprinting: false, heading: 0, compass: "N" });
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
    expect(store.getSnapshot()).toEqual({ speed: 0, sprinting: true, heading: 270, compass: "W" });
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

describe("compassWithHysteresis (the no-flicker contract)", () => {
  it("holds the current point within the margin past a boundary", () => {
    // N/NE boundary is 22.5°: at 28° (5.5° past) N must STILL show…
    expect(compassWithHysteresis(28, "N")).toBe("N");
    // …and NE, once shown, holds back across the same zone.
    expect(compassWithHysteresis(18, "NE")).toBe("NE");
  });

  it("flips once clearly past the boundary, and snaps exactly on big turns", () => {
    expect(compassWithHysteresis(32, "N")).toBe("NE"); // 9.5° past — flips
    expect(compassWithHysteresis(180, "N")).toBe("S"); // half turn — exact
    expect(compassWithHysteresis(271, "S")).toBe("W");
  });

  it("is stable under per-frame jitter straddling a boundary", () => {
    let point: import("./hudStore.ts").CompassPoint = "N";
    for (const h of [21, 24, 22, 25, 23, 21, 26]) {
      point = compassWithHysteresis(h, point);
    }
    expect(point).toBe("N"); // never flickered
  });

  it("handles the 359↔0 wrap without escaping north", () => {
    expect(compassWithHysteresis(355, "N")).toBe("N");
    expect(compassWithHysteresis(2, "N")).toBe("N");
    expect(compassWithHysteresis(326, "N")).toBe("NW"); // 34° out — clearly past margin
  });
});
