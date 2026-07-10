import { describe, expect, it } from "vitest";
import { POI_ANCHORS, WORLD, RIVER, LAGOON, SPAWN } from "./worldConfig.ts";
import content from "../../content/expedition.json";

describe("world config & site layout (The Lost Idol)", () => {
  it("has all 6 expedition-site anchors", () => {
    expect(POI_ANCHORS).toHaveLength(6);
  });

  it("places every site inside the soft boundary (on solid land)", () => {
    for (const a of POI_ANCHORS) {
      const d = Math.hypot(a.x, a.z);
      expect(d, `${a.poiId} is at radius ${d.toFixed(0)}`).toBeLessThan(
        WORLD.boundaryRadius,
      );
      // and within the full-height plateau so it sits above the waterline
      expect(d).toBeLessThan(WORLD.coastRadius);
    }
  });

  it("has unique poiIds and unique narrative orders 1..6", () => {
    const ids = new Set(POI_ANCHORS.map((a) => a.poiId));
    expect(ids.size).toBe(6);
    const orders = POI_ANCHORS.map((a) => a.order).sort((x, y) => x - y);
    expect(orders).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("every anchor binds to a real content POI id (the clue-chain contract)", () => {
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

  it("the river runs source → mouth into the lagoon, inside the island", () => {
    const pts = RIVER.points;
    expect(pts.length).toBeGreaterThanOrEqual(4);
    // The mouth is far south of the source (the island drains south).
    expect(pts[pts.length - 1].z - pts[0].z).toBeGreaterThan(150);
    // The mouth reaches the lagoon basin so the carved channel joins it.
    const mouth = pts[pts.length - 1];
    const toLagoon = Math.hypot(mouth.x - LAGOON.x, mouth.z - LAGOON.z);
    expect(toLagoon).toBeLessThan(LAGOON.radius + LAGOON.shoreRamp);
    // Every point stays on the island plateau.
    for (const p of pts) {
      expect(Math.hypot(p.x, p.z)).toBeLessThan(WORLD.coastRadius);
    }
    // The carve is a real obstacle: deeper than the explorer can wade.
    expect(RIVER.depth).toBeGreaterThan(1.2);
    expect(RIVER.bankHalfWidth).toBeGreaterThan(RIVER.bedHalfWidth);
  });

  it("the spawn camp is on land near the lagoon shore, with its site anchor beside it", () => {
    // Near the lagoon (the camp overlooks the water) but outside the basin.
    const toLagoon = Math.hypot(SPAWN.x - LAGOON.x, SPAWN.z - LAGOON.z);
    expect(toLagoon).toBeGreaterThan(LAGOON.radius);
    expect(toLagoon).toBeLessThan(LAGOON.radius + LAGOON.shoreRamp * 2.5);
    // The base-camp anchor sits within the camp clearing.
    const camp = POI_ANCHORS.find((a) => a.archetype === "camp")!;
    expect(Math.hypot(camp.x - SPAWN.x, camp.z - SPAWN.z)).toBeLessThanOrEqual(
      WORLD.campClearRadius,
    );
  });

  it("the clue chain is walkable: consecutive sites are a real trek but reachable", () => {
    const byOrder = [...POI_ANCHORS].sort((a, b) => a.order - b.order);
    for (let i = 0; i < byOrder.length - 1; i++) {
      const a = byOrder[i];
      const b = byOrder[i + 1];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      expect(d, `${a.poiId} → ${b.poiId} is ${d.toFixed(0)}u`).toBeGreaterThan(30);
      expect(d, `${a.poiId} → ${b.poiId} is ${d.toFixed(0)}u`).toBeLessThan(260);
    }
  });
});
