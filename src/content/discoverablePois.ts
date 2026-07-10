import * as THREE from "three";
import { POI_ANCHORS } from "../world/worldConfig.ts";
import { contentById, type PoiContent, type PoiInteraction } from "./contentModel.ts";

/** A point of interest fully resolved: its content joined to its world anchor
 *  and the landmark colour. This is what discovery proximity-tests against. */
export interface DiscoverablePoi {
  id: string;
  order: number;
  title: string;
  teaser: string;
  body: string;
  color: number;
  /** World position of the landmark base (y is set from the anchor; the actual
   *  ground height is applied by the placement code that knows the terrain). */
  position: THREE.Vector3;
  /** What this POI does on interaction. OPTIONAL on the type so existing literal
   *  fixtures stay green, but `buildDiscoverablePois` ALWAYS populates it from
   *  the content's resolved interaction — the discovery store defaults a missing
   *  one to `plain`. Carried whole so slice 3 does one exhaustive switch. */
  interaction?: PoiInteraction;
}

/** A POI projected for the React-facing journal: the same content + colour a
 *  `DiscoverablePoi` carries, but with the THREE `position` dropped, so the
 *  journal UI gets `body`/`teaser`/`interaction` without leaking THREE into the
 *  DOM shell. NavSystem keeps reading the position-bearing array. */
export type JournalPoi = Omit<DiscoverablePoi, "position">;

/** Project a position-bearing POI onto the position-free journal shape. Pure;
 *  drops `position` so the structural seam between the engine array (NavSystem)
 *  and the React-facing array is additive, never widening one field with THREE. */
export function toJournalPoi(poi: DiscoverablePoi): JournalPoi {
  const { position: _position, ...rest } = poi;
  return rest;
}

/**
 * POI placement / binding system (issue #36): join the data-driven world anchors
 * (`POI_ANCHORS`) with the content (`expedition.json`) by id. The world
 * decides *where*; the content decides *what*; this is the seam. `positionFor`
 * supplies the ground-aware Y (landmarks were placed by `buildLandmarks`, so we
 * pass that map in) — keeping this module free of any THREE/terrain dependency
 * beyond a plain Vector3.
 *
 * Throws if an anchor has no matching content, so a typo can't silently drop a
 * landmark's reveal (guarded by `worldConfig.test.ts` too).
 */
export function buildDiscoverablePois(
  positionFor: (poiId: string) => THREE.Vector3,
): DiscoverablePoi[] {
  const content = contentById();
  return POI_ANCHORS.map((anchor) => {
    const c: PoiContent | undefined = content.get(anchor.poiId);
    if (!c) throw new Error(`discovery: no content for anchor "${anchor.poiId}"`);
    return {
      id: anchor.poiId,
      order: c.order,
      title: c.title,
      teaser: c.teaser,
      body: c.body,
      color: anchor.color,
      position: positionFor(anchor.poiId).clone(),
      interaction: c.interaction,
    };
  }).sort((a, b) => a.order - b.order);
}
