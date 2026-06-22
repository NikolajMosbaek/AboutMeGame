import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadContent, contentById, parseInteraction } from "./contentModel.ts";
import type { GuessOption, PoiInteraction } from "./contentModel.ts";
import { buildDiscoverablePois } from "./discoverablePois.ts";
import { POI_ANCHORS } from "../world/worldConfig.ts";
import * as THREE from "three";

describe("PoiInteraction union (#34, M2)", () => {
  // Exhaustive switch over the full union: each arm narrows, and the `never`
  // default is a compile-time guard that fails to typecheck if a variant is
  // left unhandled (catches discriminant-vs-consumer drift).
  function describeInteraction(i: PoiInteraction): string {
    switch (i.type) {
      case "plain":
        return "plain";
      case "guess":
        return `guess:${i.prompt}:${i.options.length}`;
      case "highlight":
        return `highlight:${i.emphasis}`;
      default: {
        const _exhaustive: never = i;
        return _exhaustive;
      }
    }
  }

  it("accepts { type: 'plain' } without a cast and narrows exhaustively", () => {
    const i: PoiInteraction = { type: "plain" };
    expect(describeInteraction(i)).toBe("plain");
  });
});

describe("parseInteraction (#34, M2)", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  const guess = (options: GuessOption[], prompt = "Pick one", extra = {}) => ({
    type: "guess",
    prompt,
    options,
    ...extra,
  });
  const opt = (text: string, correct: boolean): GuessOption => ({ text, correct });

  describe("absent interaction → plain, silently", () => {
    it("coerces undefined to plain with no warn", () => {
      expect(parseInteraction(undefined)).toEqual({ type: "plain" });
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("valid variants parse", () => {
    it("parses an explicit plain with no warn", () => {
      expect(parseInteraction({ type: "plain" })).toEqual({ type: "plain" });
      expect(warn).not.toHaveBeenCalled();
    });

    it("parses a guess at exactly 2 options, preserving correct flags", () => {
      const result = parseInteraction(guess([opt("A", true), opt("B", false)]));
      expect(result).toEqual({
        type: "guess",
        prompt: "Pick one",
        options: [opt("A", true), opt("B", false)],
      });
      expect(warn).not.toHaveBeenCalled();
    });

    it("parses a guess at exactly 3 options, preserving correct flags", () => {
      const result = parseInteraction(
        guess([opt("A", false), opt("B", true), opt("C", false)]),
      );
      expect(result).toEqual({
        type: "guess",
        prompt: "Pick one",
        options: [opt("A", false), opt("B", true), opt("C", false)],
      });
      expect(warn).not.toHaveBeenCalled();
    });

    it("keeps an optional answerReveal on a valid guess", () => {
      const result = parseInteraction(
        guess([opt("A", true), opt("B", false)], "Pick one", {
          answerReveal: "Here is why.",
        }),
      );
      expect(result).toEqual({
        type: "guess",
        prompt: "Pick one",
        options: [opt("A", true), opt("B", false)],
        answerReveal: "Here is why.",
      });
      expect(warn).not.toHaveBeenCalled();
    });

    it("parses a highlight with a non-empty emphasis", () => {
      expect(parseInteraction({ type: "highlight", emphasis: "Big idea" })).toEqual({
        type: "highlight",
        emphasis: "Big idea",
      });
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("invalid guess → plain, with warn", () => {
    const cases: Array<[string, unknown]> = [
      ["0 options", guess([])],
      ["1 option", guess([opt("A", true)])],
      ["4 options", guess([opt("A", true), opt("B", false), opt("C", false), opt("D", false)])],
      ["empty prompt", guess([opt("A", true), opt("B", false)], "")],
      ["missing prompt", { type: "guess", options: [opt("A", true), opt("B", false)] }],
      ["empty option text", guess([opt("", true), opt("B", false)])],
      ["zero correct", guess([opt("A", false), opt("B", false)])],
      ["multiple correct", guess([opt("A", true), opt("B", true)])],
      ["non-boolean correct", { type: "guess", prompt: "p", options: [{ text: "A", correct: "yes" }, opt("B", false)] }],
      ["options not an array", { type: "guess", prompt: "p", options: "nope" }],
    ];
    for (const [label, input] of cases) {
      it(`coerces guess with ${label} to plain and warns`, () => {
        expect(parseInteraction(input)).toEqual({ type: "plain" });
        expect(warn).toHaveBeenCalledTimes(1);
      });
    }
  });

  describe("invalid highlight → plain, with warn", () => {
    it("coerces an empty emphasis to plain and warns", () => {
      expect(parseInteraction({ type: "highlight", emphasis: "" })).toEqual({ type: "plain" });
      expect(warn).toHaveBeenCalledTimes(1);
    });
    it("coerces a missing emphasis to plain and warns", () => {
      expect(parseInteraction({ type: "highlight" })).toEqual({ type: "plain" });
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe("unknown / non-object → plain, with warn", () => {
    it("coerces an unknown type 'quiz' to plain and warns", () => {
      expect(parseInteraction({ type: "quiz" })).toEqual({ type: "plain" });
      expect(warn).toHaveBeenCalledTimes(1);
    });
    const nonObjects: Array<[string, unknown]> = [
      ["null", null],
      ["array", []],
      ["string", "guess"],
      ["number", 42],
    ];
    for (const [label, input] of nonObjects) {
      it(`coerces ${label} to plain and warns`, () => {
        expect(parseInteraction(input)).toEqual({ type: "plain" });
        expect(warn).toHaveBeenCalledTimes(1);
      });
    }
  });
});

describe("content model (#34)", () => {
  it("loads 13 validated POIs with required string fields", () => {
    const set = loadContent();
    expect(set.pois).toHaveLength(13);
    for (const p of set.pois) {
      expect(p.id).toBeTruthy();
      expect(p.title).toBeTruthy();
      expect(p.teaser.length).toBeGreaterThan(0);
      expect(p.body.length).toBeGreaterThan(0);
    }
  });

  // M2 slice 3 authors interactions on three POIs; the rest stay plain. This
  // asserts the authored content resolves to the intended variants (not merely
  // that loadContent does not throw), so a coerce-to-plain typo fails loudly.
  it("resolves the authored guess and highlight interactions, rest plain", () => {
    const by = contentById();

    for (const id of ["poi-staff-engineer-gate", "poi-force-push-dam"]) {
      const i = by.get(id)!.interaction;
      expect(i.type).toBe("guess");
      if (i.type !== "guess") throw new Error("narrowing");
      expect(i.options.length).toBeGreaterThanOrEqual(2);
      expect(i.options.length).toBeLessThanOrEqual(3);
      expect(i.options.filter((o) => o.correct)).toHaveLength(1);
      expect(i.prompt.length).toBeGreaterThan(0);
    }

    const overlook = by.get("poi-end-state-overlook")!.interaction;
    expect(overlook.type).toBe("highlight");
    if (overlook.type !== "highlight") throw new Error("narrowing");
    expect(overlook.emphasis.length).toBeGreaterThan(0);

    const authored = new Set([
      "poi-staff-engineer-gate",
      "poi-force-push-dam",
      "poi-end-state-overlook",
    ]);
    for (const [id, p] of by) {
      if (authored.has(id)) continue;
      expect(p.interaction).toEqual({ type: "plain" });
    }
  });

  it("indexes content by id", () => {
    const map = contentById();
    expect(map.size).toBe(13);
    expect(map.get("poi-arrivals-gate")?.order).toBe(1);
  });
});

describe("POI placement binding (#36)", () => {
  it("joins every world anchor to its content, sorted by order", () => {
    const pois = buildDiscoverablePois(() => new THREE.Vector3(1, 2, 3));
    expect(pois).toHaveLength(POI_ANCHORS.length);
    const orders = pois.map((p) => p.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    for (const p of pois) {
      expect(p.title).toBeTruthy();
      expect(p.body).toBeTruthy();
      expect(p.position).toBeInstanceOf(THREE.Vector3);
    }
  });

  it("resolves every real anchor without throwing", () => {
    expect(() => buildDiscoverablePois(() => new THREE.Vector3())).not.toThrow();
  });

  it("carries each POI's interaction from its content (always populated)", () => {
    const pois = buildDiscoverablePois(() => new THREE.Vector3());
    const byId = contentById();
    for (const p of pois) {
      // The field is typed optional, but the producer always populates it,
      // and it equals the content's resolved interaction (slice 3 switches on it).
      expect(p.interaction).toBeDefined();
      expect(p.interaction).toEqual(byId.get(p.id)!.interaction);
    }
  });

  it("carries a guess interaction when the content has one", async () => {
    // Stub content so the producer must thread a non-plain interaction through.
    vi.resetModules();
    const guess: PoiInteraction = {
      type: "guess",
      prompt: "How?",
      options: [
        { text: "a", correct: true },
        { text: "b", correct: false },
      ],
    };
    const guessId = POI_ANCHORS[0].poiId;
    vi.doMock("./contentModel.ts", () => ({
      contentById: () =>
        new Map(
          POI_ANCHORS.map((a, i) => [
            a.poiId,
            {
              id: a.poiId,
              order: i + 1,
              title: "T",
              teaser: "x",
              body: "y",
              tags: [],
              interaction: a.poiId === guessId ? guess : { type: "plain" },
            },
          ]),
        ),
    }));
    const { buildDiscoverablePois: bind } = await import("./discoverablePois.ts");
    const pois = bind(() => new THREE.Vector3());
    expect(pois.find((p) => p.id === guessId)?.interaction).toEqual(guess);
    vi.doUnmock("./contentModel.ts");
    vi.resetModules();
  });
});

// Exercise the safety net: if content is missing for an anchor, binding throws
// rather than silently dropping a landmark's reveal.
describe("POI binding throw path", () => {
  it("throws when an anchor has no matching content", async () => {
    vi.resetModules();
    vi.doMock("./contentModel.ts", () => ({
      contentById: () => new Map(), // no content for any anchor
    }));
    const { buildDiscoverablePois: bind } = await import("./discoverablePois.ts");
    expect(() => bind(() => new THREE.Vector3())).toThrow(/no content for anchor/);
    vi.doUnmock("./contentModel.ts");
    vi.resetModules();
  });
});
