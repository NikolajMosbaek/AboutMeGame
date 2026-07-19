import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  FLOW_TEXTURE_EXTENT,
  FLOW_TEXTURE_RES,
  RIVER_ARC_LENGTH,
  bakeRiverFlow,
  buildRiverFlowTexture,
  flowSampleAt,
} from "./riverFlowTexture.ts";
import { LAGOON, RIVER } from "./worldConfig.ts";

describe("flowSampleAt (pure)", () => {
  it("is full-strength in the bed, with a CONTINUOUS arc coordinate across a bend", () => {
    // Mid-point of the {-2,-14}→{-20,38} segment, on the course.
    const mid = flowSampleAt(-11, 12);
    expect(mid.strength).toBeGreaterThan(0.9);
    expect(mid.arc).toBeGreaterThan(0);
    expect(mid.arc).toBeLessThan(RIVER_ARC_LENGTH);
    // Walk THROUGH the sharp bend at {-20, 38}: arc must advance
    // monotonically with no junction jump (the contour-ring artifact both
    // review rounds chased came from a discontinuous flow axis).
    let prev = -Infinity;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      // Course points just up- and downstream of the bend vertex.
      const x = -14 + (-2 - -14) * t; // -14 → -2 … crossing near the vertex
      const z = 25 + (55 - 25) * t;
      const p = flowSampleAt(x - 3, z); // hug the course (west of it)
      if (p.strength <= 0) continue;
      expect(p.arc).toBeGreaterThanOrEqual(prev - 1.5); // ≤ small local slack
      prev = Math.max(prev, p.arc);
    }
  });

  it("signs the cross coordinate by bank and zeroes it on the course", () => {
    const on = flowSampleAt(-11, 12);
    expect(Math.abs(on.cross)).toBeLessThan(1.5);
    // Perpendicular offsets land on opposite signs.
    const a = flowSampleAt(-11 + 4, 12);
    const b = flowSampleAt(-11 - 4, 12);
    expect(Math.sign(a.cross)).not.toBe(Math.sign(b.cross));
  });

  it("fades to zero across the banks and is zero on dry land", () => {
    // Walk outward perpendicular from the course: strength must not increase.
    const bed = flowSampleAt(-11, 12).strength;
    const bank = flowSampleAt(-11 + RIVER.bankHalfWidth - 1, 12).strength;
    const dry = flowSampleAt(-11 + RIVER.bankHalfWidth + 8, 12).strength;
    expect(bed).toBeGreaterThan(bank);
    expect(dry).toBe(0);
  });

  it("releases in the lagoon — calm basin, no current", () => {
    expect(flowSampleAt(LAGOON.x, LAGOON.z).strength).toBe(0);
    // Upstream of the release zone the mouth reach still flows.
    expect(flowSampleAt(2.7, 100).strength).toBeGreaterThan(0);
  });
});

describe("bakeRiverFlow", () => {
  it("bakes RGBA texels: arc in R, signed cross in G, strength in B", () => {
    const data = bakeRiverFlow();
    expect(data.length).toBe(FLOW_TEXTURE_RES * FLOW_TEXTURE_RES * 4);
    // Locate the texel for the mid-course point (-11, 12).
    const u = Math.round(((-11 / (2 * FLOW_TEXTURE_EXTENT) + 0.5) * (FLOW_TEXTURE_RES - 1)));
    const v = Math.round(((12 / (2 * FLOW_TEXTURE_EXTENT) + 0.5) * (FLOW_TEXTURE_RES - 1)));
    const i = (v * FLOW_TEXTURE_RES + u) * 4;
    const sample = flowSampleAt(-11, 12);
    expect(data[i] / 255).toBeCloseTo(sample.arc / RIVER_ARC_LENGTH, 1);
    expect(Math.abs(data[i + 1] / 255 - 0.5)).toBeLessThan(0.25); // near the course centre
    expect(data[i + 2]).toBeGreaterThan(150); // strong flow in the bed
    expect(data[i + 3]).toBe(255);
  });

  it("is deterministic", () => {
    expect(bakeRiverFlow()).toEqual(bakeRiverFlow());
  });
});

describe("buildRiverFlowTexture", () => {
  it("builds a LINEAR-filtered, clamped, non-sRGB DataTexture (the G5 banding lesson)", () => {
    const flow = buildRiverFlowTexture();
    expect(flow.texture).toBeInstanceOf(THREE.DataTexture);
    expect(flow.texture.minFilter).toBe(THREE.LinearFilter);
    expect(flow.texture.magFilter).toBe(THREE.LinearFilter);
    expect(flow.texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(flow.texture.colorSpace).toBe(THREE.NoColorSpace);
    expect(flow.texture.image.width).toBe(FLOW_TEXTURE_RES);
    expect(() => flow.dispose()).not.toThrow();
  });
});
