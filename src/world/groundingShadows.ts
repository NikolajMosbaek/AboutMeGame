// Blob grounding shadows (G5 #160, the low-tier half of "lit detail").
//
// Medium/high ground every object with the real sun shadow pass + N8AO; the
// LOW tier runs `shadows: false` and no compositor, so its rocks, trees and
// landmark sites read as floating — the exact "weightless" deficiency the G5
// epic names. This module is the cheapest possible fix: one `InstancedMesh`
// of soft dark discs (a runtime-generated radial-falloff `DataTexture` — zero
// asset bytes, zero canvas so it builds headless), tilted to the terrain
// normal and lifted just off the ground. One extra draw call, two triangles
// per prop, no per-frame work at all.
//
// It is deliberately NOT used on tiers with real shadows: a blob under a
// shadow-mapped tree double-shadows. `quality.groundingShadows` (low only)
// owns that decision.

import * as THREE from "three";

/** One grounded object: its planted position and the disc's world radius. */
export interface GroundPoint {
  x: number;
  y: number;
  z: number;
  radius: number;
}

export type HeightAt = (x: number, z: number) => number;

/** Peak disc darkness (texture alpha is the falloff; this is its ceiling).
 *  Soft — a hint of contact, not a hard shadow-map lookalike. */
const BLOB_OPACITY = 0.38;
/** Lift along +Y so the disc never coplanes with the terrain triangles. */
const LIFT = 0.06;
/** Finite-difference step for the terrain normal — matches the `gentleSlope`
 *  sampling scale used at placement time. */
const NORMAL_EPSILON = 1.5;

const UP = new THREE.Vector3(0, 1, 0);

/**
 * A radial-falloff RGBA texture generated from math at runtime — 0 download
 * bytes, no canvas (jsdom-safe). RGB is black (the material's colour does the
 * tinting); alpha falls off quadratically from the centre and reaches exactly
 * 0 at the rim, so the square quad never shows.
 */
export function makeBlobTexture(size = 64): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const nx = ((px + 0.5) / size) * 2 - 1;
      const ny = ((py + 0.5) / size) * 2 - 1;
      const r = Math.hypot(nx, ny);
      const a = r >= 1 ? 0 : (1 - r) * (1 - r);
      data[(py * size + px) * 4 + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  // DataTexture defaults to NearestFilter (unlike image textures) — left
  // alone, the gradient renders as hard texel rings, not a soft disc.
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Terrain surface normal at `(x, z)` by central finite differences — pure
 * math over the injected height field, so placement logic tests headless.
 */
export function terrainNormalAt(heightAt: HeightAt, x: number, z: number): THREE.Vector3 {
  const e = NORMAL_EPSILON;
  return new THREE.Vector3(
    heightAt(x - e, z) - heightAt(x + e, z),
    2 * e,
    heightAt(x, z - e) - heightAt(x, z + e),
  ).normalize();
}

/**
 * Build the single grounding-disc `InstancedMesh` for every point. Discs are
 * unit planes scaled to each point's diameter, tilted to the local terrain
 * normal, and lifted `LIFT` above each point's own planted height (`p.y` IS
 * the terrain height at placement — trusted, not re-sampled; the height field
 * is only consulted for the normal). `dispose()` releases the geometry,
 * material, texture and instance buffers.
 */
export function buildGroundingShadows(
  points: readonly GroundPoint[],
  heightAt: HeightAt,
): { mesh: THREE.InstancedMesh; dispose(): void } {
  const texture = makeBlobTexture();
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0x000000,
    transparent: true,
    opacity: BLOB_OPACITY,
    depthWrite: false,
    // Bias the depth test so the disc never z-fights its own terrain triangle.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  const mesh = new THREE.InstancedMesh(geometry, material, points.length);
  mesh.name = "grounding-shadows";
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // Instances span the whole island; the geometry's own bounding sphere is a
  // 1-unit plane, so default frustum culling would blink them out.
  mesh.frustumCulled = false;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const sc = new THREE.Vector3();
  points.forEach((p, i) => {
    q.setFromUnitVectors(UP, terrainNormalAt(heightAt, p.x, p.z));
    pos.set(p.x, p.y + LIFT, p.z);
    sc.set(p.radius * 2, 1, p.radius * 2);
    m.compose(pos, q, sc);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;

  return {
    mesh,
    dispose() {
      mesh.dispose();
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
