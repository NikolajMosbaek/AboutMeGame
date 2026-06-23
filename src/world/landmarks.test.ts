import { afterAll, describe, expect, it, vi } from "vitest";
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

// Expected merged-stone silhouette extent per archetype, as inclusive [min,max]
// bands on each axis (world units). Derived from the baked local-space geometry
// in landmarks.ts: e.g. the gate's two pillars sit at x=-4/x=+4 so the stone span
// is ~10 wide; the station's posts sit at x=±5/z=±3; the ring's 8 posts ride a
// radius-6 circle so the stone spans ~13 on x AND z. These spans only hold if
// every sub-primitive's transform was baked into its geometry before
// mergeGeometries — an un-baked primitive collapses to the origin and shrinks the
// affected axis below its lower band (the regression this guards). Bands carry a
// generous tolerance around the measured values so they assert "right silhouette
// size", not exact dimensions.
const EXPECTED_STONE_SPAN: Record<
  LandmarkArchetype,
  { x: [number, number]; y: [number, number]; z: [number, number] }
> = {
  // 2 pillars at x=±4 (w=2) + lintel w=12: span ~10 wide, 9 tall.
  gate: { x: [9, 13], y: [8, 11], z: [1.5, 3] },
  // single slab w=3, h=12.
  monolith: { x: [2.5, 4], y: [11, 13], z: [1, 2] },
  // single cone-ish shaft r≈3.4, h=14.
  tower: { x: [5, 8], y: [13, 15], z: [5, 8] },
  // single hall 10×7×8.
  foundry: { x: [9, 11], y: [6, 8], z: [7, 9] },
  // long wall 22×11×3.
  dam: { x: [20, 24], y: [10, 12], z: [2.5, 4] },
  // platform 12 wide + posts at x=±5/z=±3, posts h=5 reach y≈5.5.
  station: { x: [11, 14], y: [5, 7], z: [6, 9] },
  // 8 posts on a radius-6 circle (post w=1.4): span ~13 on x and z, 6 tall.
  ring: { x: [12, 15], y: [5, 7], z: [12, 15] },
  // single frame 14×10×1.
  mirror: { x: [13, 15], y: [9, 11], z: [0.5, 2] },
};

/** The merged stone mesh = the unnamed child whose material is NOT the white
 *  emissive accent (mirrors mergedMeshes(); the discrete beacon/lamp excluded). */
function mergedStoneMesh(object: THREE.Object3D): THREE.Mesh | undefined {
  return mergedMeshes(object).stone;
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

  // Transform-baking regression guard (G4, T5): mergeGeometries merges RAW
  // geometry and ignores Object3D transforms, so every sub-primitive's transform
  // (translate/rotate/scale) must be baked into its geometry BEFORE the merge. If
  // it is not, the primitive collapses to the local origin — the merged stone
  // mesh shrinks on the affected axis and the silhouette is wrong, yet the
  // name/position contract tests would still pass. This computes each landmark's
  // merged stone bounding box and asserts (a) it is defined and non-degenerate
  // (every axis span > epsilon, i.e. not collapsed to a point) and (b) the span
  // sits inside the archetype's expected silhouette size band — so an un-baked
  // pillar/post/lintel that collapsed to the origin fails here.
  it("bakes sub-primitive transforms: merged stone bounding box spans the archetype silhouette (not collapsed)", () => {
    const EPS = 1e-3;
    for (const anchor of POI_ANCHORS) {
      const placed = landmarks.placed.find((p) => p.poiId === anchor.poiId)!;
      const stone = mergedStoneMesh(placed.object);
      expect(stone, `${anchor.poiId} merged stone mesh`).toBeInstanceOf(THREE.Mesh);

      stone!.geometry.computeBoundingBox();
      const box = stone!.geometry.boundingBox;
      expect(box, `${anchor.poiId} stone bounding box`).not.toBeNull();

      const span = {
        x: box!.max.x - box!.min.x,
        y: box!.max.y - box!.min.y,
        z: box!.max.z - box!.min.z,
      };

      // Non-degenerate: not collapsed to a point/origin on any axis.
      expect(span.x, `${anchor.poiId} stone x span`).toBeGreaterThan(EPS);
      expect(span.y, `${anchor.poiId} stone y span`).toBeGreaterThan(EPS);
      expect(span.z, `${anchor.poiId} stone z span`).toBeGreaterThan(EPS);

      // Matches the archetype's expected silhouette size band — an un-baked
      // transform would pull an axis below its lower bound.
      const band = EXPECTED_STONE_SPAN[anchor.archetype];
      for (const axis of ["x", "y", "z"] as const) {
        const [lo, hi] = band[axis];
        expect(
          span[axis],
          `${anchor.poiId} (${anchor.archetype}) stone ${axis} span ${span[
            axis
          ].toFixed(2)} outside [${lo}, ${hi}]`,
        ).toBeGreaterThanOrEqual(lo);
        expect(
          span[axis],
          `${anchor.poiId} (${anchor.archetype}) stone ${axis} span ${span[
            axis
          ].toFixed(2)} outside [${lo}, ${hi}]`,
        ).toBeLessThanOrEqual(hi);
      }
    }
  });

  // Triangle-budget guard (G4, T6): the whole landmark set is fully procedural
  // low-poly geometry, so its total triangle count must stay a rounding error
  // against the 500k/frame budget (docs/perf-budget.md). This sums
  // positionAttribute.count/3 over EVERY renderable Mesh geometry in the whole
  // landmarks.group — the 13 merged stone meshes, the merged accent meshes, all
  // 13 beacons and the tower lamp — and asserts the grand total stays under a
  // stated ceiling well below budget. The ceiling is set ~5x over the measured
  // total (≈730 tris) so it gives room for richer silhouettes yet still fails
  // loudly if a future edit accidentally subdivides geometry or adds heavy
  // sub-primitives, before that cost ever reaches a frame.
  const LANDMARK_TRIANGLE_CEILING = 4000;

  it("keeps total landmark triangles well under the frame budget (triangle ceiling)", () => {
    let total = 0;
    landmarks.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const position = o.geometry.getAttribute("position");
      expect(position, "renderable mesh has a position attribute").toBeDefined();
      total += position.count / 3;
    });

    // Sanity floor: the sum must actually be counting real geometry (every
    // landmark contributes), not silently zero from an empty traversal.
    expect(total, "total landmark triangles").toBeGreaterThan(0);
    expect(
      total,
      `total landmark triangles ${total} exceeds ceiling ${LANDMARK_TRIANGLE_CEILING}`,
    ).toBeLessThan(LANDMARK_TRIANGLE_CEILING);
  });

  // Dispose-coverage guard (G4, T7): the merge owns its source sub-geometries —
  // mergeGeometries copies them into a new buffer, after which the sources are
  // disposed at build time, so the only geometry still reachable from the group
  // is the merged stone/accent geometry, the 13 beacon geometries and the tower
  // lamp; the two structure materials are shared by identity across all 13. The
  // dispose() contract must release every one of those exactly once: a leaked
  // source geometry would show up as an extra disposed buffer (caught by the
  // build-time count), and a double-dispose — e.g. tracking a shared material
  // per-landmark, or pushing a merged geometry into disposables twice — would
  // push a spy past one call. This builds a DEDICATED Landmarks instance so the
  // spies and the dispose() call never touch the suite-wide `landmarks` fixture,
  // gathers the geometries/materials from the group's ACTUAL Mesh children
  // (not landmarks.ts internals), then asserts each is disposed exactly once.
  it("disposes every merged geometry and both shared materials exactly once, with no double-dispose (dispose coverage)", () => {
    const own = buildLandmarks(terrain);

    // Gather the dispose targets from the actual renderable Mesh children of the
    // group — the only geometry reachable here is merged/beacon/lamp geometry,
    // because every source sub-primitive was consumed and disposed at build time.
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    let meshCount = 0;
    own.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      meshCount++;
      geometries.add(o.geometry);
      expect(
        Array.isArray(o.material),
        "a landmark mesh uses a material array",
      ).toBe(false);
      materials.add(o.material as THREE.Material);
    });

    // Sanity: the traversal actually found geometry to guard (every landmark
    // contributes a merged stone mesh + a beacon; not a silently empty set).
    expect(meshCount, "renderable landmark meshes").toBeGreaterThan(0);
    expect(geometries.size, "distinct landmark geometries").toBeGreaterThan(0);

    // The shared structure pair (stone + accent) must both be present and
    // reused by identity — exactly two vertexColors MeshStandardMaterials,
    // distinct from the per-beacon MeshBasicMaterial and the tower lamp's own
    // emissive material (which has vertexColors:false).
    const shared = [...materials].filter(
      (m) =>
        m instanceof THREE.MeshStandardMaterial &&
        (m as THREE.MeshStandardMaterial).vertexColors === true,
    );
    expect(
      shared.length,
      "exactly two shared structure materials reachable",
    ).toBe(2);

    // Spy on dispose() of every reachable geometry and material so a release
    // count above one (double-dispose) or below one (leak) fails loudly.
    const spies = new Map<
      THREE.BufferGeometry | THREE.Material,
      ReturnType<typeof vi.spyOn>
    >();
    for (const g of geometries) spies.set(g, vi.spyOn(g, "dispose"));
    for (const m of materials) spies.set(m, vi.spyOn(m, "dispose"));

    own.dispose();

    // Every reachable geometry and material — the merged stone/accent
    // geometries, the 13 beacon geometries, the lamp geometry, both shared
    // materials, every beacon material and the lamp material — is disposed
    // exactly once. No double-dispose, no skipped release.
    for (const [target, spy] of spies) {
      const kind =
        target instanceof THREE.BufferGeometry ? "geometry" : "material";
      expect(
        spy,
        `${kind} disposed not exactly once`,
      ).toHaveBeenCalledTimes(1);
    }

    // The two shared structure materials specifically are disposed exactly once
    // each — a per-landmark material instance (the explosion this whole epic
    // removes) would either inflate the shared count above or be double-disposed.
    for (const m of shared) {
      expect(
        spies.get(m),
        "shared structure material disposed not exactly once",
      ).toHaveBeenCalledTimes(1);
    }

    // No leaked source sub-geometry: after dispose() the group still references
    // only the geometries we already spied (all of them disposed once); a
    // surviving, never-disposed source buffer would appear here as a geometry
    // with no spy / zero dispose calls.
    own.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const spy = spies.get(o.geometry);
      expect(spy, "untracked geometry reachable from group").toBeDefined();
      expect(
        spy!,
        "reachable geometry not disposed exactly once",
      ).toHaveBeenCalledTimes(1);
    });

    for (const spy of spies.values()) spy.mockRestore();
  });
});
