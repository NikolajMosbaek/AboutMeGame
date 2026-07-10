import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { lightBasis, snapToTexelGrid, type Vec3 } from "./shadowFrustum.ts";

/** Reproduce three's own camera-lookAt basis (its `Matrix4.lookAt` columns,
 *  the exact thing `WebGLShadowMap` drives the shadow camera with — see
 *  `LightShadow.updateMatrices` calling `shadowCamera.lookAt(target)` with
 *  the light's default `up`), independently of `lightBasis`, so the pure
 *  function can be checked against the real three math it must match. */
function threeCameraBasis(direction: Vec3): { right: Vec3; up: Vec3 } {
  const camera = new THREE.PerspectiveCamera();
  const eye = new THREE.Vector3(...direction);
  camera.position.copy(eye);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true); // matrixWorld is stale until forced (no renderer traversal here)
  const m = camera.matrixWorld;
  const right: Vec3 = [m.elements[0], m.elements[1], m.elements[2]];
  const up: Vec3 = [m.elements[4], m.elements[5], m.elements[6]];
  return { right, up };
}

function len(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

describe("lightBasis", () => {
  it("returns unit-length, mutually orthogonal right/up vectors", () => {
    const { right, up } = lightBasis([0.6, 1, 0.4]);
    expect(len(right)).toBeCloseTo(1, 10);
    expect(len(up)).toBeCloseTo(1, 10);
    expect(dot(right, up)).toBeCloseTo(0, 10);
  });

  it("matches three's own camera-lookAt basis for the shipped noon sun direction", () => {
    const direction: Vec3 = [0.6, 1, 0.4]; // sky.ts's shipped noon sun direction
    const mine = lightBasis(direction);
    const real = threeCameraBasis(direction);
    expect(mine.right[0]).toBeCloseTo(real.right[0], 6);
    expect(mine.right[1]).toBeCloseTo(real.right[1], 6);
    expect(mine.right[2]).toBeCloseTo(real.right[2], 6);
    expect(mine.up[0]).toBeCloseTo(real.up[0], 6);
    expect(mine.up[1]).toBeCloseTo(real.up[1], 6);
    expect(mine.up[2]).toBeCloseTo(real.up[2], 6);
  });

  it("matches three across a sweep of directions (the day cycle's low dawn/dusk sun too)", () => {
    const directions: Vec3[] = [
      [0.6, 1, 0.4], // noon
      [0.95, 0.12, -0.3], // low dawn-ish elevation
      [-0.8, 0.16, 0.7], // low dusk-ish, opposite azimuth
      [0.1, 0.2, 0.98],
    ];
    for (const direction of directions) {
      const mine = lightBasis(direction);
      const real = threeCameraBasis(direction);
      expect(mine.right[0]).toBeCloseTo(real.right[0], 5);
      expect(mine.right[1]).toBeCloseTo(real.right[1], 5);
      expect(mine.right[2]).toBeCloseTo(real.right[2], 5);
      expect(mine.up[0]).toBeCloseTo(real.up[0], 5);
      expect(mine.up[1]).toBeCloseTo(real.up[1], 5);
      expect(mine.up[2]).toBeCloseTo(real.up[2], 5);
    }
  });

  it("is total (does not throw/NaN) for a direction parallel to world-up", () => {
    const { right, up } = lightBasis([0, 1, 0]);
    expect(Number.isFinite(right[0])).toBe(true);
    expect(Number.isFinite(up[0])).toBe(true);
    expect(len(right)).toBeCloseTo(1, 10);
    expect(len(up)).toBeCloseTo(1, 10);
  });
});

describe("snapToTexelGrid", () => {
  const basis = lightBasis([0.6, 1, 0.4]);
  const texelSize = 0.15;

  it("moves the position by less than half a texel along each axis", () => {
    const position: Vec3 = [12.345, 6.7, -30.2];
    const snapped = snapToTexelGrid(position, basis, texelSize);
    const delta: Vec3 = [
      snapped[0] - position[0],
      snapped[1] - position[1],
      snapped[2] - position[2],
    ];
    // The residual lives entirely in the right/up plane (by construction), so
    // its magnitude is bounded by the diagonal of a half-texel cell.
    expect(len(delta)).toBeLessThanOrEqual((texelSize / 2) * Math.SQRT2 + 1e-9);
  });

  it("is idempotent — snapping an already-snapped position is a no-op", () => {
    const position: Vec3 = [40.1, -5, 88.8];
    const once = snapToTexelGrid(position, basis, texelSize);
    const twice = snapToTexelGrid(once, basis, texelSize);
    expect(twice[0]).toBeCloseTo(once[0], 9);
    expect(twice[1]).toBeCloseTo(once[1], 9);
    expect(twice[2]).toBeCloseTo(once[2], 9);
  });

  it("snaps the right/up projections to exact multiples of texelSize", () => {
    const position: Vec3 = [7.77, 2.2, -14.4];
    const snapped = snapToTexelGrid(position, basis, texelSize);
    const alongRight = dot(snapped, basis.right);
    const alongUp = dot(snapped, basis.up);
    const rightSteps = alongRight / texelSize;
    const upSteps = alongUp / texelSize;
    expect(rightSteps).toBeCloseTo(Math.round(rightSteps), 6);
    expect(upSteps).toBeCloseTo(Math.round(upSteps), 6);
  });

  it("with an axis-aligned basis, snaps exactly like a plain grid round", () => {
    const axisBasis = { right: [1, 0, 0] as Vec3, up: [0, 0, 1] as Vec3 };
    const snapped = snapToTexelGrid([10.4, 3, 20.9], axisBasis, 2);
    expect(snapped[0]).toBeCloseTo(10, 9); // round(10.4/2)*2 = 10
    expect(snapped[1]).toBe(3); // untouched (not along right/up)
    expect(snapped[2]).toBeCloseTo(20, 9); // round(20.9/2)*2 = 20
  });

  it("returns the position unchanged for a non-positive texelSize (guards div-by-zero)", () => {
    const position: Vec3 = [1, 2, 3];
    expect(snapToTexelGrid(position, basis, 0)).toEqual(position);
    expect(snapToTexelGrid(position, basis, -1)).toEqual(position);
  });
});
