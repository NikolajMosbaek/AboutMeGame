import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  FLOW_TEXTURE_EXTENT,
  FLOW_TEXTURE_RES,
  bakeRiverFlow,
  buildRiverFlowTexture,
  flowSampleAt,
} from "./riverFlowTexture.ts";
import { LAGOON, RIVER } from "./worldConfig.ts";

describe("flowSampleAt (pure)", () => {
  it("is full-strength downstream in the river bed, matching the segment direction", () => {
    // Mid-point of the {-2,-14}→{-20,38} segment, on the course.
    const s = flowSampleAt(-11, 12);
    expect(s.strength).toBeGreaterThan(0.9);
    const segLen = Math.hypot(-20 - -2, 38 - -14);
    expect(s.dx).toBeCloseTo((-20 - -2) / segLen, 1);
    expect(s.dz).toBeCloseTo((38 - -14) / segLen, 1);
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
  it("bakes RGBA texels: direction recoverable from RG, strength in B", () => {
    const data = bakeRiverFlow();
    expect(data.length).toBe(FLOW_TEXTURE_RES * FLOW_TEXTURE_RES * 4);
    // Locate the texel for the mid-course point (-11, 12).
    const u = Math.round(((-11 / (2 * FLOW_TEXTURE_EXTENT) + 0.5) * (FLOW_TEXTURE_RES - 1)));
    const v = Math.round(((12 / (2 * FLOW_TEXTURE_EXTENT) + 0.5) * (FLOW_TEXTURE_RES - 1)));
    const i = (v * FLOW_TEXTURE_RES + u) * 4;
    const dx = (data[i] / 255) * 2 - 1;
    const dz = (data[i + 1] / 255) * 2 - 1;
    expect(data[i + 2]).toBeGreaterThan(150); // strong flow in the bed
    expect(dx).toBeLessThan(0); // downstream heads -x here
    expect(dz).toBeGreaterThan(0); // and +z
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
