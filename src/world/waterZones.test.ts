import { describe, expect, it } from "vitest";
import { createSwimZones } from "./waterZones.ts";
import { LAGOON, RIVER } from "./worldConfig.ts";

describe("createSwimZones (swimming, #184)", () => {
  const zones = createSwimZones();

  it("classifies the lagoon basin (radius + shoreRamp) as lagoon", () => {
    expect(zones.inLagoon(LAGOON.x, LAGOON.z)).toBe(true);
    // Just inside the outer edge of the shore ramp…
    expect(zones.inLagoon(LAGOON.x + LAGOON.radius + LAGOON.shoreRamp - 1, LAGOON.z)).toBe(true);
    // …and just outside it.
    expect(zones.inLagoon(LAGOON.x + LAGOON.radius + LAGOON.shoreRamp + 1, LAGOON.z)).toBe(false);
    expect(zones.inLagoon(0, -100)).toBe(false);
  });

  it("returns a downstream unit flow inside the river channel", () => {
    // Midpoint of the first river segment, on the centreline.
    const a = RIVER.points[0];
    const b = RIVER.points[1];
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const flow = zones.riverFlowAt(mid.x, mid.z);
    expect(flow).not.toBeNull();
    // Unit length…
    expect(Math.hypot(flow!.x, flow!.z)).toBeCloseTo(1, 6);
    // …pointing source → mouth (along b - a).
    const seg = { x: b.x - a.x, z: b.z - a.z
    };
    const dot = flow!.x * seg.x + flow!.z * seg.z;
    expect(dot).toBeGreaterThan(0);
  });

  it("returns null outside the channel and anywhere in the lagoon zone", () => {
    // Far from the river course.
    expect(zones.riverFlowAt(120, -20)).toBeNull();
    // The river mouth is inside the lagoon zone — the lagoon wins (the current
    // releases you where the channel meets the lagoon).
    const mouth = RIVER.points[RIVER.points.length - 1];
    expect(zones.inLagoon(mouth.x, mouth.z)).toBe(true);
    expect(zones.riverFlowAt(mouth.x, mouth.z)).toBeNull();
  });
});
