import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  buildGroundingShadows,
  makeBlobTexture,
  terrainNormalAt,
  type GroundPoint,
} from "./groundingShadows.ts";

const FLAT = () => 2;
/** A 45° east-facing slope: height rises 1 per unit x. */
const SLOPE_X = (x: number) => x;

const POINTS: GroundPoint[] = [
  { x: 0, z: 0, y: 2, radius: 1.5 },
  { x: 10, z: -4, y: 2, radius: 0.8 },
  { x: -3, z: 7, y: 2, radius: 2.2 },
];

describe("makeBlobTexture", () => {
  it("is a runtime-generated data texture — zero asset bytes", () => {
    const tex = makeBlobTexture(32);
    expect(tex).toBeInstanceOf(THREE.DataTexture);
    tex.dispose();
  });

  it("samples linearly — DataTexture's NearestFilter default would band the gradient", () => {
    const tex = makeBlobTexture(32);
    expect(tex.magFilter).toBe(THREE.LinearFilter);
    expect(tex.minFilter).toBe(THREE.LinearFilter);
    tex.dispose();
  });

  it("fades from opaque centre to fully transparent edge", () => {
    const size = 32;
    const tex = makeBlobTexture(size);
    const data = tex.image.data as Uint8Array;
    const alphaAt = (px: number, py: number) => data[(py * size + px) * 4 + 3];

    const centre = alphaAt(size / 2, size / 2);
    const mid = alphaAt(Math.floor(size * 0.75), size / 2);
    const corner = alphaAt(0, 0);
    expect(centre).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(corner);
    expect(corner).toBe(0); // the disc never shows a square edge
    tex.dispose();
  });
});

describe("terrainNormalAt", () => {
  it("is straight up on flat terrain", () => {
    const n = terrainNormalAt(FLAT, 0, 0);
    expect(n.x).toBeCloseTo(0, 5);
    expect(n.y).toBeCloseTo(1, 5);
    expect(n.z).toBeCloseTo(0, 5);
  });

  it("tilts against the slope and stays unit length", () => {
    const n = terrainNormalAt(SLOPE_X, 0, 0);
    expect(n.x).toBeLessThan(0); // leans away from the rising +x side
    expect(n.y).toBeGreaterThan(0);
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 5);
  });
});

describe("buildGroundingShadows", () => {
  it("packs every point into ONE InstancedMesh (a single extra draw call)", () => {
    const { mesh, dispose } = buildGroundingShadows(POINTS, FLAT);
    expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(mesh.count).toBe(POINTS.length);
    expect(mesh.name).toBe("grounding-shadows");
    dispose();
  });

  it("renders as a soft decal: transparent, no depth write, never casting", () => {
    const { mesh, dispose } = buildGroundingShadows(POINTS, FLAT);
    const mat = mesh.material as THREE.MeshBasicMaterial;
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.polygonOffset).toBe(true); // never z-fights the terrain
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(false);
    dispose();
  });

  it("scales each disc by its point's radius and lifts it just off the ground", () => {
    const { mesh, dispose } = buildGroundingShadows(POINTS, FLAT);
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();

    mesh.getMatrixAt(0, m);
    m.decompose(pos, q, sc);
    expect(sc.x).toBeCloseTo(POINTS[0].radius * 2, 5); // unit plane → diameter
    expect(pos.y).toBeGreaterThan(FLAT()); // lifted off the terrain, not inside it
    expect(pos.y).toBeLessThan(FLAT() + 0.2);

    mesh.getMatrixAt(1, m);
    m.decompose(pos, q, sc);
    expect(sc.x).toBeCloseTo(POINTS[1].radius * 2, 5);
    dispose();
  });

  it("tilts discs to the terrain normal on a slope", () => {
    const { mesh, dispose } = buildGroundingShadows([POINTS[0]], SLOPE_X);
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    // Decompose (not setFromRotationMatrix — the matrix carries non-uniform
    // scale) and check the disc's face normal follows the terrain normal,
    // not world-up.
    const q = new THREE.Quaternion();
    m.decompose(new THREE.Vector3(), q, new THREE.Vector3());
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    expect(normal.x).toBeLessThan(-0.1);
    expect(normal.y).toBeGreaterThan(0.5);
    dispose();
  });

  it("disposes its geometry, material and texture", () => {
    const { mesh, dispose } = buildGroundingShadows(POINTS, FLAT);
    const mat = mesh.material as THREE.MeshBasicMaterial;
    let texDisposed = false;
    mat.map?.addEventListener("dispose", () => {
      texDisposed = true;
    });
    dispose();
    expect(texDisposed).toBe(true);
  });
});
