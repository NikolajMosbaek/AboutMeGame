import { describe, expect, it, vi } from "vitest";
import { createDangerStore, DangerSystem } from "./dangerWarning.ts";
import { FRAME } from "../player/testDoubles.ts";

describe("dangerStore", () => {
  it("starts clear and only emits on a real change", () => {
    const store = createDangerStore();
    expect(store.getSnapshot()).toEqual({ snake: false, predator: false });

    const listener = vi.fn();
    store.subscribe(listener);
    store.set({ snake: false, predator: false }); // no change → no emit
    expect(listener).not.toHaveBeenCalled();

    const before = store.getSnapshot();
    store.set({ snake: true, predator: false });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).not.toBe(before);

    store.set({ snake: true, predator: false }); // same again → no emit
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("DangerSystem", () => {
  it("mirrors the wildlife threat posture into the store each frame", () => {
    const store = createDangerStore();
    let snakeAlert = false;
    let jaguarStalk = false;
    const sys = new DangerSystem(
      { anyAlert: () => snakeAlert },
      { isStalking: () => jaguarStalk },
      store,
    );

    sys.update(FRAME);
    expect(store.getSnapshot()).toEqual({ snake: false, predator: false });

    snakeAlert = true;
    sys.update(FRAME);
    expect(store.getSnapshot()).toEqual({ snake: true, predator: false });

    snakeAlert = false;
    jaguarStalk = true;
    sys.update(FRAME);
    expect(store.getSnapshot()).toEqual({ snake: false, predator: true });
  });
});
