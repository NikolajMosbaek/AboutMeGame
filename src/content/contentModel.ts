// Content data model & schema (issue #34).
//
// Reconciles the seed dataset `content/working-with-claude.json` (flagged in its
// PROVENANCE as an interim draft) into a typed, validated model the game uses.
// This is the single place the raw JSON is read and shape-checked, so the rest
// of the code works with `PoiContent`, never `any`.

import raw from "../../content/working-with-claude.json";

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
    pois?: Array<Partial<PoiContent>>;
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
