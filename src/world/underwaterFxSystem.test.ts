import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  UnderwaterFxSystem,
  UNDERWATER_FOG_DENSITY,
  UNDERWATER_FOG_SRGB,
} from "./underwaterFxSystem.ts";
import { WORLD } from "./worldConfig.ts";
import type { FrameContext } from "../engine/types.ts";

const BASE_DENSITY = 0.0022;
const DAY_COLOR: [number, number, number] = [0.72, 0.82, 0.9];

function rig() {
  const fog = new THREE.FogExp2(0x000000, BASE_DENSITY);
  const sys = new UnderwaterFxSystem(fog);
  const camera = new THREE.PerspectiveCamera();
  const ctx: FrameContext = { scene: new THREE.Scene(), camera, dt: 1 / 60, elapsed: 0 };
  /** One frame as the engine runs it: the day cycle writes the fog colour
   *  first (it is registered before), then this system layers on top. */
  const frame = (cameraY: number) => {
    camera.position.y = cameraY;
    fog.color.setRGB(...DAY_COLOR, THREE.SRGBColorSpace);
    sys.update(ctx);
  };
  return { fog, frame };
}

describe("UnderwaterFxSystem (#184)", () => {
  it("leaves the day-cycle fog untouched while the camera is above the surface", () => {
    const { fog, frame } = rig();
    frame(WORLD.seaLevel + 1.7);
    expect(fog.density).toBe(BASE_DENSITY);
    const expected = new THREE.Color().setRGB(...DAY_COLOR, THREE.SRGBColorSpace);
    expect(fog.color.getHex()).toBe(expected.getHex());
  });

  it("lerps to deep teal + higher density while submerged", () => {
    const { fog, frame } = rig();
    for (let i = 0; i < 120; i++) frame(WORLD.seaLevel - 1);
    expect(fog.density).toBeCloseTo(UNDERWATER_FOG_DENSITY, 6);
    const teal = new THREE.Color().setRGB(...UNDERWATER_FOG_SRGB, THREE.SRGBColorSpace);
    expect(fog.color.getHex()).toBe(teal.getHex());
    expect(fog.density).toBeGreaterThan(BASE_DENSITY * 2);
  });

  it("restores the exact base density and the day colour the frame it surfaces", () => {
    const { fog, frame } = rig();
    for (let i = 0; i < 120; i++) frame(WORLD.seaLevel - 1);
    frame(WORLD.seaLevel + 1.7);
    expect(fog.density).toBe(BASE_DENSITY); // exact, not approximate
    const expected = new THREE.Color().setRGB(...DAY_COLOR, THREE.SRGBColorSpace);
    expect(fog.color.getHex()).toBe(expected.getHex()); // the day cycle owns it again
  });

  it("is a no-op on the low tier (fog null) — never throws", () => {
    const sys = new UnderwaterFxSystem(null);
    const camera = new THREE.PerspectiveCamera();
    camera.position.y = WORLD.seaLevel - 2;
    expect(() =>
      sys.update({ scene: new THREE.Scene(), camera, dt: 1 / 60, elapsed: 0 }),
    ).not.toThrow();
  });
});
