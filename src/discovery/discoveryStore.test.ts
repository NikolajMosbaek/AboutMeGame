import { describe, expect, it } from "vitest";
import { createDiscoveryStore } from "./discoveryStore.ts";

describe("discoveryStore completed", () => {
  it("derives completed from discoveredCount === total && total > 0", () => {
    const store = createDiscoveryStore(13);

    store.setDiscovered([]);
    expect(store.getSnapshot().completed).toBe(false);

    const ids = (n: number) => Array.from({ length: n }, (_, i) => `poi-${i}`);

    store.setDiscovered(ids(12));
    expect(store.getSnapshot().completed).toBe(false);

    store.setDiscovered(ids(13));
    expect(store.getSnapshot().completed).toBe(true);
  });

  it("never reads an empty store (total 0) as instantly complete", () => {
    const store = createDiscoveryStore(0);
    store.setDiscovered([]);
    expect(store.getSnapshot().completed).toBe(false);
  });

  it("keeps completed===true through openPoi/setNearby after 13/13 (no stale)", () => {
    const store = createDiscoveryStore(13);
    const ids = Array.from({ length: 13 }, (_, i) => `poi-${i}`);
    store.setDiscovered(ids);
    expect(store.getSnapshot().completed).toBe(true);

    store.openPoi({ id: "poi-0", order: 0, title: "First", body: "..." });
    expect(store.getSnapshot().completed).toBe(true);

    store.setNearby({
      id: "poi-1",
      order: 1,
      title: "Second",
      teaser: "...",
      inRange: true,
    });
    expect(store.getSnapshot().completed).toBe(true);
  });
});

describe("discoveryStore openPoi interaction default", () => {
  it("defaults open.interaction to {type:'plain'} when input omits interaction", () => {
    const store = createDiscoveryStore(13);
    // OpenPoiInput.interaction is optional; the snapshot OpenInfo.interaction
    // is always present.
    store.openPoi({ id: "poi-0", order: 0, title: "First", body: "..." });
    const open = store.getSnapshot().open;
    expect(open).not.toBeNull();
    expect(open?.interaction).toEqual({ type: "plain" });
  });
});

describe("discoveryStore openPoi per-open guess state", () => {
  it("opens a guess locked: guessChoice null, bodyUnlocked false (AC2)", () => {
    const store = createDiscoveryStore(13);
    store.openPoi({
      id: "poi-0",
      order: 0,
      title: "First",
      body: "...",
      interaction: {
        type: "guess",
        prompt: "?",
        options: [
          { text: "a", correct: true },
          { text: "b", correct: false },
        ],
      },
    });
    const open = store.getSnapshot().open;
    expect(open?.guessChoice).toBeNull();
    expect(open?.bodyUnlocked).toBe(false);
  });

  it("opens a plain interaction unlocked: bodyUnlocked true, guessChoice null (AC2)", () => {
    const store = createDiscoveryStore(13);
    store.openPoi({
      id: "poi-0",
      order: 0,
      title: "First",
      body: "...",
      interaction: { type: "plain" },
    });
    const open = store.getSnapshot().open;
    expect(open?.bodyUnlocked).toBe(true);
    expect(open?.guessChoice).toBeNull();
  });

  it("opens a highlight interaction unlocked: bodyUnlocked true, guessChoice null (AC2)", () => {
    const store = createDiscoveryStore(13);
    store.openPoi({
      id: "poi-0",
      order: 0,
      title: "First",
      body: "...",
      interaction: { type: "highlight", emphasis: "lede" },
    });
    const open = store.getSnapshot().open;
    expect(open?.bodyUnlocked).toBe(true);
    expect(open?.guessChoice).toBeNull();
  });
});
