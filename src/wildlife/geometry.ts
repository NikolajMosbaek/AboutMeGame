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

/**
 * Recolour individual FACES of an already vertex-coloured (`stampVertexColor`,
 * non-indexed) geometry by blending `base` → `accent` per the caller's own
 * `weight` function of that face's LOCAL centre — a cheap, construction-time-
 * only "mottling" pass (rosette patches on the jaguar, colour banding on the
 * snake's coil) with zero runtime cost and zero extra triangles: it only
 * rewrites the existing `color` attribute, never the geometry itself. Callers
 * shape the pattern entirely through `weight` (a seeded noise clip for
 * blotchy rosettes, a periodic function of coil angle for stripes) rather
 * than this helper picking one look.
 */
export function mottleFaces(
  geo: THREE.BufferGeometry,
  base: THREE.Color,
  accent: THREE.Color,
  weight: (cx: number, cy: number, cz: number) => number,
): THREE.BufferGeometry {
  const pos = geo.getAttribute("position");
  const color = geo.getAttribute("color") as THREE.BufferAttribute;
  const mixed = new THREE.Color();
  for (let f = 0; f < pos.count / 3; f++) {
    const i0 = f * 3;
    const i1 = i0 + 1;
    const i2 = i0 + 2;
    const cx = (pos.getX(i0) + pos.getX(i1) + pos.getX(i2)) / 3;
    const cy = (pos.getY(i0) + pos.getY(i1) + pos.getY(i2)) / 3;
    const cz = (pos.getZ(i0) + pos.getZ(i1) + pos.getZ(i2)) / 3;
    const t = Math.max(0, Math.min(1, weight(cx, cy, cz)));
    mixed.copy(base).lerp(accent, t);
    color.setXYZ(i0, mixed.r, mixed.g, mixed.b);
    color.setXYZ(i1, mixed.r, mixed.g, mixed.b);
    color.setXYZ(i2, mixed.r, mixed.g, mixed.b);
  }
  color.needsUpdate = true;
  return geo;
}

/** A tiny deterministic 2D hash → [0,1) (the standard "sin scramble" GPU-noise
 *  idiom, applied CPU-side here) — seeds {@link mottleFaces}'s patchy patterns
 *  without touching `Math.random` (every wildlife placement/pattern stays
 *  reload-deterministic, matching `snakes.ts`'s own `hash01` convention). */
export function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

