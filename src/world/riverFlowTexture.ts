// The baked river-flow field (living-water epic, 2026-07-19). The river's
// current has been REAL since the swimming slice — `waterZones.ts` pushes a
// swimming player downstream — but the surface never showed it. This bakes
// the same course into a small `DataTexture` the water detail shader samples
// per fragment: RG = downstream unit direction (0.5-biased), B = flow
// strength (1 in the carved bed, fading across the banks, released in the
// lagoon), A = 255. One 128² RGBA bake at build time, zero asset bytes.
//
// The polyline geometry comes from `projectOntoRiver` (`waterZones.ts`) — the
// SAME segment projection the gameplay current uses, so what pushes you and
// what you see can never disagree.

import * as THREE from "three";
import { LAGOON, RIVER, WORLD } from "./worldConfig.ts";
import { projectOntoRiver } from "./waterZones.ts";

export const FLOW_TEXTURE_RES = 128;
/** Same world→UV mapping as the baked ground-height texture
 *  (`groundHeightTexture.ts`): the island radius, so `vWorldXZ / (2·extent)
 *  + 0.5` is the shared lookup convention in the water shader. */
export const FLOW_TEXTURE_EXTENT = WORLD.islandRadius;

export interface FlowSample {
  dx: number;
  dz: number;
  /** 0..1 — full in the bed, 0 on dry land and in the lagoon. */
  strength: number;
}

const lagoonReach = LAGOON.radius + LAGOON.shoreRamp;

/** Pure flow field at a world point — the bake's single source, exported so
 *  tests (and any future consumer) sample it without decoding texels. */
export function flowSampleAt(x: number, z: number): FlowSample {
  const p = projectOntoRiver(x, z);
  // Full strength through the bed, smooth fade to zero across the banks.
  let strength =
    p.dist <= RIVER.bedHalfWidth
      ? 1
      : Math.max(0, 1 - (p.dist - RIVER.bedHalfWidth) / (RIVER.bankHalfWidth - RIVER.bedHalfWidth));
  // The lagoon releases the current (the swim-zone rule, made visible): fade
  // over the final approach so the mouth doesn't cut to a hard edge.
  const dLagoon = Math.hypot(x - LAGOON.x, z - LAGOON.z);
  if (dLagoon < lagoonReach) {
    strength *= Math.min(1, Math.max(0, (dLagoon - LAGOON.radius) / LAGOON.shoreRamp));
  }
  return { dx: p.dx, dz: p.dz, strength };
}

/** Bake the flow field into RGBA8 texels (row-major, v = +z). Deterministic. */
export function bakeRiverFlow(): Uint8Array {
  const res = FLOW_TEXTURE_RES;
  const data = new Uint8Array(res * res * 4);
  for (let v = 0; v < res; v++) {
    const z = ((v / (res - 1)) * 2 - 1) * FLOW_TEXTURE_EXTENT;
    for (let u = 0; u < res; u++) {
      const x = ((u / (res - 1)) * 2 - 1) * FLOW_TEXTURE_EXTENT;
      const s = flowSampleAt(x, z);
      const i = (v * res + u) * 4;
      data[i] = Math.round((s.dx * s.strength * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((s.dz * s.strength * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round(s.strength * 255);
      data[i + 3] = 255;
    }
  }
  return data;
}

export interface RiverFlowTexture {
  texture: THREE.DataTexture;
  dispose(): void;
}

/** The GPU-ready flow texture. LINEAR filtering (the G5 grounding-shadow
 *  lesson: nearest-filtered coarse data bakes read as visible grid banding),
 *  clamped, never sRGB-decoded (this is vector data, not colour). */
export function buildRiverFlowTexture(): RiverFlowTexture {
  const texture = new THREE.DataTexture(
    bakeRiverFlow(),
    FLOW_TEXTURE_RES,
    FLOW_TEXTURE_RES,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return {
    texture,
    dispose() {
      texture.dispose();
    },
  };
}
