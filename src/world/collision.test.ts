import { describe, expect, it } from "vitest";
import { buildCollisionField, NO_COLLISION } from "./collision.ts";

const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

describe("collision field", () => {
  it("NO_COLLISION and an empty collider set leave every point untouched", () => {
    expect(NO_COLLISION.resolve(3, 4, 0.35)).toEqual({ x: 3, z: 4 });
    expect(buildCollisionField([]).resolve(3, 4, 0.35)).toEqual({ x: 3, z: 4 });
  });

  it("leaves a point outside every collider unchanged", () => {
    const f = buildCollisionField([{ x: 0, z: 0, r: 1 }]);
    expect(f.resolve(5, 0, 0.35)).toEqual({ x: 5, z: 0 });
  });

  it("ejects an interior point to exactly r + playerRadius from the centre", () => {
    const f = buildCollisionField([{ x: 0, z: 0, r: 1 }]);
    const p = f.resolve(0.2, 0, 0.35); // inside a r=1 collider, player radius 0.35
    expect(dist(p.x, p.z, 0, 0)).toBeCloseTo(1.35, 5);
    expect(p.z).toBeCloseTo(0, 5); // pushed straight out along the approach axis
  });

  it("nudges a dead-centre overlap out rather than dividing by zero", () => {
    const f = buildCollisionField([{ x: 0, z: 0, r: 1 }]);
    const p = f.resolve(0, 0, 0.35);
    expect(dist(p.x, p.z, 0, 0)).toBeCloseTo(1.35, 5);
  });

  it("with several colliders, ejects from the one it's inside and stays clear of the rest", () => {
    const f = buildCollisionField([{ x: 0, z: 0, r: 1 }, { x: 10, z: 0, r: 1 }]);
    const p = f.resolve(0.3, 0, 0.35); // inside the first only
    expect(dist(p.x, p.z, 0, 0)).toBeCloseTo(1.35, 5);
    expect(dist(p.x, p.z, 10, 0)).toBeGreaterThan(1.35);
  });

  it("finds a collider across a grid-cell boundary via the 3×3 neighbour scan", () => {
    // cellSize 8: collider at x=7.9 (cell 0) is found from a query at x=8.1 (cell 1).
    const f = buildCollisionField([{ x: 7.9, z: 0, r: 1 }]);
    const p = f.resolve(8.1, 0, 0.35);
    expect(dist(p.x, p.z, 7.9, 0)).toBeCloseTo(1.35, 5);
  });
});
