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

describe("discoveryStore bodyUnlocked is derived in set() (T4)", () => {
  const guess = {
    type: "guess" as const,
    prompt: "?",
    options: [
      { text: "a", correct: true },
      { text: "b", correct: false },
    ],
  };

  it("recomputes bodyUnlocked in set(): guess locked, then true once guessChoice is set", () => {
    const store = createDiscoveryStore(13);
    store.openPoi({ id: "poi-0", order: 0, title: "First", body: "...", interaction: guess });
    expect(store.getSnapshot().open?.bodyUnlocked).toBe(false);

    // Commit a choice by re-opening with a guessChoice set on the open — the
    // caller never writes bodyUnlocked; set() must derive it true because a
    // choice is committed. (Proves derivation, not a caller-written flag.)
    store.answerGuess(0);
    const open = store.getSnapshot().open;
    expect(open?.guessChoice).toBe(0);
    expect(open?.bodyUnlocked).toBe(true);
  });

  it("a plain open is always bodyUnlocked true", () => {
    const store = createDiscoveryStore(13);
    store.openPoi({ id: "poi-0", order: 0, title: "First", body: "...", interaction: { type: "plain" } });
    expect(store.getSnapshot().open?.bodyUnlocked).toBe(true);
  });

  it("a highlight open is always bodyUnlocked true", () => {
    const store = createDiscoveryStore(13);
    store.openPoi({
      id: "poi-0",
      order: 0,
      title: "First",
      body: "...",
      interaction: { type: "highlight", emphasis: "lede" },
    });
    expect(store.getSnapshot().open?.bodyUnlocked).toBe(true);
  });
});

describe("discoveryStore answerGuess records the committed index (T5)", () => {
  const guess = {
    type: "guess" as const,
    prompt: "?",
    options: [
      { text: "a", correct: false },
      { text: "b", correct: false },
      { text: "c", correct: true },
    ],
  };

  it("records the committed index and unlocks the body (AC2)", () => {
    const store = createDiscoveryStore(13);
    store.openPoi({ id: "poi-0", order: 0, title: "First", body: "...", interaction: guess });

    store.answerGuess(2);
    const open = store.getSnapshot().open;
    expect(open?.guessChoice).toBe(2);
    expect(open?.bodyUnlocked).toBe(true);
  });

  it("is a no-op on a non-guess open and keeps the snapshot reference stable (AC4)", () => {
    const store = createDiscoveryStore(13);
    store.openPoi({ id: "poi-0", order: 0, title: "First", body: "...", interaction: { type: "plain" } });
    const before = store.getSnapshot();

    expect(() => store.answerGuess(1)).not.toThrow();
    const after = store.getSnapshot();
    expect(Object.is(before, after)).toBe(true);
    expect(after.open?.guessChoice).toBeNull();
    expect(after.open?.bodyUnlocked).toBe(true);
  });

  it("is a no-op when nothing is open and keeps the snapshot reference stable (AC4)", () => {
    const store = createDiscoveryStore(13);
    const before = store.getSnapshot();

    expect(() => store.answerGuess(0)).not.toThrow();
    const after = store.getSnapshot();
    expect(Object.is(before, after)).toBe(true);
    expect(after.open).toBeNull();
  });
});

describe("discoveryStore per-open guess state resets structurally (T6, AC3)", () => {
  const guess = {
    type: "guess" as const,
    prompt: "?",
    options: [
      { text: "a", correct: true },
      { text: "b", correct: false },
    ],
  };

  it("resets on closePoi then re-open of the SAME id: guessChoice null, bodyUnlocked false", () => {
    const store = createDiscoveryStore(13);
    store.openPoi({ id: "poi-0", order: 0, title: "First", body: "...", interaction: guess });
    store.answerGuess(1);
    expect(store.getSnapshot().open?.guessChoice).toBe(1);
    expect(store.getSnapshot().open?.bodyUnlocked).toBe(true);

    store.closePoi();
    expect(store.getSnapshot().open).toBeNull();

    // Re-opening the SAME id yields a fresh OpenInfo — no leaked guess.
    store.openPoi({ id: "poi-0", order: 0, title: "First", body: "...", interaction: guess });
    const reopened = store.getSnapshot().open;
    expect(reopened?.guessChoice).toBeNull();
    expect(reopened?.bodyUnlocked).toBe(false);
  });

  it("resets when opening a DIFFERENT id after committing a guess: guessChoice null", () => {
    const store = createDiscoveryStore(13);
    store.openPoi({ id: "poi-0", order: 0, title: "First", body: "...", interaction: guess });
    store.answerGuess(0);
    expect(store.getSnapshot().open?.guessChoice).toBe(0);

    // Opening a different id (no closePoi between) must still yield a fresh open.
    store.openPoi({ id: "poi-1", order: 1, title: "Second", body: "...", interaction: guess });
    const open = store.getSnapshot().open;
    expect(open?.id).toBe("poi-1");
    expect(open?.guessChoice).toBeNull();
    expect(open?.bodyUnlocked).toBe(false);
  });

  it("does not leak guess state between two independent stores (no module-level state)", () => {
    const a = createDiscoveryStore(13);
    const b = createDiscoveryStore(13);

    a.openPoi({ id: "poi-0", order: 0, title: "First", body: "...", interaction: guess });
    a.answerGuess(1);
    expect(a.getSnapshot().open?.guessChoice).toBe(1);

    // The second store, opening the same id, is unaffected by the first.
    b.openPoi({ id: "poi-0", order: 0, title: "First", body: "...", interaction: guess });
    const bOpen = b.getSnapshot().open;
    expect(bOpen?.guessChoice).toBeNull();
    expect(bOpen?.bodyUnlocked).toBe(false);
    // And the first store still holds its own committed choice.
    expect(a.getSnapshot().open?.guessChoice).toBe(1);
  });
});
