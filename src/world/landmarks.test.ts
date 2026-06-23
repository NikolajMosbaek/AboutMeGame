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

// Stone tint stamped on every stone-set source vertex (mirrors STONE_BASE in
// landmarks.ts). The wayfinding guard asserts an accent vertex differs from this.
const STONE_BASE = 0xb9b2a6;

/** Collect the per-vertex `color` triples of every vertex on a geometry. */
function vertexColorTriples(geo: THREE.BufferGeometry): Array<[number, number, number]> {
  const attr = geo.getAttribute("color");
  const out: Array<[number, number, number]> = [];
  if (!attr) return out;
  for (let i = 0; i < attr.count; i++) {
    out.push([attr.getX(i), attr.getY(i), attr.getZ(i)]);
  }
  return out;
}

/**
 * The merged stone/accent meshes are the unnamed children whose material is the
 * shared stone vs emissive accent material — the accent material carries a white
 * emissive (0xffffff). The discrete beacon/lamp are named and excluded.
 */
function mergedMeshes(object: THREE.Object3D): { stone?: THREE.Mesh; accent?: THREE.Mesh } {
  const result: { stone?: THREE.Mesh; accent?: THREE.Mesh } = {};
  object.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (o.name === "beacon" || o.name === "lamp") return;
    const mat = o.material as THREE.MeshStandardMaterial;
    if (mat.emissive && mat.emissive.getHex() === 0xffffff) result.accent = o;
    else result.stone = o;
  });
  return result;
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

  // Material economy (G4, T3): the per-landmark merge collapses ~39 bespoke
  // material instances into exactly TWO shared MeshStandardMaterials (stone +
  // emissive accent), reused by === across all 13 landmarks' merged meshes. The
  // discrete beacon (MeshBasicMaterial) and the tower lamp (its own emissive
  // MeshStandardMaterial) are NOT part of that shared pair, so they are excluded
  // by name — collecting only the unnamed merged stone/accent meshes. A stray
  // per-landmark material (the regression this guards) would push the identity
  // Set past 2.
  it("shares exactly two merged-mesh materials (stone + accent) by identity across all 13 landmarks", () => {
    expect(landmarks.placed).toHaveLength(13);
    const shared = new Set<THREE.Material>();
    for (const p of landmarks.placed) {
      p.object.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        // Exclude the discrete bloom meshes — only the merged stone/accent
        // meshes (left unnamed by mergeSet) belong to the shared pair.
        if (o.name === "beacon" || o.name === "lamp") return;
        expect(Array.isArray(o.material), `${p.poiId} uses a material array`).toBe(
          false,
        );
        shared.add(o.material as THREE.Material);
      });
    }
    expect(shared.size).toBe(2);
    for (const mat of shared) {
      expect(mat).toBeInstanceOf(THREE.MeshStandardMaterial);
      const std = mat as THREE.MeshStandardMaterial;
      expect(std.vertexColors).toBe(true);
      expect(std.flatShading).toBe(true);
    }
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

  // Wayfinding-from-distance, made testable (G4, T4): the signature hue rides a
  // per-vertex `color` attribute so the one shared emissive accent material glows
  // in each landmark's signature colour. Every merged stone/accent geometry must
  // therefore carry a non-empty `color` attribute, and each landmark's accent
  // colour must derive from `anchor.color` and differ from the neutral stone base
  // — otherwise the merge would ship colourless geometry and every landmark would
  // bloom the same white, defeating navigation. The tower carries its signature
  // colour on the discrete `lamp` (its accent IS the lamp), so for that archetype
  // the lamp's emissive is the accent-colour source rather than a merged mesh.
  it("stamps a signature-colour vertex attribute on every merged geometry (wayfinding)", () => {
    expect(landmarks.placed).toHaveLength(13);
    const stoneBase = new THREE.Color(STONE_BASE);
    const stoneTriple: [number, number, number] = [
      stoneBase.r,
      stoneBase.g,
      stoneBase.b,
    ];
    const eq = (a: [number, number, number], b: [number, number, number]) =>
      Math.abs(a[0] - b[0]) < 1e-4 &&
      Math.abs(a[1] - b[1]) < 1e-4 &&
      Math.abs(a[2] - b[2]) < 1e-4;

    for (const anchor of POI_ANCHORS) {
      const placed = landmarks.placed.find((p) => p.poiId === anchor.poiId)!;
      const { stone, accent } = mergedMeshes(placed.object);

      // Every landmark has a merged stone mesh; its `color` attribute is non-empty.
      expect(stone, `${anchor.poiId} merged stone mesh`).toBeInstanceOf(THREE.Mesh);
      const stoneColors = vertexColorTriples(stone!.geometry);
      expect(
        stoneColors.length,
        `${anchor.poiId} stone color attribute count`,
      ).toBeGreaterThan(0);

      // The signature colour derives from anchor.color and differs from the stone
      // base — sourced from the merged accent geometry, or the lamp on the tower.
      const sig = new THREE.Color(anchor.color);
      const sigTriple: [number, number, number] = [sig.r, sig.g, sig.b];

      if (accent) {
        const accentColors = vertexColorTriples(accent.geometry);
        expect(
          accentColors.length,
          `${anchor.poiId} accent color attribute count`,
        ).toBeGreaterThan(0);
        expect(
          accentColors.some((c) => eq(c, sigTriple)),
          `${anchor.poiId} accent has a vertex in anchor.color`,
        ).toBe(true);
        expect(
          accentColors.some((c) => eq(c, sigTriple)) && !eq(sigTriple, stoneTriple),
          `${anchor.poiId} accent signature colour differs from stone base`,
        ).toBe(true);
      } else {
        // No merged accent mesh (tower): the lamp carries the signature colour.
        const lamp = placed.object.getObjectByName("lamp") as THREE.Mesh | null;
        expect(lamp, `${anchor.poiId} has neither merged accent nor lamp`).toBeInstanceOf(
          THREE.Mesh,
        );
        const lampMat = lamp!.material as THREE.MeshStandardMaterial;
        const lampTriple: [number, number, number] = [
          lampMat.emissive.r,
          lampMat.emissive.g,
          lampMat.emissive.b,
        ];
        expect(eq(lampTriple, sigTriple), `${anchor.poiId} lamp emissive == anchor.color`).toBe(
          true,
        );
        expect(
          !eq(lampTriple, stoneTriple),
          `${anchor.poiId} lamp signature colour differs from stone base`,
        ).toBe(true);
      }
    }
  });
});
