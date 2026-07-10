// Content data model & schema.
//
// Loads the expedition clue chain (`content/expedition.json` — The Lost Idol,
// pivot slice C) into a typed, validated model the game uses. This is the
// single place the raw JSON is read and shape-checked, so the rest of the code
// works with `PoiContent`, never `any`.

import raw from "../../content/expedition.json";

/** Inclusive bounds for a `guess` interaction's option count. Named so the
 *  validation reads as intent, not a magic 2/3. */
export const GUESS_MIN_OPTIONS = 2;
export const GUESS_MAX_OPTIONS = 3;

/** One choice in a `guess` interaction. The right answer is carried per-option
 *  (`correct`) rather than as a numeric index, so options can be shuffled for
 *  fairness, each maps to its own control, and there is no off-by-one risk. */
export interface GuessOption {
  text: string;
  correct: boolean;
}

/**
 * What a POI does when interacted with. Discriminated on `type`; every POI from
 * `loadContent()` resolves to a concrete variant (never undefined), so a
 * downstream consumer does one exhaustive switch on `type` and never guards for
 * absence.
 */
export type PoiInteraction =
  | { type: "plain" }
  | {
      type: "guess";
      prompt: string;
      options: GuessOption[];
      /** Optional takeaway shown after the player commits a guess. */
      answerReveal?: string;
    }
  | {
      type: "highlight";
      /** Lede/takeaway, distinct from the POI body. */
      emphasis: string;
    };

/** The single, uniform failure rule for interactions: COERCE-TO-PLAIN, never
 *  throw. A link-shared party game must not let one author's typo break the
 *  world for every player, so a malformed interaction degrades to `plain`
 *  rather than aborting the load. (The `throw` path stays reserved for missing
 *  required identity/text fields — id/title/teaser/body — in `loadContent`.)
 *
 *  - Absent (`undefined`) → `plain`, SILENTLY (the common, valid case today).
 *  - Present but invalid (unknown `type`, non-object, or a structurally invalid
 *    variant) → `plain`, with a dev-time `console.warn` so the authoring
 *    mistake is visible without being fatal.
 *
 *  Pure: no I/O, no module state. Exported so M2 reveal slices and their tests
 *  import the parser directly (the loader reads a static JSON import that this
 *  slice may not edit, so this is the testability seam). */
export function parseInteraction(raw: unknown): PoiInteraction {
  if (raw === undefined) return { type: "plain" };

  const coerce = (reason: string): PoiInteraction => {
    console.warn(`content: invalid interaction (${reason}); coercing to plain`);
    return { type: "plain" };
  };

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return coerce("not an object");
  }
  const obj = raw as { type?: unknown };
  if (typeof obj.type !== "string") return coerce("missing type");

  // Narrow the raw tag to the union's discriminant. An unrecognized tag falls
  // through to the `never` default below, which fails to typecheck if a future
  // variant is added to `PoiInteraction` without a matching arm here — this is
  // the guard against discriminant-vs-validation drift.
  const tag = obj.type as PoiInteraction["type"];
  switch (tag) {
    case "plain":
      return { type: "plain" };

    case "guess": {
      const g = obj as { prompt?: unknown; options?: unknown; answerReveal?: unknown };
      if (typeof g.prompt !== "string" || g.prompt.length === 0) {
        return coerce("guess prompt must be a non-empty string");
      }
      if (
        !Array.isArray(g.options) ||
        g.options.length < GUESS_MIN_OPTIONS ||
        g.options.length > GUESS_MAX_OPTIONS
      ) {
        return coerce(`guess must have ${GUESS_MIN_OPTIONS}-${GUESS_MAX_OPTIONS} options`);
      }
      const options: GuessOption[] = [];
      for (const o of g.options) {
        if (typeof o !== "object" || o === null) {
          return coerce("guess option must be an object");
        }
        const { text, correct } = o as { text?: unknown; correct?: unknown };
        if (typeof text !== "string" || text.length === 0) {
          return coerce("guess option text must be a non-empty string");
        }
        if (typeof correct !== "boolean") {
          return coerce("guess option correct must be a boolean");
        }
        options.push({ text, correct });
      }
      // Exactly one correct answer — never partial-repair or truncate, which
      // could silently drop the right answer and ship a broken-but-passing quiz.
      if (options.filter((o) => o.correct).length !== 1) {
        return coerce("guess must have exactly one correct option");
      }
      const result: PoiInteraction = { type: "guess", prompt: g.prompt, options };
      if (typeof g.answerReveal === "string") result.answerReveal = g.answerReveal;
      return result;
    }

    case "highlight": {
      const h = obj as { emphasis?: unknown };
      if (typeof h.emphasis !== "string" || h.emphasis.length === 0) {
        return coerce("highlight emphasis must be a non-empty string");
      }
      return { type: "highlight", emphasis: h.emphasis };
    }

    default: {
      // Compile-time exhaustiveness: if a variant is added to the union, `tag`
      // is no longer narrowed to `never` here and this fails to typecheck.
      // At runtime this also catches an unrecognized raw tag (e.g. "quiz").
      const _exhaustive: never = tag;
      void _exhaustive;
      return coerce(`unknown type "${obj.type as string}"`);
    }
  }
}

export interface PoiContent {
  /** Stable id, joined to a world anchor by `worldConfig.POI_ANCHORS.poiId`. */
  id: string;
  /** Narrative order, 1 = the spawn landmark. */
  order: number;
  title: string;
  /** Short line shown on approach (proximity). */
  teaser: string;
  /** Full reveal shown on interaction. */
  body: string;
  tags: string[];
  /** Always populated by `loadContent()`; missing/invalid input → `plain`. */
  interaction: PoiInteraction;
}

export interface ContentSet {
  schemaVersion: string;
  contentSet: string;
  voice: string;
  pois: PoiContent[];
}

/** Validate + map the raw JSON. Throws on a malformed dataset (caught at build
 *  by the content test) rather than letting a bad POI slip through silently. */
export function loadContent(): ContentSet {
  const data = raw as {
    schemaVersion?: string;
    contentSet?: string;
    voice?: string;
    pois?: Array<Partial<Omit<PoiContent, "interaction">> & { interaction?: unknown }>;
  };
  if (!Array.isArray(data.pois) || data.pois.length === 0) {
    throw new Error("content: no POIs in dataset");
  }
  const pois: PoiContent[] = data.pois.map((p, i) => {
    for (const field of ["id", "title", "teaser", "body"] as const) {
      if (!p[field] || typeof p[field] !== "string") {
        throw new Error(`content: POI #${i} missing string field "${field}"`);
      }
    }
    return {
      id: p.id!,
      order: typeof p.order === "number" ? p.order : i + 1,
      title: p.title!,
      teaser: p.teaser!,
      body: p.body!,
      tags: Array.isArray(p.tags) ? p.tags : [],
      // Normalize at the loader boundary: every POI resolves to a concrete,
      // non-nullable variant so downstream consumers do one exhaustive switch
      // and never guard for undefined. Missing/invalid input → `plain`.
      interaction: parseInteraction(p.interaction),
    };
  });
  return {
    schemaVersion: data.schemaVersion ?? "unknown",
    contentSet: data.contentSet ?? "unknown",
    voice: data.voice ?? "unknown",
    pois,
  };
}

/** Convenience: content keyed by id, for joining to world anchors. */
export function contentById(): Map<string, PoiContent> {
  const map = new Map<string, PoiContent>();
  for (const p of loadContent().pois) map.set(p.id, p);
  return map;
}
