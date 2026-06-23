import { describe, expect, it } from "vitest";
import {
  buildJournalEntries,
  journalCanOpen,
  type JournalPoi,
} from "./journalEntries.ts";

// A position-free `journalPois` projection fixture (no THREE import): the same
// shape `buildGame` produces by dropping `position` from a DiscoverablePoi.
const POIS: JournalPoi[] = [
  { id: "b", order: 2, title: "Beta", teaser: "second", body: "b-body", color: 0x00ff00 },
  { id: "a", order: 1, title: "Alpha", teaser: "first", body: "a-body", color: 0xff0000 },
  { id: "c", order: 3, title: "Gamma", teaser: "third", body: "c-body", color: 0x0000ff },
];

describe("buildJournalEntries", () => {
  it("sorts rows by order regardless of input order", () => {
    const rows = buildJournalEntries(POIS, []);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(rows.map((r) => r.order)).toEqual([1, 2, 3]);
  });

  it("marks discovered rows unlocked with title + teaser", () => {
    const rows = buildJournalEntries(POIS, ["a", "c"]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    expect(byId.a.locked).toBe(false);
    expect(byId.c.locked).toBe(false);
    if (!byId.a.locked) {
      expect(byId.a.title).toBe("Alpha");
      expect(byId.a.teaser).toBe("first");
    }
  });

  it("locked rows carry only id/order/color and color matches the poi", () => {
    const rows = buildJournalEntries(POIS, []);
    const locked = rows.find((r) => r.id === "b")!;
    expect(locked.locked).toBe(true);
    expect(locked.order).toBe(2);
    expect(locked.color).toBe(0x00ff00);
  });

  it("undiscovered content is STRUCTURALLY absent (not empty strings)", () => {
    const [lockedRow] = buildJournalEntries(POIS, []);
    expect("title" in lockedRow).toBe(false);
    expect("teaser" in lockedRow).toBe(false);
    expect("body" in lockedRow).toBe(false);
  });

  it("never exposes the body on an unlocked row either (reveal-only)", () => {
    const rows = buildJournalEntries(POIS, ["a"]);
    const unlocked = rows.find((r) => r.id === "a")!;
    expect("body" in unlocked).toBe(false);
  });

  it("handles the empty-pois edge", () => {
    expect(buildJournalEntries([], [])).toEqual([]);
    expect(buildJournalEntries([], ["a"])).toEqual([]);
  });

  it("handles the all-discovered edge — every row unlocked", () => {
    const rows = buildJournalEntries(POIS, ["a", "b", "c"]);
    expect(rows.every((r) => !r.locked)).toBe(true);
  });

  it("handles duplicate-order rows deterministically (tie-break on id)", () => {
    const dup: JournalPoi[] = [
      { id: "y", order: 1, title: "Y", teaser: "ty", body: "by", color: 1 },
      { id: "x", order: 1, title: "X", teaser: "tx", body: "bx", color: 2 },
    ];
    const rows = buildJournalEntries(dup, []);
    expect(rows.map((r) => r.id)).toEqual(["x", "y"]);
  });

  it("ignores discoveredIds that are not in the poi set", () => {
    const rows = buildJournalEntries(POIS, ["ghost"]);
    expect(rows.every((r) => r.locked)).toBe(true);
  });
});

describe("journalCanOpen", () => {
  it("is true only for ids present in discoveredIds", () => {
    expect(journalCanOpen("a", ["a", "b"])).toBe(true);
    expect(journalCanOpen("c", ["a", "b"])).toBe(false);
    expect(journalCanOpen("a", [])).toBe(false);
  });
});
