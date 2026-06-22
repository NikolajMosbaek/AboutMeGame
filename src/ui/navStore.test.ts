import { describe, expect, it, vi } from "vitest";
import { createNavStore, type NavMarker } from "./navStore.ts";

const marker = (over: Partial<NavMarker> = {}): NavMarker => ({
  id: "a",
  color: 0xffffff,
  label: "10 m",
  onScreen: true,
  x: 50,
  y: 50,
  edgeAngle: 0,
  ...over,
});

describe("navStore snapshot stability", () => {
  it("keeps the same snapshot reference and does not emit on a layout-equivalent set", () => {
    const store = createNavStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.set([marker()]);
    const first = store.getSnapshot();
    expect(listener).toHaveBeenCalledTimes(1);

    // A new array with identical rounded fields must be a no-op (no churn).
    store.set([marker()]);
    expect(store.getSnapshot()).toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("emits a new snapshot when the layout actually changes", () => {
    const store = createNavStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.set([marker({ x: 50 })]);
    const first = store.getSnapshot();
    store.set([marker({ x: 60 })]); // moved
    expect(store.getSnapshot()).not.toBe(first);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("emits when markers appear or disappear", () => {
    const store = createNavStore();
    store.set([marker()]);
    const one = store.getSnapshot();
    store.set([]); // POI discovered → marker gone
    expect(store.getSnapshot()).not.toBe(one);
    expect(store.getSnapshot().markers).toHaveLength(0);
  });
});
