// Headless tests for the text-view selector seam (epic #128, slice 1).
//
// splitBodySegments is the single segmentation implementation the TextView
// rendering (#144) and, later, RevealPanel share — so the 3D path and the
// no-WebGL path never diverge on what is emphasized. The load-bearing
// invariant, asserted in every case: the concatenation of segment texts
// equals the original body byte-for-byte, with at most one emphasized
// segment. No WebGL, no DOM — pure functions in, plain data out.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { splitBodySegments, type BodySegment } from "./textViewModel.ts";

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
