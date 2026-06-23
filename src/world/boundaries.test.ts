import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildBoundaries, WATER_SEGMENTS } from "./boundaries.ts";
import { WORLD } from "./worldConfig.ts";

/** Find the single Mesh named "water" inside a boundaries group. */
function waterMesh(group: THREE.Group): THREE.Mesh {
  const found = group.children.filter(
    (o): o is THREE.Mesh => o instanceof THREE.Mesh && o.name === "water",
  );
  expect(found).toHaveLength(1);
  return found[0];
}

describe("world boundaries", () => {
  const b = buildBoundaries();

  it("reports points inside vs outside the soft boundary", () => {
    expect(b.isInBounds(0, 0)).toBe(true);
    expect(b.isInBounds(WORLD.boundaryRadius - 1, 0)).toBe(true);
    expect(b.isInBounds(WORLD.boundaryRadius + 5, 0)).toBe(false);
  });

  it("clamps an out-of-bounds position back onto the boundary ring", () => {
    const p = new THREE.Vector3(WORLD.boundaryRadius + 50, 10, 0);
    b.clampToBounds(p);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(WORLD.boundaryRadius, 3);
    expect(p.y).toBe(10); // height untouched
  });

  it("leaves an in-bounds position unchanged", () => {
    const p = new THREE.Vector3(20, 5, -30);
    b.clampToBounds(p);
    expect([p.x, p.y, p.z]).toEqual([20, 5, -30]);
  });
});

describe("world boundaries — displacement seam (G1 slice 3, T5)", () => {
  it("no-arg call defaults displacement true: subdivided grid + live uTime handle", () => {
    // displacement defaults true, so the no-arg build subdivides the plane and
    // exposes the live uTime uniform the WaterSystem advances.
    const b = buildBoundaries();
    const water = waterMesh(b.group);
    const geo = water.geometry as THREE.PlaneGeometry;

    // Still exactly ONE mesh / ONE draw call (one geometry, one material).
    expect(b.group.children.filter((o) => o instanceof THREE.Mesh)).toHaveLength(1);
    expect(Array.isArray(water.material)).toBe(false);

    // Fixed, measured segment count: (N+1)^2 vertices, N*N*2 triangles.
    const expectedVerts = (WATER_SEGMENTS + 1) ** 2;
    expect(geo.getAttribute("position").count).toBe(expectedVerts);
    const index = geo.getIndex();
    expect(index).not.toBeNull();
    expect(index!.count / 3).toBe(WATER_SEGMENTS * WATER_SEGMENTS * 2);

    // The handle exposes the live uTime {value} object that was MERGED into the
    // material's onBeforeCompile uniforms — one identity-stable object the live
    // WaterSystem mutates, not a copy.
    expect(b.waterUniforms).toBeDefined();
    expect(b.waterUniforms!.uTime).toBeDefined();
    expect(typeof b.waterUniforms!.uTime.value).toBe("number");

    b.dispose();
  });

  it("displacement false keeps the current 1x1 quad (4 verts, no uTime handle)", () => {
    const b = buildBoundaries(undefined, false);
    const water = waterMesh(b.group);
    const geo = water.geometry as THREE.PlaneGeometry;

    // The static slice-2 quad: 4 verts, 2 triangles, zero extra vertex cost.
    expect(geo.getAttribute("position").count).toBe(4);
    expect(geo.getIndex()!.count / 3).toBe(2);

    // No animation ⇒ no live uTime uniform handle.
    expect(b.waterUniforms).toBeUndefined();

    b.dispose();
  });
});
