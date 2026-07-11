import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  swapCategory,
  upgradeFlora,
  variantIndexOf,
  type GeometryLoader,
  type LoadedVariant,
} from "./floraUpgrade.ts";
import { buildTerrain } from "./terrain.ts";
import type { WindUniforms } from "./windSystem.ts";

describe("variantIndexOf", () => {
  it("always returns an index within [0, variantCount)", () => {
    for (let i = 0; i < 500; i++) {
      const v = variantIndexOf(i, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(3);
    }
  });

  it("is deterministic for the same (i, variantCount)", () => {
    expect(variantIndexOf(42, 2)).toBe(variantIndexOf(42, 2));
  });

  it("splits a large index range roughly evenly across 2 variants", () => {
    let a = 0;
    let b = 0;
    for (let i = 0; i < 2000; i++) {
      if (variantIndexOf(i, 2) === 0) a++;
      else b++;
    }
    // Not a strict 50/50, but neither side should collapse.
    expect(a).toBeGreaterThan(600);
    expect(b).toBeGreaterThan(600);
  });
});

/** A fake merged, vertex-coloured flora geometry — enough attributes for
 *  `THREE.InstancedMesh` to construct without a real GLB. */
function fakeVariant(maxHeight: number): LoadedVariant {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]), 3));
  return { geometry, maxHeight };
}

/** A fake procedural `InstancedMesh` at `count` distinct translations, mirroring
 *  what `props.ts` would have built at those indices. */
function fakeProceduralMesh(name: string, count: number): THREE.InstancedMesh {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial();
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.name = name;
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    m.makeTranslation(i, 0, i * 2);
    mesh.setMatrixAt(i, m);
  }
  mesh.count = count;
  return mesh;
}

describe("swapCategory", () => {
  it("replaces the old mesh(es) with one InstancedMesh per variant, preserving every transform", () => {
    const group = new THREE.Group();
    const oldTrunk = fakeProceduralMesh("canopy-trunk", 10);
    const oldCross = fakeProceduralMesh("canopy-cross", 10);
    group.add(oldTrunk, oldCross);

    const variants = [fakeVariant(9.8), fakeVariant(9.8)];
    swapCategory(group, [oldTrunk, oldCross], oldTrunk, variants, {
      namePrefix: "canopy-model",
      castShadow: true,
    });

    // Old meshes removed.
    expect(group.children.includes(oldTrunk)).toBe(false);
    expect(group.children.includes(oldCross)).toBe(false);

    // New meshes added, one per variant, both cast shadows.
    const newMeshes = group.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh);
    expect(newMeshes.length).toBe(2);
    for (const mesh of newMeshes) expect(mesh.castShadow).toBe(true);

    // Every original transform survives somewhere across the split meshes.
    const survived = new Set<string>();
    for (const mesh of newMeshes) {
      const m = new THREE.Matrix4();
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        survived.add(m.toArray().map((n) => n.toFixed(3)).join(","));
      }
    }
    const mOld = new THREE.Matrix4();
    for (let i = 0; i < oldTrunk.count; i++) {
      oldTrunk.getMatrixAt(i, mOld);
      expect(survived.has(mOld.toArray().map((n) => n.toFixed(3)).join(","))).toBe(true);
    }
    // Total instance count across variants equals the original count.
    expect(newMeshes.reduce((sum, m) => sum + m.count, 0)).toBe(10);
  });

  it("attaches a wind patch only when requested", () => {
    const group = new THREE.Group();
    const old = fakeProceduralMesh("understory", 4);
    group.add(old);
    const windUniforms: WindUniforms = { uTime: { value: 0 } };

    swapCategory(group, [old], old, [fakeVariant(1.2)], {
      namePrefix: "understory-model",
      castShadow: false,
      wind: { strength: 0.15, uniforms: windUniforms },
    });
    const withWind = group.children.find((c) => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
    expect(typeof (withWind.material as THREE.Material).onBeforeCompile).toBe("function");

    const group2 = new THREE.Group();
    const old2 = fakeProceduralMesh("rocks", 4);
    group2.add(old2);
    swapCategory(group2, [old2], old2, [fakeVariant(1.6)], { namePrefix: "rock-model", castShadow: true });
    const noWind = group2.children.find((c) => c instanceof THREE.InstancedMesh) as THREE.InstancedMesh;
    // No wind patch requested: onBeforeCompile stays three's default no-op.
    expect((noWind.material as THREE.Material).onBeforeCompile).toEqual(expect.any(Function));
    expect((noWind.material as THREE.Material).customProgramCacheKey().length).toBeGreaterThanOrEqual(0);
  });

  it("is a no-op when the source mesh is missing (nothing to swap)", () => {
    const group = new THREE.Group();
    expect(() => swapCategory(group, [], undefined, [fakeVariant(1)], { namePrefix: "x", castShadow: false })).not.toThrow();
    expect(group.children.length).toBe(0);
  });

  it("dispose() removes the new meshes and releases their resources", () => {
    const group = new THREE.Group();
    const old = fakeProceduralMesh("rocks", 3);
    group.add(old);
    const handle = swapCategory(group, [old], old, [fakeVariant(1.6)], { namePrefix: "rock-model", castShadow: true });
    expect(group.children.length).toBe(1);
    handle.dispose();
    expect(group.children.length).toBe(0);
  });
});

describe("upgradeFlora", () => {
  const terrain = buildTerrain();

  function buildFakeProps(): THREE.Group {
    const group = new THREE.Group();
    group.add(
      fakeProceduralMesh("canopy-trunk", 20),
      fakeProceduralMesh("canopy-cross", 20),
      fakeProceduralMesh("palm-trunk", 6),
      fakeProceduralMesh("palm-frond", 6),
      fakeProceduralMesh("understory", 15),
      fakeProceduralMesh("rocks", 8),
    );
    return group;
  }

  const fakeLoad: GeometryLoader = async (name) => fakeVariant(name.includes("canopy") ? 9.8 : name.includes("palm") ? 6.5 : name.includes("rock") ? 1.6 : 1.2);

  it("swaps every category and adds the grass layer once the loads resolve", async () => {
    const group = buildFakeProps();
    const windUniforms: WindUniforms = { uTime: { value: 0 } };
    upgradeFlora(group, terrain, 1, windUniforms, fakeLoad);

    // Let the microtask queue (Promise.all + the async IIFE) drain.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(group.getObjectByName("canopy-trunk")).toBeUndefined();
    expect(group.getObjectByName("canopy-cross")).toBeUndefined();
    expect(group.getObjectByName("palm-trunk")).toBeUndefined();
    expect(group.getObjectByName("understory")).toBeUndefined();
    expect(group.getObjectByName("rocks")).toBeUndefined();
    expect(group.getObjectByName("grass")).toBeDefined();
  });

  it("dispose() before the load resolves cancels the swap (procedural props survive)", async () => {
    const group = buildFakeProps();
    const windUniforms: WindUniforms = { uTime: { value: 0 } };
    const handle = upgradeFlora(group, terrain, 1, windUniforms, fakeLoad);
    handle.dispose();

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // The cancelled load must never have touched the procedural meshes.
    expect(group.getObjectByName("canopy-trunk")).toBeDefined();
    expect(group.getObjectByName("rocks")).toBeDefined();
    expect(group.getObjectByName("grass")).toBeUndefined();
  });

  it("keeps the procedural props forever if a model fails to load, logging once", async () => {
    const group = buildFakeProps();
    const windUniforms: WindUniforms = { uTime: { value: 0 } };
    const failingLoad: GeometryLoader = async (name) => {
      if (name === "canopy-b") throw new Error("network error");
      return fakeLoad(name);
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    upgradeFlora(group, terrain, 1, windUniforms, failingLoad);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(group.getObjectByName("canopy-trunk")).toBeDefined();
    expect(group.getObjectByName("grass")).toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
