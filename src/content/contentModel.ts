// Content data model & schema (issue #34).
//
// Reconciles the seed dataset `content/working-with-claude.json` (flagged in its
// PROVENANCE as an interim draft) into a typed, validated model the game uses.
// This is the single place the raw JSON is read and shape-checked, so the rest
// of the code works with `PoiContent`, never `any`.

import raw from "../../content/working-with-claude.json";

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
      // T1 wires the field as required + non-null. Full parsing/validation of
      // the raw `interaction` lands in the next M2 slice (parseInteraction);
      // until then every POI defaults to the `plain` variant.
      interaction: { type: "plain" },
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
