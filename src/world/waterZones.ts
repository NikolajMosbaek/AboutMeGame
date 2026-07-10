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

export function createSwimZones(): SwimZones {
  const lagoonReach = LAGOON.radius + LAGOON.shoreRamp;

  // Per-segment downstream unit directions, precomputed once. RIVER.points
  // run source → mouth, so segment direction IS the downstream direction.
  const pts = RIVER.points;
  const segs: { ax: number; az: number; dx: number; dz: number; len: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dz = pts[i + 1].z - pts[i].z;
    const len = Math.hypot(dx, dz) || 1;
    segs.push({ ax: pts[i].x, az: pts[i].z, dx: dx / len, dz: dz / len, len });
  }

  const inLagoon = (x: number, z: number): boolean =>
    Math.hypot(x - LAGOON.x, z - LAGOON.z) < lagoonReach;

  // Handed out by riverFlowAt — reused, valid until the next call (the one
  // caller reads it immediately; per-frame allocation here is GC churn).
  const flowOut: FlowDir = { x: 0, z: 0 };

  const riverFlowAt = (x: number, z: number): FlowDir | null => {
    if (inLagoon(x, z)) return null;
    let best = Infinity;
    let bestSeg: (typeof segs)[number] | null = null;
    for (const s of segs) {
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
    if (!bestSeg || best >= RIVER.bankHalfWidth) return null;
    flowOut.x = bestSeg.dx;
    flowOut.z = bestSeg.dz;
    return flowOut;
  };

  return { inLagoon, riverFlowAt };
}
