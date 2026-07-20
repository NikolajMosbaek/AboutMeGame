import { describe, expect, it } from "vitest";
import { buildTerrain, distToRiver } from "./terrain.ts";
import { POI_ANCHORS, RIVER } from "./worldConfig.ts";

/**
 * The wrecked-canoe site must actually sit at the river's west-bank waterline —
 * clue 2 says the canoe was "dragged out of the water on the west bank … keep
 * the water on your right." The original anchor sat ~11 m up a dry jungle
 * hillside (distToRiver ~16 > bankHalfWidth), so the clue was simply false.
 * These invariants pin the relocation so it can never silently regress.
 */

/** The river-channel centre x at a given z, by interpolating RIVER.points. */
function channelCentreX(z: number): number {
  const pts = RIVER.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if ((z >= a.z && z <= b.z) || (z <= a.z && z >= b.z)) {
      const t = (z - a.z) / (b.z - a.z);
      return a.x + (b.x - a.x) * t;
    }
  }
  return pts[pts.length - 1].x;
}

describe("wrecked-canoe placement (M3 finding 3)", () => {
  const canoe = POI_ANCHORS.find((a) => a.poiId === "site-wrecked-canoe")!;

  it("is anchored, west of the channel, within the river bank", () => {
    expect(canoe).toBeDefined();
    // West bank: to the west (−x) of the channel centre at its z.
    expect(canoe.x).toBeLessThan(channelCentreX(canoe.z));
    // Near the water: inside the carved bank, not out on dry terrain.
    expect(distToRiver(canoe.x, canoe.z)).toBeLessThanOrEqual(RIVER.bankHalfWidth);
  });

  it("sits on the low bank at the waterline, not up a dry hillside", () => {
    const { heightAt, dispose } = buildTerrain();
    const h = heightAt(canoe.x, canoe.z);
    // On the low bank right at the water's edge — dry footing (above sea level)
    // but never metres up a slope the way the old (-29, 57) spot was (~11 m).
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(2);
    dispose();
  });
});
