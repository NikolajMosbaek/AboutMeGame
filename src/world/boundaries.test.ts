import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildBoundaries } from "./boundaries.ts";
import { WORLD } from "./worldConfig.ts";

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
