import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { buildBoundaries } from "./boundaries.ts";

// T7 — Boundaries.dispose() lifecycle (G1 slice 2, #116, AC6).
//
// dispose() must release every GPU resource buildBoundaries created and create
// no per-frame work: the water geometry and material always, plus — for the
// foam variant (heightAt supplied) — the baked ground-height DataTexture. The
// no-heightAt build owns no texture, so it disposes geometry + material only
// and must not throw on the absent `groundTex?.dispose()`.
//
// jsdom has no WebGL, so we spy directly on the dispose methods of the actual
// instances buildBoundaries created (reached through the water mesh and the
// material's userData handle) and assert each is called EXACTLY once.

const stubHeightAt = (x: number, z: number) => 3 - 0.01 * (x * x + z * z) ** 0.5;

/** The single Mesh named "water" inside a boundaries group. */
function waterMesh(group: THREE.Group): THREE.Mesh {
  const found = group.children.filter(
    (o): o is THREE.Mesh => o instanceof THREE.Mesh && o.name === "water",
  );
  expect(found).toHaveLength(1);
  return found[0];
}

describe("Boundaries.dispose() (T7, AC6)", () => {
  it("foam build disposes geometry, material and the ground texture exactly once", () => {
    const b = buildBoundaries(stubHeightAt);
    const water = waterMesh(b.group);
    const geo = water.geometry as THREE.BufferGeometry;
    const mat = water.material as THREE.MeshStandardMaterial;
    const tex = mat.userData.groundHeightTexture as THREE.DataTexture | undefined;
    expect(tex).toBeInstanceOf(THREE.DataTexture);

    const geoDispose = vi.spyOn(geo, "dispose");
    const matDispose = vi.spyOn(mat, "dispose");
    const texDispose = vi.spyOn(tex!, "dispose");

    b.dispose();

    expect(geoDispose).toHaveBeenCalledTimes(1);
    expect(matDispose).toHaveBeenCalledTimes(1);
    expect(texDispose).toHaveBeenCalledTimes(1);
  });

  it("no-heightAt build disposes geometry + material with no texture and does not throw", () => {
    const b = buildBoundaries();
    const water = waterMesh(b.group);
    const geo = water.geometry as THREE.BufferGeometry;
    const mat = water.material as THREE.MeshStandardMaterial;

    // No ground texture is baked when heightAt is absent.
    expect(mat.userData.groundHeightTexture).toBeUndefined();

    const geoDispose = vi.spyOn(geo, "dispose");
    const matDispose = vi.spyOn(mat, "dispose");

    expect(() => b.dispose()).not.toThrow();

    expect(geoDispose).toHaveBeenCalledTimes(1);
    expect(matDispose).toHaveBeenCalledTimes(1);
  });
});
