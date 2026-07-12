import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { upgradeLandmarks, type ObjectGeometryLoader } from "./landmarksUpgrade.ts";
import { buildLandmarks } from "./landmarks.ts";
import { buildTerrain } from "./terrain.ts";
import { POI_ANCHORS } from "./worldConfig.ts";

// A fake, INDEXED, QUANTIZED (normalized Int16/Uint8) position/normal/color
// geometry — mirrors exactly what `floraGlb.ts`'s real parser hands back for
// a `KHR_mesh_quantization` primitive. Only a genuinely indexed AND quantized
// fixture exercises production code's real path: a real bug (caught via a
// live Playwright capture, not by an earlier version of this fixture that
// used plain non-normalized Float32Array attributes) only shows up then —
// `place()`'s `geo.applyMatrix4()` corrupts a still-normalized int16 store,
// and `mergeGeometries` refuses to merge mismatched typed-array classes (a
// quantized model geometry next to a procedural piece's plain Float32Array).
function fakeModelGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setIndex([0, 1, 2]);
  g.setAttribute(
    "position",
    new THREE.BufferAttribute(new Int16Array([0, 0, 0, 32767, 0, 0, 0, 32767, 0]), 3, true),
  );
  g.setAttribute(
    "normal",
    new THREE.BufferAttribute(new Int16Array([0, 32767, 0, 0, 32767, 0, 0, 32767, 0]), 3, true),
  );
  g.setAttribute(
    "color",
    new THREE.BufferAttribute(new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255, 255]), 3, true),
  );
  return g;
}

const fakeLoad: ObjectGeometryLoader = async () => fakeModelGeometry();

function build() {
  const terrain = buildTerrain();
  const landmarks = buildLandmarks(terrain);
  return landmarks;
}

async function drain() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe("upgradeLandmarks", () => {
  it("swaps the camp/canoe/ruin/remains sites once every model resolves, leaving overhang/figtree untouched", async () => {
    const landmarks = build();
    const before = new Map(landmarks.placed.map((p) => [p.poiId, p.object.children[0]]));

    upgradeLandmarks(landmarks, fakeLoad);
    await drain();

    for (const p of landmarks.placed) {
      const anchor = POI_ANCHORS.find((a) => a.poiId === p.poiId)!;
      const swapped = anchor.archetype === "camp" || anchor.archetype === "canoe" || anchor.archetype === "ruin" || anchor.archetype === "remains";
      if (swapped) {
        expect(p.object.children[0]).not.toBe(before.get(p.poiId));
      } else {
        expect(p.object.children[0]).toBe(before.get(p.poiId));
      }
    }
  });

  it("every upgraded site still merges into ≤2 meshes sharing the SAME 2 material instances (never a new material context)", async () => {
    const landmarks = build();
    upgradeLandmarks(landmarks, fakeLoad);
    await drain();

    for (const p of landmarks.placed) {
      const meshes: THREE.Mesh[] = [];
      p.object.traverse((o) => {
        if (o instanceof THREE.Mesh) meshes.push(o);
      });
      expect(meshes.length).toBeGreaterThanOrEqual(1);
      expect(meshes.length).toBeLessThanOrEqual(2);
      for (const m of meshes) {
        expect([landmarks.materials.stone, landmarks.materials.accent]).toContain(m.material);
        expect((m.geometry as THREE.BufferGeometry).getAttribute("color")).toBeTruthy();
        expect(m.castShadow).toBe(true);
      }
    }
  });

  it("the ruin site still gazes at the fig after the model swap (mixing model + procedural gaze-rig geometry doesn't break the merge)", async () => {
    const landmarks = build();
    upgradeLandmarks(landmarks, fakeLoad);
    await drain();

    const ruinAnchor = POI_ANCHORS.find((a) => a.archetype === "ruin")!;
    const ruin = landmarks.placed.find((p) => p.poiId === ruinAnchor.poiId)!;
    // A real mesh must exist (the historical bug this guards against: mixing
    // an indexed model geometry with non-indexed procedural pieces makes
    // `mergeGeometries` return null, silently dropping the whole stone mesh).
    let stoneMesh: THREE.Mesh | null = null;
    ruin.object.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material === landmarks.materials.stone) stoneMesh = o;
    });
    expect(stoneMesh).not.toBeNull();
  });

  it("dispose() before the load resolves cancels the swap (procedural sites survive)", async () => {
    const landmarks = build();
    const before = new Map(landmarks.placed.map((p) => [p.poiId, p.object.children[0]]));
    const handle = upgradeLandmarks(landmarks, fakeLoad);
    handle.dispose();
    await drain();

    for (const p of landmarks.placed) {
      expect(p.object.children[0]).toBe(before.get(p.poiId));
    }
  });

  it("keeps the procedural sites forever if a model fails to load, logging once", async () => {
    const landmarks = build();
    const before = new Map(landmarks.placed.map((p) => [p.poiId, p.object.children[0]]));
    const failingLoad: ObjectGeometryLoader = async (name) => {
      if (name === "canoe-hull") throw new Error("network error");
      return fakeModelGeometry();
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    upgradeLandmarks(landmarks, failingLoad);
    await drain();

    for (const p of landmarks.placed) {
      expect(p.object.children[0]).toBe(before.get(p.poiId));
    }
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("disposes every already-loaded geometry when one model fails partway through (no leak)", async () => {
    const disposeSpies: ReturnType<typeof vi.spyOn>[] = [];
    const trackingLoad: ObjectGeometryLoader = async (name) => {
      if (name === "ruin-debris") throw new Error("network error");
      const geo = fakeModelGeometry();
      disposeSpies.push(vi.spyOn(geo, "dispose"));
      return geo;
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const landmarks = build();
    upgradeLandmarks(landmarks, trackingLoad);
    await drain();

    expect(spy).toHaveBeenCalled();
    expect(disposeSpies.length).toBeGreaterThan(0);
    for (const d of disposeSpies) expect(d).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("dispose() after the swap releases the newly-built (swapped-in) geometries", async () => {
    const landmarks = build();
    const handle = upgradeLandmarks(landmarks, fakeLoad);
    await drain();

    // Only sites the upgrade actually swaps own geometry the upgrade's OWN
    // disposables track — overhang/figtree's geometry belongs to
    // `buildLandmarks`'s own closure and is released by `landmarks.dispose()`
    // instead, never by this handle.
    const swapped = new Set(["camp", "canoe", "ruin", "remains"]);
    const newGeometries: THREE.BufferGeometry[] = [];
    for (const p of landmarks.placed) {
      const anchor = POI_ANCHORS.find((a) => a.poiId === p.poiId)!;
      if (!swapped.has(anchor.archetype)) continue;
      p.object.traverse((o) => {
        if (o instanceof THREE.Mesh) newGeometries.push(o.geometry as THREE.BufferGeometry);
      });
    }
    expect(newGeometries.length).toBeGreaterThan(0);
    const spies = newGeometries.map((g) => vi.spyOn(g, "dispose"));
    handle.dispose();
    for (const s of spies) expect(s).toHaveBeenCalled();
  });
});
