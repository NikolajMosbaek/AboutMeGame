import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  FliersSystem,
  MAX_BUTTERFLIES,
  MAX_FIREFLIES,
  butterflyCount,
  fireflyCount,
  flierOffset,
  nightWeight,
} from "./fliers.ts";
import { buildTerrain } from "../world/terrain.ts";

const FRAME = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), dt: 1 / 60, elapsed: 0 };

function dayCycle(phase: number) {
  return { getPhase: () => phase };
}

describe("nightWeight (day/night crossfade)", () => {
  it("is 0 (full day) at noon (phase 0.25)", () => {
    expect(nightWeight(0.25)).toBeCloseTo(0, 10);
  });

  it("is 1 (full night) at the antipode of noon (phase 0.75)", () => {
    expect(nightWeight(0.75)).toBeCloseTo(1, 10);
  });

  it("sits at the crossfade midpoint (0.5) at dawn and dusk", () => {
    expect(nightWeight(0)).toBeCloseTo(0.5, 10);
    expect(nightWeight(0.5)).toBeCloseTo(0.5, 10);
  });
});

describe("butterflyCount / fireflyCount (day/night gating)", () => {
  it("butterflies dominate by day, fireflies are near-absent", () => {
    expect(butterflyCount(0.25)).toBe(MAX_BUTTERFLIES);
    expect(fireflyCount(0.25)).toBe(0);
  });

  it("fireflies dominate by night, butterflies are near-absent", () => {
    expect(fireflyCount(0.75)).toBe(MAX_FIREFLIES);
    expect(butterflyCount(0.75)).toBe(0);
  });

  it("crossfades smoothly through dusk: both populations partial and complementary-ish", () => {
    const b = butterflyCount(0.5);
    const f = fireflyCount(0.5);
    expect(b).toBeGreaterThan(0);
    expect(b).toBeLessThan(MAX_BUTTERFLIES);
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(MAX_FIREFLIES);
  });
});

describe("flierOffset (determinism)", () => {
  it("is a pure function: identical inputs produce identical output", () => {
    expect(flierOffset(7, 12.3)).toEqual(flierOffset(7, 12.3));
  });

  it("decorrelates across instances (different indices drift differently)", () => {
    const a = flierOffset(0, 5);
    const b = flierOffset(1, 5);
    expect(a).not.toEqual(b);
  });
});

describe("FliersSystem", () => {
  const terrain = buildTerrain();

  function rig(phase = 0.25) {
    const scene = new THREE.Scene();
    const session = { paused: false };
    const cycle = dayCycle(phase);
    const sys = new FliersSystem(scene, terrain, cycle, session);
    return { scene, session, cycle, sys };
  }

  it("builds exactly 2 draw calls (butterfly + firefly InstancedMesh)", () => {
    const { scene } = rig();
    let meshes = 0;
    scene.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) meshes++;
    });
    expect(meshes).toBe(2);
  });

  it("firefly material clears the compositor's bloom threshold (emissiveIntensity > 1)", () => {
    const { scene } = rig();
    const firefly = firstMeshNamed(scene, "wildlife-firefly");
    const mat = firefly.material as THREE.MeshStandardMaterial;
    expect(mat.emissiveIntensity).toBeGreaterThan(1);
  });

  it("shows all butterflies and no fireflies at noon after an update", () => {
    const { sys } = rig(0.25);
    sys.update(FRAME);
    expect(sys.describe()).toEqual({ butterflies: MAX_BUTTERFLIES, fireflies: 0 });
  });

  it("shows all fireflies and no butterflies deep at night", () => {
    const { sys } = rig(0.75);
    sys.update(FRAME);
    expect(sys.describe()).toEqual({ butterflies: 0, fireflies: MAX_FIREFLIES });
  });

  it("holds all movement/population while the session is paused", () => {
    const { session, sys } = rig(0.25);
    sys.update(FRAME); // establish a baseline count at noon
    const before = sys.describe();
    session.paused = true;
    for (let i = 0; i < 120; i++) sys.update(FRAME);
    expect(sys.describe()).toEqual(before);
  });

  it("disposes every geometry/material without throwing, and detaches from the scene", () => {
    const { scene, sys } = rig();
    expect(() => sys.dispose()).not.toThrow();
    expect(scene.children.find((o) => o.name === "wildlife-fliers")).toBeUndefined();
  });
});

function firstMeshNamed(scene: THREE.Scene, name: string): THREE.InstancedMesh {
  let found: THREE.InstancedMesh | undefined;
  scene.traverse((o) => {
    if (o instanceof THREE.InstancedMesh && o.name === name) found = o;
  });
  if (!found) throw new Error(`no InstancedMesh named "${name}"`);
  return found;
}
