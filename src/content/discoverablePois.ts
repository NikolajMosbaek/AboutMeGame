import * as THREE from "three";
import { POI_ANCHORS } from "../world/worldConfig.ts";
import { contentById, type PoiContent } from "./contentModel.ts";

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
}

/**
 * POI placement / binding system (issue #36): join the data-driven world anchors
 * (`POI_ANCHORS`) with the content (`working-with-claude.json`) by id. The world
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
    };
  }).sort((a, b) => a.order - b.order);
}
