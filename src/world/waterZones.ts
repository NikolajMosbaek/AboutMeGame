// Swim-zone classification (swimming & diving, #184). The ONE place the
// worldConfig layout is turned into the explorer's water rules: the LAGOON
// basin (out to radius + shoreRamp) is calm, swimmable water; the RIVER
// channel (within bankHalfWidth of the course, outside the lagoon zone) is
// not free water — its deep stretches carry a current that the clue chain's
// "what the river carved, it keeps" makes literal. Injected into the
// ExplorerSystem as a seam, so movement tests script their own zones and
// never depend on the island's real coordinates.

import { LAGOON, RIVER } from "./worldConfig.ts";

export interface FlowDir {
  x: number;
  z: number;
}

export interface SwimZones {
  /** Calm, swimmable basin: within LAGOON.radius + LAGOON.shoreRamp. */
  inLagoon(x: number, z: number): boolean;
  /** Downstream unit flow direction when (x,z) is inside the river channel
   *  (distance to the course < RIVER.bankHalfWidth) and OUTSIDE the lagoon
   *  zone — the lagoon wins where they overlap, which is exactly where the
   *  current releases you. `null` everywhere else. The returned object is
   *  reused across calls: read it immediately, never keep it. */
  riverFlowAt(x: number, z: number): FlowDir | null;
}

// Per-segment downstream unit directions, precomputed once at module load.
// RIVER.points run source → mouth, so segment direction IS the downstream
// direction. Shared by the player rules below AND the baked visual flow
// field (`riverFlowTexture.ts`) — one polyline projection, two consumers.
const SEGS: { ax: number; az: number; dx: number; dz: number; len: number }[] = [];
for (let i = 0; i < RIVER.points.length - 1; i++) {
  const dx = RIVER.points[i + 1].x - RIVER.points[i].x;
  const dz = RIVER.points[i + 1].z - RIVER.points[i].z;
  const len = Math.hypot(dx, dz) || 1;
  SEGS.push({ ax: RIVER.points[i].x, az: RIVER.points[i].z, dx: dx / len, dz: dz / len, len });
}

export interface RiverProjection {
  /** Downstream unit direction of the nearest course segment. */
  dx: number;
  dz: number;
  /** Distance from (x,z) to the course. */
  dist: number;
}

/** Project a world point onto the river course: nearest segment's downstream
 *  direction and the distance to it. Pure; pass `out` on per-frame paths to
 *  stay allocation-free (the swim-zone rule below does). */
export function projectOntoRiver(
  x: number,
  z: number,
  out: RiverProjection = { dx: 0, dz: 0, dist: 0 },
): RiverProjection {
  let best = Infinity;
  let bestSeg = SEGS[0];
  for (const s of SEGS) {
    const apx = x - s.ax;
    const apz = z - s.az;
    // Project onto the segment, clamped to its extent.
    const t = Math.min(s.len, Math.max(0, apx * s.dx + apz * s.dz));
    const d = Math.hypot(apx - s.dx * t, apz - s.dz * t);
    if (d < best) {
      best = d;
      bestSeg = s;
    }
  }
  out.dx = bestSeg.dx;
  out.dz = bestSeg.dz;
  out.dist = best;
  return out;
}

export function createSwimZones(): SwimZones {
  const lagoonReach = LAGOON.radius + LAGOON.shoreRamp;

  const inLagoon = (x: number, z: number): boolean =>
    Math.hypot(x - LAGOON.x, z - LAGOON.z) < lagoonReach;

  // Handed out by riverFlowAt — reused, valid until the next call (the one
  // caller reads it immediately; per-frame allocation here is GC churn).
  const flowOut: FlowDir = { x: 0, z: 0 };
  const projOut: RiverProjection = { dx: 0, dz: 0, dist: 0 };

  const riverFlowAt = (x: number, z: number): FlowDir | null => {
    if (inLagoon(x, z)) return null;
    const p = projectOntoRiver(x, z, projOut);
    if (p.dist >= RIVER.bankHalfWidth) return null;
    flowOut.x = p.dx;
    flowOut.z = p.dz;
    return flowOut;
  };

  return { inLagoon, riverFlowAt };
}
