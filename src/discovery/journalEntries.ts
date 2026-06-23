/**
 * Pure, framework-agnostic selectors for the in-game Journal (M3).
 *
 * No THREE / WebGL / React import: input is a **position-free** `JournalPoi`
 * projection — the shape `buildGame` produces by dropping `position` from a
 * `DiscoverablePoi`. Keeping positions out is what lets this be the primary
 * headless test target and stops THREE leaking into the React layer.
 *
 * The masking is **structural, not cosmetic**: a locked row carries only
 * `id`/`order`/`color`, with no `title`/`teaser`/`body` *keys present at all*
 * (not empty strings), so undiscovered content is unreachable from the DOM.
 * The `body` is never on any row (locked or unlocked) — it belongs to the
 * reveal path, which re-derives the full open input at select time.
 */

import type { PoiInteraction } from "../content/contentModel.ts";

/** A POI as the journal sees it: the `DiscoverablePoi` shape minus `position`,
 *  so this module needs no THREE import. `interaction` is optional, mirroring
 *  `DiscoverablePoi` (the store defaults a missing one to `plain`). */
export interface JournalPoi {
  id: string;
  order: number;
  title: string;
  teaser: string;
  body: string;
  color: number;
  interaction?: PoiInteraction;
}

/** A row in the rendered journal. Discriminated on `locked` so a consumer that
 *  reads `title`/`teaser` must first narrow to the unlocked branch — the type
 *  system enforces that locked content is unreachable, matching the runtime
 *  structural absence. */
export type JournalEntry =
  | { locked: true; id: string; order: number; color: number }
  | {
      locked: false;
      id: string;
      order: number;
      color: number;
      title: string;
      teaser: string;
    };

/**
 * Project the POI set into rendered journal rows, sorted by `order` (tie-break
 * on `id` for determinism). Discovered ids unlock to carry `title`+`teaser`;
 * everything else is a locked row with only `id`/`order`/`color` — no content
 * keys present.
 *
 * @param pois          The full POI set (any array order; sorted here).
 * @param discoveredIds Ids already discovered.
 */
export function buildJournalEntries(
  pois: readonly JournalPoi[],
  discoveredIds: readonly string[],
): JournalEntry[] {
  const discovered = new Set(discoveredIds);
  return pois
    .slice()
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((p): JournalEntry =>
      discovered.has(p.id)
        ? {
            locked: false,
            id: p.id,
            order: p.order,
            color: p.color,
            title: p.title,
            teaser: p.teaser,
          }
        : { locked: true, id: p.id, order: p.order, color: p.color },
    );
}

/** Pure guard: may this id be opened from the journal? True only when it is in
 *  the discovered set. The journal re-checks this against the LIVE discovered
 *  set immediately before calling `openPoi`, so a stale row can never open
 *  undiscovered content. */
export function journalCanOpen(
  id: string,
  discoveredIds: readonly string[],
): boolean {
  return discoveredIds.includes(id);
}
