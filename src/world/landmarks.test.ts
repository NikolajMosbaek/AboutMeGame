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

  // The beacon is the bloom source for the medium/high compositor path: its
  // material must stay an additive, non-depth-writing translucent overlay so
  // brightening it for bloom never turns it into an opaque occluder.
  it("keeps the beacon additive, transparent and depthWrite:false (bloom invariant)", () => {
    const beacon = landmarks.placed[0]!.object.getObjectByName("beacon");
    expect(beacon).toBeInstanceOf(THREE.Mesh);
    const mat = (beacon as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(mat).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(mat.blending).toBe(THREE.AdditiveBlending);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
  });
});
