import { describe, expect, it } from "vitest";
import { POI_ANCHORS, WORLD } from "./worldConfig.ts";
import content from "../../content/working-with-claude.json";

describe("world config & POI layout", () => {
  it("has all 13 landmark anchors", () => {
    expect(POI_ANCHORS).toHaveLength(13);
  });

  it("places every landmark inside the soft boundary (on solid land)", () => {
    for (const a of POI_ANCHORS) {
      const d = Math.hypot(a.x, a.z);
      expect(d, `${a.poiId} is at radius ${d.toFixed(0)}`).toBeLessThan(
        WORLD.boundaryRadius,
      );
      // and within the full-height plateau so it sits above the waterline
      expect(d).toBeLessThan(WORLD.coastRadius);
    }
  });

  it("has unique poiIds and unique narrative orders 1..13", () => {
    const ids = new Set(POI_ANCHORS.map((a) => a.poiId));
    expect(ids.size).toBe(13);
    const orders = POI_ANCHORS.map((a) => a.order).sort((x, y) => x - y);
    expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it("every anchor binds to a real content POI id (Epic 4 contract)", () => {
    const contentIds = new Set(content.pois.map((p) => p.id));
    for (const a of POI_ANCHORS) {
      expect(contentIds.has(a.poiId), `no content for ${a.poiId}`).toBe(true);
    }
  });

  it("boundary sits inside the coastline, which sits inside the tile", () => {
    expect(WORLD.boundaryRadius).toBeLessThan(WORLD.islandRadius);
    expect(WORLD.coastRadius).toBeLessThan(WORLD.islandRadius);
    expect(WORLD.islandRadius * 2).toBeLessThan(WORLD.size);
  });
});
