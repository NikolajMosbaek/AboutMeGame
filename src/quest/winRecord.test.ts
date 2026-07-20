import { describe, expect, it } from "vitest";
import { createWinPersistence, type WinRecord } from "./winRecord.ts";

/** A minimal in-memory Storage double — enough of the Web Storage surface the
 *  persistence layer touches (getItem/setItem/removeItem). */
function memStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const WIN: WinRecord = {
  playSeconds: 754,
  cluesFound: 6,
  cluesTotal: 6,
  deaths: 2,
  fruitEaten: 9,
};

describe("winRecord persistence", () => {
  it("round-trips a saved win", () => {
    const store = memStorage();
    const p = createWinPersistence(store);
    expect(p.load()).toBeNull();
    p.save(WIN);
    expect(p.load()).toEqual(WIN);
  });

  it("clear() removes the win so a later load reads none", () => {
    const p = createWinPersistence(memStorage());
    p.save(WIN);
    p.clear();
    expect(p.load()).toBeNull();
  });

  it("degrades to a no-op (no throw, always null) when storage is absent", () => {
    const p = createWinPersistence(undefined);
    expect(() => p.save(WIN)).not.toThrow();
    expect(() => p.clear()).not.toThrow();
    expect(p.load()).toBeNull();
  });

  it("reads a corrupt / non-JSON blob as no win rather than throwing", () => {
    const store = memStorage();
    store.setItem("aboutmegame.win.v1", "{not json");
    expect(createWinPersistence(store).load()).toBeNull();
  });

  it("rejects a foreign / partial payload (missing or non-numeric fields)", () => {
    const store = memStorage();
    // A blob with the right key but the wrong shape must not read as a trophy.
    store.setItem("aboutmegame.win.v1", JSON.stringify({ playSeconds: "12:34" }));
    expect(createWinPersistence(store).load()).toBeNull();

    store.setItem(
      "aboutmegame.win.v1",
      JSON.stringify({ playSeconds: 10, cluesFound: 6, cluesTotal: 6, deaths: 1 }),
    ); // fruitEaten missing
    expect(createWinPersistence(store).load()).toBeNull();
  });

  it("clamps stored values to non-negative whole numbers on the way in and out", () => {
    const store = memStorage();
    const p = createWinPersistence(store);
    p.save({ playSeconds: 61.7, cluesFound: 6, cluesTotal: 6, deaths: -3, fruitEaten: 2.9 });
    expect(p.load()).toEqual({
      playSeconds: 61,
      cluesFound: 6,
      cluesTotal: 6,
      deaths: 0,
      fruitEaten: 2,
    });
  });
});
