import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { RAIN_HEIGHT, RAIN_POINTS, RainSystem, fallSpeed, wrapY } from "./rainLayer.ts";

const FRAME = (dt = 0.016) => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(10, 3, -5);
  return { scene: new THREE.Scene(), camera, dt, elapsed: 0 };
};

function rig(rain01: number, reduced = false) {
  const scene = new THREE.Scene();
  const sys = new RainSystem(
    scene,
    { snapshot: () => ({ rain01 }) },
    { getSnapshot: () => ({ reducedMotion: reduced }) },
  );
  return { scene, sys };
}

describe("rain fall math", () => {
  it("hashes deterministic per-point speeds within the range", () => {
    expect(fallSpeed(3)).toBe(fallSpeed(3));
    for (let i = 0; i < 50; i++) {
      expect(fallSpeed(i)).toBeGreaterThanOrEqual(9);
      expect(fallSpeed(i)).toBeLessThanOrEqual(13);
    }
  });

  it("wraps fallen drops back to the cylinder top", () => {
    expect(wrapY(-0.5)).toBeCloseTo(RAIN_HEIGHT - 0.5, 6);
    expect(wrapY(4)).toBe(4);
  });
});

describe("RainSystem", () => {
  it("is hidden when dry, visible with envelope-tracked opacity in rain", () => {
    const dry = rig(0);
    dry.sys.update(FRAME());
    expect(dry.sys.points.visible).toBe(false);

    const wet = rig(0.8);
    wet.sys.update(FRAME());
    expect(wet.sys.points.visible).toBe(true);
    expect((wet.sys.points.material as THREE.PointsMaterial).opacity).toBeCloseTo(0.4, 5);
    wet.sys.dispose();
    dry.sys.dispose();
  });

  it("follows the camera and advances the fall without leaving the cylinder", () => {
    const { sys } = rig(1);
    const f = FRAME(0.5);
    sys.update(f);
    expect(sys.points.position.x).toBeCloseTo(10, 5);
    expect(sys.points.position.z).toBeCloseTo(-5, 5);
    const pos = sys.points.geometry.getAttribute("position");
    for (let i = 0; i < RAIN_POINTS; i++) {
      const y = pos.getY(i);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(RAIN_HEIGHT);
    }
    sys.dispose();
  });

  it("reduced motion suppresses the streaks entirely", () => {
    const { sys } = rig(1, true);
    sys.update(FRAME());
    expect(sys.points.visible).toBe(false);
    sys.dispose();
  });

  it("disposes cleanly, detaching from the scene", () => {
    const { scene, sys } = rig(1);
    sys.dispose();
    expect(scene.children.length).toBe(0);
  });
});
