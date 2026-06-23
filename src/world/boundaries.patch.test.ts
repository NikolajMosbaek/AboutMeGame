import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildBoundaries } from "./boundaries.ts";
import { WORLD } from "./worldConfig.ts";

// T6 — the DI seam + onBeforeCompile wiring on the existing water plane (G1
// slice 2). `buildBoundaries(heightAt?)` is an optional dependency-injection
// seam: when `heightAt` is present it bakes the ground-height DataTexture, sets
// the LINEAR palette + foam uniforms, and attaches the HAS_FOAM water patch;
// when absent it attaches the no-foam patch. EITHER way the water stays exactly
// ONE PlaneGeometry / one mesh / one draw call at `seaLevel - 0.05`, and the
// bounds maths is untouched.
//
// jsdom has no WebGL, so onBeforeCompile is never invoked by a real renderer
// here — we assert it is attached as a function and that the cache key is set,
// leaving the GLSL transcription itself to waterPatch.test.ts (which runs it
// against the real THREE.ShaderLib source).

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** Find the single Mesh named "water" inside a boundaries group. */
function waterMesh(group: THREE.Group): THREE.Mesh {
  const found = group.children.filter(
    (o): o is THREE.Mesh => o instanceof THREE.Mesh && o.name === "water",
  );
  expect(found).toHaveLength(1);
  return found[0];
}

/** Index/position triangle count of a mesh's geometry. */
function triangleCount(mesh: THREE.Mesh): number {
  const geo = mesh.geometry as THREE.BufferGeometry;
  const index = geo.getIndex();
  const verts = index ? index.count : geo.getAttribute("position").count;
  return verts / 3;
}

const stubHeightAt = (x: number, z: number) => 3 - 0.01 * (x * x + z * z) ** 0.5;

describe("buildBoundaries — DI seam + water patch (T6)", () => {
  it("keeps exactly one water mesh at seaLevel-0.05 with no args (back-compat)", () => {
    const b = buildBoundaries();
    const water = waterMesh(b.group);
    expect(water.position.y).toBe(WORLD.seaLevel - 0.05);
    b.dispose();
  });

  it("with heightAt: still exactly one water mesh, same triangle count, same y", () => {
    const plain = buildBoundaries();
    const patched = buildBoundaries(stubHeightAt);

    const plainWater = waterMesh(plain.group);
    const patchedWater = waterMesh(patched.group);

    // One PlaneGeometry, one mesh, triangles ±0 vs the no-arg build.
    expect(triangleCount(patchedWater)).toBe(triangleCount(plainWater));
    expect(patchedWater.position.y).toBe(WORLD.seaLevel - 0.05);
    expect(patchedWater.position.y).toBe(plainWater.position.y);

    plain.dispose();
    patched.dispose();
  });

  it("attaches onBeforeCompile and customProgramCacheKey, foam key differs from no-foam (AC8)", () => {
    const foam = buildBoundaries(stubHeightAt);
    const noFoam = buildBoundaries();
    const foamMat = waterMesh(foam.group).material as THREE.MeshStandardMaterial;
    const noFoamMat = waterMesh(noFoam.group).material as THREE.MeshStandardMaterial;

    expect(typeof foamMat.onBeforeCompile).toBe("function");
    expect(typeof foamMat.customProgramCacheKey).toBe("function");
    expect(typeof foamMat.customProgramCacheKey!()).toBe("string");

    // Distinct constant keys so the two patched-water programs never collide in
    // three's shader cache.
    expect(foamMat.customProgramCacheKey!()).not.toBe(
      noFoamMat.customProgramCacheKey!(),
    );

    foam.dispose();
    noFoam.dispose();
  });

  it("attaches the no-foam patch when heightAt is absent (safe degradation, AC8)", () => {
    const b = buildBoundaries();
    const mat = waterMesh(b.group).material as THREE.MeshStandardMaterial;
    expect(typeof mat.onBeforeCompile).toBe("function");
    expect(typeof mat.customProgramCacheKey).toBe("function");
    b.dispose();
  });

  it("leaves the bounds maths unchanged across both seams (AC7)", () => {
    for (const b of [buildBoundaries(), buildBoundaries(stubHeightAt)]) {
      expect(b.isInBounds(0, 0)).toBe(true);
      expect(b.isInBounds(WORLD.boundaryRadius - 1, 0)).toBe(true);
      expect(b.isInBounds(WORLD.boundaryRadius + 5, 0)).toBe(false);

      const p = new THREE.Vector3(WORLD.boundaryRadius + 50, 10, 0);
      b.clampToBounds(p);
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(WORLD.boundaryRadius, 3);
      expect(p.y).toBe(10);
      b.dispose();
    }
  });

  it("dispose() releases geometry, material and (foam) the ground texture (AC6)", () => {
    const b = buildBoundaries(stubHeightAt);
    const mat = waterMesh(b.group).material as THREE.MeshStandardMaterial;
    const tex = mat.userData.groundHeightTexture as THREE.DataTexture | undefined;
    expect(tex).toBeInstanceOf(THREE.DataTexture);

    let texDisposed = false;
    tex!.addEventListener("dispose", () => (texDisposed = true));
    let matDisposed = false;
    mat.addEventListener("dispose", () => (matDisposed = true));

    b.dispose();
    expect(matDisposed).toBe(true);
    expect(texDisposed).toBe(true);
  });

  // AC1 grep guard: boundaries.ts must NOT re-declare the centralised palette
  // hex or inline foam-edge literals — it consumes waterSurface.ts via the
  // uniforms transport instead.
  it("re-declares no centralised palette hex / foam-edge literal in boundaries.ts (AC1)", () => {
    const src = readFileSync(join(MODULE_DIR, "boundaries.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    expect(src).not.toMatch(/0x2e6f9e/i);
    expect(src).not.toMatch(/0x193d57/i);
    // It imports and uses the single-source symbols.
    expect(src).toMatch(/from\s+["']\.\/waterUniforms\.ts["']/);
  });
});
