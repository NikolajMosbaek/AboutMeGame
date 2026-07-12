import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { buildTreasure } from "./buildTreasure.ts";
import { buildLandmarks } from "../world/landmarks.ts";
import { buildTerrain } from "../world/terrain.ts";

function build() {
  const terrain = buildTerrain();
  const landmarks = buildLandmarks(terrain);
  const treasure = buildTreasure(landmarks);
  return { landmarks, treasure };
}

describe("buildTreasure", () => {
  it("mounts a hidden group at the fig site's dig patch, matching its world position", () => {
    const { landmarks, treasure } = build();
    const fig = landmarks.placed.find((p) => p.poiId === "site-ancient-fig")!;
    const group = fig.object.children.find((c) => c.name === "treasure")!;
    expect(group).toBeTruthy();
    expect(group.visible).toBe(false);

    // The dig point is the fig site's local (2.9, 0, 2.9) soil patch,
    // transformed to world space by the site's own matrix — the same
    // transform `buildTreasure` uses internally.
    fig.object.updateMatrixWorld(true);
    const expected = new THREE.Vector3(2.9, 0, 2.9).applyMatrix4(fig.object.matrixWorld);
    expect(treasure.digPoint.x).toBeCloseTo(expected.x, 4);
    expect(treasure.digPoint.z).toBeCloseTo(expected.z, 4);
  });

  it("reveal() is idempotent and makes the treasure visible", () => {
    const { landmarks, treasure } = build();
    const fig = landmarks.placed.find((p) => p.poiId === "site-ancient-fig")!;
    const group = fig.object.children.find((c) => c.name === "treasure")!;
    treasure.reveal();
    expect(group.visible).toBe(true);
    treasure.reveal();
    expect(group.visible).toBe(true);
  });

  it("the idol is a real carved-statue silhouette: several parts, ALL sharing one emissive material setIdolEmissive drives", () => {
    const { landmarks, treasure } = build();
    const fig = landmarks.placed.find((p) => p.poiId === "site-ancient-fig")!;
    const group = fig.object.children.find((c) => c.name === "treasure")!;
    const idol = group.children.find((c) => c instanceof THREE.Group) as THREE.Group;
    expect(idol).toBeTruthy();
    const idolMeshes = idol.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    // More than the old 3-primitive stack (base/body/head) — a genuine
    // multi-part statue silhouette (plinth, riser, body, arms, collar, head,
    // crown).
    expect(idolMeshes.length).toBeGreaterThanOrEqual(6);

    const materials = new Set(idolMeshes.map((m) => m.material));
    expect(materials.size).toBe(1);
    const idolMat = [...materials][0] as THREE.MeshStandardMaterial;
    expect(idolMat.emissive.getHex()).toBe(0x9fe6b0);
    expect(idolMat.emissiveIntensity).toBeCloseTo(1.1);

    treasure.setIdolEmissive(2.5);
    expect(idolMat.emissiveIntensity).toBe(2.5);
    for (const m of idolMeshes) expect(m.castShadow).toBe(true);
  });

  it("the idol's whole envelope stays inside the chest's footprint (still reads as 'in the chest')", () => {
    const { landmarks } = build();
    const fig = landmarks.placed.find((p) => p.poiId === "site-ancient-fig")!;
    const group = fig.object.children.find((c) => c.name === "treasure")!;
    const idol = group.children.find((c) => c instanceof THREE.Group) as THREE.Group;
    const box = new THREE.Box3().setFromObject(idol);
    const size = new THREE.Vector3();
    box.getSize(size);
    // The chest base is 1.2 x 0.7 x 0.8 — the idol's footprint must fit well
    // within that, and its height must stay modest (not towering out of a
    // half-open chest).
    expect(size.x).toBeLessThan(0.6);
    expect(size.z).toBeLessThan(0.6);
    expect(size.y).toBeLessThan(0.9);
  });

  it("the chest reads as iron-bound: corner straps + a latch, in the trim material, alongside the base/lid/band", () => {
    const { landmarks } = build();
    const fig = landmarks.placed.find((p) => p.poiId === "site-ancient-fig")!;
    const group = fig.object.children.find((c) => c.name === "treasure")!;
    const meshes = group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    // base, lid, band, strapL, strapR, latch.
    expect(meshes.length).toBe(6);
    for (const m of meshes) {
      expect(m.castShadow).toBe(true);
      expect(m.receiveShadow).toBe(true);
    }
  });

  it("dispose() releases every material and geometry", () => {
    const { landmarks, treasure } = build();
    const fig = landmarks.placed.find((p) => p.poiId === "site-ancient-fig")!;
    const group = fig.object.children.find((c) => c.name === "treasure")!;
    const geoSpies: ReturnType<typeof vi.spyOn>[] = [];
    const matSpies = new Map<THREE.Material, ReturnType<typeof vi.spyOn>>();
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        geoSpies.push(vi.spyOn(o.geometry, "dispose"));
        const mat = o.material as THREE.Material;
        if (!matSpies.has(mat)) matSpies.set(mat, vi.spyOn(mat, "dispose"));
      }
    });
    expect(geoSpies.length).toBeGreaterThan(0);
    treasure.dispose();
    for (const s of geoSpies) expect(s).toHaveBeenCalled();
    for (const [, s] of matSpies) expect(s).toHaveBeenCalled();
  });
});
