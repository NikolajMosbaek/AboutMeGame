import { afterAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildTerrain } from "./terrain.ts";
import { buildLandmarks } from "./landmarks.ts";
import { POI_ANCHORS, WORLD } from "./worldConfig.ts";

// buildLandmarks only needs a Terrain (geometry maths) — runs headless.
describe("landmarks", () => {
  const terrain = buildTerrain();
  const landmarks = buildLandmarks(terrain);
  afterAll(() => {
    landmarks.dispose();
    terrain.dispose();
  });

  it("places one landmark per anchor, named landmark:<poiId> (Epic 4 contract)", () => {
    expect(landmarks.placed).toHaveLength(13);
    for (const a of POI_ANCHORS) {
      const placed = landmarks.placed.find((p) => p.poiId === a.poiId);
      expect(placed, a.poiId).toBeDefined();
      expect(placed!.object.name).toBe(`landmark:${a.poiId}`);
      expect(landmarks.group.getObjectByName(`landmark:${a.poiId}`)).toBe(
        placed!.object,
      );
    }
  });

  it("gives each landmark a beacon child and seats it above sea level", () => {
    for (const p of landmarks.placed) {
      let hasBeacon = false;
      p.object.traverse((o) => {
        if (o instanceof THREE.Mesh && o.name === "beacon") hasBeacon = true;
      });
      expect(hasBeacon, `${p.poiId} has no beacon`).toBe(true);
      expect(p.position.y).toBeGreaterThanOrEqual(WORLD.seaLevel);
    }
  });
});
