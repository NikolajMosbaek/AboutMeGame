// Tiny shared geometry helpers for the wildlife slice (pivot slice F). Mirrors
// the `world/props.ts` / `world/landmarks.ts` "stamp a colour, then merge" idiom
// exactly (flat-shaded, vertex-coloured, no textures) rather than re-deriving it
// per creature file. No THREE import leaks beyond this file's own signatures.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Stamp a uniform per-vertex `color` on a geometry. Converts to non-indexed
 * first so flat shading keeps hard facet normals (three's `flatShading` reads
 * per-face derivatives, but an indexed geometry sharing vertices across faces
 * would otherwise blend them). Mutates and returns the (possibly replaced)
 * geometry — the original is disposed when replaced.
 */
export function stampVertexColor(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  if (flat !== geo) geo.dispose();
  const n = flat.getAttribute("position").count;
  const c = new THREE.Color(color);
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return flat;
}

/** Merge, or throw — every call site here passes a fixed, non-empty source
 *  set, so a `null` result means a real geometry-construction bug. */
export function mergeOrThrow(sources: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(sources, false);
  if (!merged) throw new Error("wildlife: failed to merge geometry");
  return merged;
}

/** Triangle count of one instance of a geometry (indexed or not) — used by the
 *  draw-call/triangle budget tests, not shipped in any hot path. */
export function triCount(geo: THREE.BufferGeometry): number {
  const n = geo.index ? geo.index.count : geo.getAttribute("position").count;
  return Math.floor(n / 3);
}
