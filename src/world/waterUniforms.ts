import * as THREE from "three";
import { WATER_DEEP, WATER_SHALLOW } from "./waterSurface.ts";

// Colour-space transport for the water `onBeforeCompile` patch (G1 slice 2).
//
// The renderer outputs `SRGBColorSpace` with ACES tone mapping, so the
// MeshStandard fragment math runs in LINEAR and only gets encoded to sRGB on
// output. The palette in `waterSurface.ts` is authored in sRGB 0..1 (to match
// the art-direction token), so feeding those tuples straight into a shader
// uniform would double-encode and wash the blues out. This module is the single
// transport step that gamma-decodes them to linear before they become uniforms.
//
// It re-uses `WATER_SHALLOW` / `WATER_DEEP` from `waterSurface.ts` — it never
// re-declares the palette hex — so that module stays the single source of truth
// (AC1). The conversion is a `THREE.Color` decode, not a new colour definition.

/** Soft, tone-mapped off-white for shoreline foam, sRGB 0..1.
 *
 * Deliberately below pure white (1,1,1): mixed over the water it reads as a
 * feathered foam collar, not a clipped white rim (AC3). It is a foam material
 * tunable owned by the visual patch, NOT part of the `waterColor`/`shorelineFoam`
 * palette math in `waterSurface.ts`, so it lives here with the other uniforms. */
export const FOAM_COLOR = [0.9, 0.94, 0.96] as const;

// Module-scoped scratch Color: the decode is build-time (uniform setup), not a
// per-frame path, but reusing one instance still avoids needless allocation.
const SCRATCH = new THREE.Color();

/**
 * Gamma-decode an sRGB 0..1 tuple to a fresh LINEAR 0..1 tuple.
 *
 * Pure transport over `THREE.Color.setRGB(r, g, b, SRGBColorSpace)`, whose
 * read-back `.r/.g/.b` are in linear-sRGB working space — the same decode the
 * renderer applies to colour textures. Each call returns a new 3-tuple (no
 * shared scratch leak to the caller); the internal `THREE.Color` is reused.
 * Above black, every sRGB channel decodes to a strictly lower linear value, and
 * the gamut endpoints map to themselves (0->0, 1->1).
 */
export function srgbTupleToLinear(
  rgb: readonly [number, number, number],
): [number, number, number] {
  SCRATCH.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
  return [SCRATCH.r, SCRATCH.g, SCRATCH.b];
}

/** {@link WATER_SHALLOW} decoded to linear, ready as a `vec3` uniform. */
export const WATER_SHALLOW_LINEAR = srgbTupleToLinear(WATER_SHALLOW);
/** {@link WATER_DEEP} decoded to linear, ready as a `vec3` uniform. */
export const WATER_DEEP_LINEAR = srgbTupleToLinear(WATER_DEEP);
/** {@link FOAM_COLOR} decoded to linear, ready as a `vec3` uniform. */
export const FOAM_COLOR_LINEAR = srgbTupleToLinear(FOAM_COLOR);
