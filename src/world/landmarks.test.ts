import { afterAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildTerrain } from "./terrain.ts";
import { buildLandmarks } from "./landmarks.ts";
import {
  POI_ANCHORS,
  WORLD,
  type LandmarkArchetype,
} from "./worldConfig.ts";

// G4 silhouette/material upgrade target: each landmark's sub-primitives merge
// into ONE stone mesh + ONE accent mesh, plus the discrete un-merged beacon —
// three renderable THREE.Mesh children per group regardless of archetype. The
// tower's lamp IS its accent (no extra mesh) and the mirror's accent replaces
// the deleted glass plate, so neither regresses past 3.
const TARGET_MESH_COUNT: Record<LandmarkArchetype, number> = {
  gate: 3,
  monolith: 3,
  tower: 3,
  foundry: 3,
  dam: 3,
  station: 3,
  ring: 3,
  mirror: 3,
};

// Today's (pre-refactor) renderable-mesh count per archetype: every structure
// sub-primitive is its own Mesh plus the beacon. The merge must not increase any
// archetype's count, so the new target must stay <= these documented numbers.
const PRE_REFACTOR_MESH_COUNT: Record<LandmarkArchetype, number> = {
  gate: 4, // 2 pillars + lintel + beacon
  monolith: 3, // slab + cap + beacon
  tower: 3, // shaft + lamp + beacon
  foundry: 3, // hall + chimney + beacon
  dam: 3, // wall + sluice + beacon
  station: 7, // platform + roof + 4 posts + beacon
  ring: 9, // 8 posts + beacon
  mirror: 3, // frame + glass + beacon
};

function countMeshes(object: THREE.Object3D): number {
  let n = 0;
  object.traverse((o) => {
    if (o instanceof THREE.Mesh) n++;
  });
  return n;
}

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

  // The silhouette/material upgrade (G4) merges each landmark's stone and accent
  // sub-primitives into shared meshes, but every beacon must survive un-merged as
  // a discrete, named THREE.Mesh — BeaconPulseSystem looks them up by name and
  // the bloom invariant must hold for all 13, not just placed[0]. This strengthens
  // the single-landmark bloom check above to the whole set, so a merge that
  // accidentally folds in or drops a beacon fails here.
  it("keeps all 13 beacons discrete, named, additive/transparent/depthWrite:false meshes", () => {
    expect(landmarks.placed).toHaveLength(13);
    for (const p of landmarks.placed) {
      const beacon = p.object.getObjectByName("beacon");
      expect(beacon, `${p.poiId} beacon`).toBeInstanceOf(THREE.Mesh);
      const mat = (beacon as THREE.Mesh).material as THREE.MeshBasicMaterial;
      expect(mat, `${p.poiId} beacon material`).toBeInstanceOf(
        THREE.MeshBasicMaterial,
      );
      expect(mat.blending, `${p.poiId} beacon blending`).toBe(
        THREE.AdditiveBlending,
      );
      expect(mat.transparent, `${p.poiId} beacon transparent`).toBe(true);
      expect(mat.depthWrite, `${p.poiId} beacon depthWrite`).toBe(false);
    }
  });

  // The tower lamp is the second genuine bloom source. Its emissive must carry
  // the signature colour and its intensity must sit above 0.9 so the lamp
  // reliably clears the tuned-high bloom threshold under the new
  // linear + OutputPass compositor chain — guarding that threshold-clearing
  // invariant against future tweaks.
  it("gives the tower lamp emissive colour and emissiveIntensity > 0.9 (bloom threshold invariant)", () => {
    const tower = POI_ANCHORS.find((a) => a.archetype === "tower")!;
    const placed = landmarks.placed.find((p) => p.poiId === tower.poiId)!;
    const lamp = placed.object.getObjectByName("lamp");
    expect(lamp, "tower lamp mesh").toBeInstanceOf(THREE.Mesh);
    const mat = (lamp as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(mat).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(mat.emissive.getHex()).toBe(tower.color);
    expect(mat.emissiveIntensity).toBeGreaterThan(0.9);
  });

  // Draw-call discipline: after the G4 merge each landmark renders as ONE stone
  // mesh + ONE accent mesh + ONE beacon. Counting THREE.Mesh children headlessly
  // (no renderer.info / no WebGL) is the proxy for per-landmark draw calls, since
  // the two structure materials are shared across all 13. The count must hit the
  // fixed target AND never exceed today's per-archetype count, so a stray accent
  // mesh on tower/mirror (the Quality flaw) or any regression fails here.
  it("renders each archetype as the fixed per-archetype mesh-count target, never above today's", () => {
    for (const archetype of Object.keys(
      TARGET_MESH_COUNT,
    ) as LandmarkArchetype[]) {
      const anchor = POI_ANCHORS.find((a) => a.archetype === archetype);
      expect(anchor, `no anchor uses archetype ${archetype}`).toBeDefined();
      const placed = landmarks.placed.find((p) => p.poiId === anchor!.poiId)!;
      const count = countMeshes(placed.object);
      expect(count, `${archetype} mesh count`).toBe(
        TARGET_MESH_COUNT[archetype],
      );
      expect(
        count,
        `${archetype} mesh count exceeds pre-refactor ${PRE_REFACTOR_MESH_COUNT[archetype]}`,
      ).toBeLessThanOrEqual(PRE_REFACTOR_MESH_COUNT[archetype]);
    }
  });
});
