// Headless tests for the text-view selector seam (epic #128, slice 1).
//
// splitBodySegments is the single segmentation implementation the TextView
// rendering (#144) and, later, RevealPanel share — so the 3D path and the
// no-WebGL path never diverge on what is emphasized. The load-bearing
// invariant, asserted in every case: the concatenation of segment texts
// equals the original body byte-for-byte, with at most one emphasized
// segment. No WebGL, no DOM — pure functions in, plain data out.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTextViewModel,
  splitBodySegments,
  type BodySegment,
  type TextViewRow,
} from "./textViewModel.ts";
import {
  loadContent,
  type ContentSet,
  type PoiContent,
} from "../content/contentModel.ts";

/** The lossless invariant: no split may ever gain or lose body text. */
function expectConcatEquals(segments: BodySegment[], body: string): void {
  expect(segments.map((s) => s.text).join("")).toBe(body);
}

describe("splitBodySegments", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("splits before/emphasis/after with only the middle segment emphasized", () => {
    const body = "aaa BBB ccc";
    const segments = splitBodySegments(body, "BBB");
    expect(segments).toEqual([
      { text: "aaa ", emphasized: false },
      { text: "BBB", emphasized: true },
      { text: " ccc", emphasized: false },
    ]);
    expectConcatEquals(segments, body);
    expect(warn).not.toHaveBeenCalled();
  });

  it("drops the zero-length before-segment when emphasis starts the body", () => {
    const body = "BBB ccc";
    const segments = splitBodySegments(body, "BBB");
    expect(segments).toEqual([
      { text: "BBB", emphasized: true },
      { text: " ccc", emphasized: false },
    ]);
    expectConcatEquals(segments, body);
  });

  it("drops the zero-length after-segment when emphasis ends the body", () => {
    const body = "aaa BBB";
    const segments = splitBodySegments(body, "BBB");
    expect(segments).toEqual([
      { text: "aaa ", emphasized: false },
      { text: "BBB", emphasized: true },
    ]);
    expectConcatEquals(segments, body);
  });

  it("yields one fully-emphasized segment when emphasis equals the body", () => {
    const body = "BBB";
    const segments = splitBodySegments(body, "BBB");
    expect(segments).toEqual([{ text: "BBB", emphasized: true }]);
    expectConcatEquals(segments, body);
  });

  it("splits on the FIRST occurrence only when emphasis repeats", () => {
    const body = "BBB aaa BBB";
    const segments = splitBodySegments(body, "BBB");
    expect(segments).toEqual([
      { text: "BBB", emphasized: true },
      { text: " aaa BBB", emphasized: false },
    ]);
    expectConcatEquals(segments, body);
    expect(segments.filter((s) => s.emphasized)).toHaveLength(1);
  });

  it("warns exactly once when a non-empty emphasis shares nothing with the body", () => {
    const segments = splitBodySegments("abc", "zzz");
    expect(segments).toEqual([{ text: "abc", emphasized: false }]);
    expectConcatEquals(segments, "abc");
    expect(warn).toHaveBeenCalledTimes(1);
    // Mirrors parseInteraction's coerce convention (contentModel.ts): a
    // "content:"-prefixed dev-time warn, visible but never fatal.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("content:"));
  });

  it("takes the empty-string fallback with zero warn calls", () => {
    const segments = splitBodySegments("abc", "");
    expect(segments).toEqual([{ text: "abc", emphasized: false }]);
    expectConcatEquals(segments, "abc");
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back to one unemphasized full-body segment WITH a warn when a non-empty emphasis is not found verbatim", () => {
    const body = "aaa BBB ccc";
    // Case differs — no trimming, case folding, or normalization: verbatim or fallback.
    const segments = splitBodySegments(body, "bbb");
    expect(segments).toEqual([{ text: body, emphasized: false }]);
    expectConcatEquals(segments, body);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("falls back silently on undefined emphasis (contract edge, not authoring drift)", () => {
    const body = "aaa BBB ccc";
    const segments = splitBodySegments(body);
    expect(segments).toEqual([{ text: body, emphasized: false }]);
    expectConcatEquals(segments, body);
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back silently on empty-string emphasis instead of the degenerate indexOf===0 split", () => {
    const body = "aaa BBB ccc";
    const segments = splitBodySegments(body, "");
    expect(segments).toEqual([{ text: body, emphasized: false }]);
    expectConcatEquals(segments, body);
    expect(warn).not.toHaveBeenCalled();
  });
});

/** Synthetic POI with valid defaults; tests override only what they exercise. */
function makePoi(overrides: Partial<PoiContent> & Pick<PoiContent, "id" | "order">): PoiContent {
  return {
    title: `Title of ${overrides.id}`,
    teaser: `Teaser of ${overrides.id}`,
    body: `Body of ${overrides.id}`,
    tags: [],
    interaction: { type: "plain" },
    ...overrides,
  };
}

function makeContent(pois: PoiContent[]): ContentSet {
  return { schemaVersion: "test", contentSet: "synthetic", voice: "test", pois };
}

/** A structurally valid guess interaction; `answerReveal` only when passed. */
function guessInteraction(answerReveal?: string): PoiContent["interaction"] {
  const base = {
    type: "guess" as const,
    prompt: "Which?",
    options: [
      { text: "Right", correct: true },
      { text: "Wrong", correct: false },
    ],
  };
  return answerReveal === undefined ? base : { ...base, answerReveal };
}

describe("buildTextViewModel", () => {
  it("returns rows sorted ascending by order and never mutates the injected ContentSet", () => {
    const content = makeContent([
      makePoi({ id: "poi-c", order: 3 }),
      makePoi({ id: "poi-a", order: 1, tags: ["planning", "verification"] }),
      makePoi({ id: "poi-b", order: 2 }),
    ]);
    const snapshot = structuredClone(content);

    const rows = buildTextViewModel(content);

    expect(rows.map((r) => r.id)).toEqual(["poi-a", "poi-b", "poi-c"]);
    expect(rows.map((r) => r.order)).toEqual([1, 2, 3]);
    // Full row shape for one POI: every field crosses, nothing extra rides along.
    expect(rows[0]).toEqual({
      id: "poi-a",
      order: 1,
      title: "Title of poi-a",
      teaser: "Teaser of poi-a",
      tags: ["planning", "verification"],
      bodySegments: [{ text: "Body of poi-a", emphasized: false }],
    });
    // The injected ContentSet is untouched — deep-equal to its pre-call
    // snapshot, and the pois array keeps its authored (unsorted) order.
    expect(content).toEqual(snapshot);
    expect(content.pois.map((p) => p.id)).toEqual(["poi-c", "poi-a", "poi-b"]);
  });

  it("keeps equal-order POIs in input order (stable-sort determinism)", () => {
    const content = makeContent([
      makePoi({ id: "poi-late", order: 2 }),
      makePoi({ id: "poi-tie-first", order: 1 }),
      makePoi({ id: "poi-tie-second", order: 1 }),
    ]);
    expect(buildTextViewModel(content).map((r) => r.id)).toEqual([
      "poi-tie-first",
      "poi-tie-second",
      "poi-late",
    ]);
  });

  it("omits the answerReveal key entirely on a guess without one", () => {
    const content = makeContent([
      makePoi({ id: "poi-guess-bare", order: 1, interaction: guessInteraction() }),
    ]);
    const [row] = buildTextViewModel(content);
    expect("answerReveal" in row).toBe(false);
    expect(row.answerReveal).toBeUndefined();
  });

  it("copies answerReveal onto the row when the guess interaction carries it", () => {
    const content = makeContent([
      makePoi({
        id: "poi-guess-reveal",
        order: 1,
        interaction: guessInteraction("The takeaway."),
      }),
    ]);
    const [row] = buildTextViewModel(content);
    expect(row.answerReveal).toBe("The takeaway.");
  });

  it("maps plain and guess bodies to one unemphasized segment and highlight bodies through splitBodySegments", () => {
    const content = makeContent([
      makePoi({ id: "poi-plain", order: 1, body: "plain body" }),
      makePoi({ id: "poi-guess", order: 2, body: "guess body", interaction: guessInteraction() }),
      makePoi({
        id: "poi-highlight",
        order: 3,
        body: "aaa BBB ccc",
        interaction: { type: "highlight", emphasis: "BBB" },
      }),
    ]);

    const [plain, guess, highlight] = buildTextViewModel(content);

    expect(plain.bodySegments).toEqual([{ text: "plain body", emphasized: false }]);
    expect(guess.bodySegments).toEqual([{ text: "guess body", emphasized: false }]);
    // ONE segmentation implementation: the highlight row matches the exported
    // splitter byte-for-byte, so no surface can drift on what is emphasized.
    expect(highlight.bodySegments).toEqual(splitBodySegments("aaa BBB ccc", "BBB"));
    expect(highlight.bodySegments.filter((s) => s.emphasized)).toEqual([
      { text: "BBB", emphasized: true },
    ]);
    for (const row of [plain, guess, highlight]) {
      expectConcatEquals(row.bodySegments, content.pois.find((p) => p.id === row.id)!.body);
    }
  });
});

// ── Real-dataset acceptance tier ──
//
// The synthetic fixtures above pin every branch; these cases run the selector
// over the actual `loadContent()` dataset so the named acceptance POIs and
// the authored copy itself stay honest. Assertions are structural — derived
// from the loaded POI, never hard-coded prose — except poi-arrivals-gate's
// teaser, which is pinned verbatim because nothing renders it until #144.

/** Dataset lookup that fails loudly if a named POI ever disappears. */
function poiById(content: ContentSet, id: string): PoiContent {
  const poi = content.pois.find((p) => p.id === id);
  if (poi === undefined) throw new Error(`dataset has no POI "${id}"`);
  return poi;
}

function rowById(rows: TextViewRow[], id: string): TextViewRow {
  const row = rows.find((r) => r.id === id);
  if (row === undefined) throw new Error(`no row for POI "${id}"`);
  return row;
}


describe("buildTextViewModel(loadContent()) — real-dataset acceptance", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let content: ContentSet;
  let rows: TextViewRow[];

  beforeEach(() => {
    // The spy is installed BEFORE the build, so an authored emphasis that no
    // longer matches its body surfaces as a warn call in the canary below.
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    content = loadContent();
    rows = buildTextViewModel(content);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("maps every clue to one unemphasized full-body segment (plain readable pages)", () => {
    for (const row of rows) {
      const poi = poiById(content, row.id);
      expect(row.bodySegments).toEqual([{ text: poi.body, emphasized: false }]);
      expect("answerReveal" in row).toBe(false);
    }
  });

  it("keeps the camp clue's teaser wired end-to-end", () => {
    const poi = poiById(content, "site-base-camp");
    const row = rowById(rows, "site-base-camp");
    expect(row.teaser).toBe(poi.teaser);
    expect(row.teaser.length).toBeGreaterThan(0);
  });

  it("holds the lossless invariant across all 6 clues, one row each, ascending by order", () => {
    expect(content.pois).toHaveLength(6);
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((r) => r.id)).size).toBe(6);
    expect(rows.map((r) => r.order)).toEqual(
      content.pois.map((p) => p.order).sort((a, b) => a - b),
    );
    for (const row of rows) {
      expectConcatEquals(row.bodySegments, poiById(content, row.id).body);
      expect(row.bodySegments.filter((s) => s.emphasized).length).toBeLessThanOrEqual(1);
    }
  });
});
