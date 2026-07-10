import { describe, expect, it, vi } from "vitest";
import { createQuestStore, type QuestSnapshot } from "./questStore.ts";

function snap(over: Partial<QuestSnapshot> = {}): QuestSnapshot {
  return {
    cluesFound: 0,
    cluesTotal: 6,
    digOwnsKey: false,
    missingPages: 0,
    digProgress: null,
    finaleActive: false,
    treasureFound: false,
    playSeconds: 0,
    deaths: 0,
    fruitEaten: 0,
    ...over,
  };
}

describe("questStore — snapshot contract", () => {
  it("starts with no missing pages and no finale", () => {
    const store = createQuestStore(6);
    const s = store.getSnapshot();
    expect(s.missingPages).toBe(0);
    expect(s.finaleActive).toBe(false);
  });

  it("notifies on a missingPages change (the dig-locked hint's signal)", () => {
    const store = createQuestStore(6);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(snap({ missingPages: 3 }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().missingPages).toBe(3);
    // Same value again ⇒ no re-notify (snapshot re-allocates only on change).
    store.set(snap({ missingPages: 3 }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies on a finaleActive flip (the spectacle's signal)", () => {
    const store = createQuestStore(6);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(snap({ finaleActive: true }));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().finaleActive).toBe(true);
    store.set(snap({ finaleActive: true }));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
