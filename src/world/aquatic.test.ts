import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  buildAquatic,
  KELP_COUNT,
  LILY_COUNT,
  KELP_MIN_DEPTH,
  LILY_MIN_DEPTH,
  LILY_MAX_DEPTH,
} from "./aquatic.ts";
import { buildTerrain } from "./terrain.ts";
import { LAGOON, WORLD } from "./worldConfig.ts";
import type { FrameContext } from "../engine/types.ts";

const terrain = buildTerrain();
const depthAt = (x: number, z: number) => WORLD.seaLevel - terrain.heightAt(x, z);
const inLagoonZone = (x: number, z: number) =>
  Math.hypot(x - LAGOON.x, z - LAGOON.z) < LAGOON.radius + LAGOON.shoreRamp;

function frame(dt = 1 / 60): FrameContext {
  return { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), dt, elapsed: 0 };
}

function instanceXZ(mesh: THREE.InstancedMesh, i: number): { x: number; y: number; z: number } {
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  mesh.getMatrixAt(i, m);
  m.decompose(p, q, s);
  return { x: p.x, y: p.y, z: p.z };
}

describe("buildAquatic (#184)", () => {
  it("stays within the draw-call budget: at most 3 meshes, all instanced", () => {
    const aquatic = buildAquatic(terrain);
    expect(aquatic.group.children.length).toBeLessThanOrEqual(3);
    for (const child of aquatic.group.children) {
      expect(child).toBeInstanceOf(THREE.InstancedMesh);
    }
    aquatic.dispose();
  });

  it("places every kelp strand inside the lagoon zone, in water deeper than 1 m, rooted on the bed", () => {
    const aquatic = buildAquatic(terrain);
    const kelp = aquatic.group.getObjectByName("aquatic-kelp") as THREE.InstancedMesh;
    expect(kelp.count).toBeGreaterThan(KELP_COUNT * 0.5); // the lagoon holds a real bed
    expect(kelp.count).toBeLessThanOrEqual(KELP_COUNT);
    for (let i = 0; i < kelp.count; i++) {
      const p = instanceXZ(kelp, i);
      expect(inLagoonZone(p.x, p.z)).toBe(true);
      expect(depthAt(p.x, p.z)).toBeGreaterThan(KELP_MIN_DEPTH);
      expect(p.y).toBeCloseTo(terrain.heightAt(p.x, p.z), 3);
    }
    aquatic.dispose();
  });

  it("places lily pads at the lagoon edge (0.3–1 m of water) floating at sea level", () => {
    const aquatic = buildAquatic(terrain);
    const lily = aquatic.group.getObjectByName("aquatic-lily") as THREE.InstancedMesh;
    expect(lily.count).toBeGreaterThan(LILY_COUNT * 0.5);
    expect(lily.count).toBeLessThanOrEqual(LILY_COUNT);
    for (let i = 0; i < lily.count; i++) {
      const p = instanceXZ(lily, i);
      expect(inLagoonZone(p.x, p.z)).toBe(true);
      const d = depthAt(p.x, p.z);
      expect(d).toBeGreaterThanOrEqual(LILY_MIN_DEPTH);
      expect(d).toBeLessThanOrEqual(LILY_MAX_DEPTH);
      expect(p.y).toBeCloseTo(WORLD.seaLevel + 0.02, 3);
    }
    aquatic.dispose();
  });

  it("is deterministic: two builds produce identical instance matrices", () => {
    const a = buildAquatic(terrain);
    const b = buildAquatic(terrain);
    const ka = a.group.getObjectByName("aquatic-kelp") as THREE.InstancedMesh;
    const kb = b.group.getObjectByName("aquatic-kelp") as THREE.InstancedMesh;
    expect(ka.count).toBe(kb.count);
    expect(Array.from(ka.instanceMatrix.array)).toEqual(Array.from(kb.instanceMatrix.array));
    a.dispose();
    b.dispose();
  });

  it("sways the kelp over time, but holds perfectly still under reduced motion", () => {
    const swaying = buildAquatic(terrain);
    const sys = swaying.sway({ getSnapshot: () => ({ reducedMotion: false }) });
    const kelp = swaying.group.getObjectByName("aquatic-kelp") as THREE.InstancedMesh;
    const before = Array.from(kelp.instanceMatrix.array);
    for (let i = 0; i < 30; i++) sys.update(frame());
    expect(Array.from(kelp.instanceMatrix.array)).not.toEqual(before);
    swaying.dispose();

    const still = buildAquatic(terrain);
    const stillSys = still.sway({ getSnapshot: () => ({ reducedMotion: true }) });
    const stillKelp = still.group.getObjectByName("aquatic-kelp") as THREE.InstancedMesh;
    const stillBefore = Array.from(stillKelp.instanceMatrix.array);
    for (let i = 0; i < 30; i++) stillSys.update(frame());
    expect(Array.from(stillKelp.instanceMatrix.array)).toEqual(stillBefore);
    still.dispose();
  });

  it("dispose() releases every geometry and material", () => {
    const aquatic = buildAquatic(terrain);
    const disposed: string[] = [];
    for (const child of aquatic.group.children) {
      const mesh = child as THREE.InstancedMesh;
      mesh.geometry.addEventListener("dispose", () => disposed.push(`${child.name}-geo`));
      (mesh.material as THREE.Material).addEventListener("dispose", () =>
        disposed.push(`${child.name}-mat`),
      );
    }
    aquatic.dispose();
    expect(disposed.sort()).toEqual([
      "aquatic-kelp-geo",
      "aquatic-kelp-mat",
      "aquatic-lily-geo",
      "aquatic-lily-mat",
    ]);
  });
});
