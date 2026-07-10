import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { buildTerrain } from "./terrain.ts";
import { buildLandmarks } from "./landmarks.ts";
import { POI_ANCHORS } from "./worldConfig.ts";

// The Lost Idol sites (pivot slice C): each anchor gets a grounded prop
// cluster merged into at most ONE stone mesh + ONE accent mesh (two shared
// materials for the whole set), no sky-beacons, no per-site material
// explosion. The clue chain depends on one piece of world truth pinned here:
// the ruin's fallen head gazes at the fig.

function build() {
  const terrain = buildTerrain();
  const landmarks = buildLandmarks(terrain);
  return { terrain, landmarks };
}

describe("expedition sites (buildLandmarks)", () => {
  it("places all 6 sites at their anchors, on the terrain", () => {
    const { terrain, landmarks } = build();
    expect(landmarks.placed).toHaveLength(POI_ANCHORS.length);
    for (const p of landmarks.placed) {
      const anchor = POI_ANCHORS.find((a) => a.poiId === p.poiId)!;
      expect(anchor).toBeTruthy();
      expect(p.position.x).toBe(anchor.x);
      expect(p.position.z).toBe(anchor.z);
      // Site base sits at (or just above) the sampled ground height.
      const ground = terrain.heightAt(anchor.x, anchor.z);
      expect(p.position.y).toBeGreaterThanOrEqual(Math.min(ground, 0.2) - 1e-9);
      expect(p.position.y).toBeCloseTo(Math.max(ground, 0.2), 5);
    }
  });

  it("names each site group landmark:<poiId> inside a group named landmarks", () => {
    const { landmarks } = build();
    expect(landmarks.group.name).toBe("landmarks");
    for (const p of landmarks.placed) {
      expect(p.object.name).toBe(`landmark:${p.poiId}`);
      expect(landmarks.group.children).toContain(p.object);
    }
  });

  it("keeps every site within the merged-geometry budget: ≤2 meshes, 2 shared materials, no beacons", () => {
    const { landmarks } = build();
    const materials = new Set<THREE.Material>();
    for (const p of landmarks.placed) {
      const meshes: THREE.Mesh[] = [];
      p.object.traverse((o) => {
        if (o instanceof THREE.Mesh) meshes.push(o);
        expect(o.name).not.toBe("beacon"); // the sky-beacons are gone
      });
      expect(meshes.length, `${p.poiId} mesh count`).toBeGreaterThanOrEqual(1);
      expect(meshes.length, `${p.poiId} mesh count`).toBeLessThanOrEqual(2);
      for (const m of meshes) {
        materials.add(m.material as THREE.Material);
        // The palette rides per-vertex colour over the shared materials.
        expect((m.geometry as THREE.BufferGeometry).getAttribute("color")).toBeTruthy();
        expect(m.castShadow).toBe(true);
      }
    }
    // Two shared materials across the entire site set (stone + accent).
    expect(materials.size).toBe(2);
  });

  it("keeps a genuine bloom source: the shared accent material emits ≥ the compositor threshold", () => {
    // The beacons/tower-lamp that used to clear the 0.85 bloom threshold died
    // with the pivot; the site accents (page, carvings, eyes) are the scene's
    // emissive sources now. Pin material intensity × the palest accent hue
    // above the threshold so bloom can never silently become a paid no-op.
    const { landmarks } = build();
    let accentMat: THREE.MeshStandardMaterial | null = null;
    let maxLuma = 0;
    landmarks.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = o.material as THREE.MeshStandardMaterial;
      if (m.emissiveIntensity > 0 && m.emissive.getHex() === 0xffffff) {
        accentMat = m;
        const colors = (o.geometry as THREE.BufferGeometry).getAttribute("color");
        for (let i = 0; i < colors.count; i++) {
          const luma =
            0.2126 * colors.getX(i) + 0.7152 * colors.getY(i) + 0.0722 * colors.getZ(i);
          maxLuma = Math.max(maxLuma, luma);
        }
      }
    });
    expect(accentMat).not.toBeNull();
    // Emissive contribution = vertex colour luma × emissiveIntensity.
    expect(maxLuma * accentMat!.emissiveIntensity).toBeGreaterThan(0.85);
  });

  it("aims the ruin's gaze at the fig (clue 5's 'sight along the eyes' is true)", () => {
    const { landmarks } = build();
    const ruinAnchor = POI_ANCHORS.find((a) => a.archetype === "ruin")!;
    const figAnchor = POI_ANCHORS.find((a) => a.archetype === "figtree")!;
    const ruin = landmarks.placed.find((p) => p.poiId === ruinAnchor.poiId)!;
    // The head gazes along the site's local +Z; the group yaw must rotate that
    // onto the direction from ruin to fig.
    const gaze = new THREE.Vector3(0, 0, 1).applyEuler(
      new THREE.Euler(0, (ruin.object as THREE.Group).rotation.y, 0),
    );
    const toFig = new THREE.Vector3(
      figAnchor.x - ruinAnchor.x,
      0,
      figAnchor.z - ruinAnchor.z,
    ).normalize();
    expect(gaze.dot(toFig)).toBeGreaterThan(0.999);
  });

  it("dispose() disposes the shared materials and every merged geometry", () => {
    const { landmarks } = build();
    const geoSpies: Array<ReturnType<typeof vi.spyOn>> = [];
    const matSpies = new Map<THREE.Material, ReturnType<typeof vi.spyOn>>();
    landmarks.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        geoSpies.push(vi.spyOn(o.geometry, "dispose"));
        const mat = o.material as THREE.Material;
        if (!matSpies.has(mat)) matSpies.set(mat, vi.spyOn(mat, "dispose"));
      }
    });
    expect(geoSpies.length).toBeGreaterThan(0);
    landmarks.dispose();
    for (const s of geoSpies) expect(s).toHaveBeenCalled();
    for (const [, s] of matSpies) expect(s).toHaveBeenCalled();
  });

  it("is deterministic: two builds place identical sites", () => {
    const a = build().landmarks;
    const b = build().landmarks;
    for (let i = 0; i < a.placed.length; i++) {
      expect(a.placed[i].poiId).toBe(b.placed[i].poiId);
      expect(a.placed[i].position).toEqual(b.placed[i].position);
      expect((a.placed[i].object as THREE.Group).rotation.y).toBe(
        (b.placed[i].object as THREE.Group).rotation.y,
      );
    }
  });
});
