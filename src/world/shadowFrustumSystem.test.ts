import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { FrameContext } from "../engine/types.ts";
import { lightBasis, type Vec3 } from "./shadowFrustum.ts";
import { ShadowFrustumSystem, type ShadowFrustumConfig } from "./shadowFrustumSystem.ts";

/** A minimal frame context carrying just what this System reads: the active
 *  camera's world position. */
function ctxAt(x: number, y: number, z: number): FrameContext {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(x, y, z);
  return { scene: new THREE.Scene(), camera, dt: 0.016, elapsed: 1 };
}

const CONFIG: ShadowFrustumConfig = { halfExtent: 75, mapSize: 1024 };

/** A real DirectionalLight configured like `sky.ts`'s shipped noon sun — same
 *  position/target the day cycle writes every frame. */
function noonSun(): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
  sun.position.set(0.6, 1, 0.4).multiplyScalar(200);
  sun.target.position.set(0, 0, 0);
  return sun;
}

describe("ShadowFrustumSystem construction", () => {
  it("sizes the ortho shadow camera to ±halfExtent", () => {
    const sun = noonSun();
    new ShadowFrustumSystem(sun, CONFIG);
    const cam = sun.shadow.camera;
    expect(cam.left).toBe(-75);
    expect(cam.right).toBe(75);
    expect(cam.top).toBe(75);
    expect(cam.bottom).toBe(-75);
  });

  it("does NOT touch near/far (sky.ts's whole-island depth range stays a safe default)", () => {
    const sun = noonSun();
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 600;
    new ShadowFrustumSystem(sun, CONFIG);
    expect(sun.shadow.camera.near).toBe(1);
    expect(sun.shadow.camera.far).toBe(600);
  });

  it("tunes bias/normalBias for the tighter frustum", () => {
    const sun = noonSun();
    new ShadowFrustumSystem(sun, CONFIG);
    expect(sun.shadow.bias).toBeLessThan(0); // still a small negative bias
    expect(sun.shadow.bias).toBeGreaterThan(-0.001); // but not the old, coarser magnitude
    expect(sun.shadow.normalBias).toBeGreaterThan(0);
  });
});

describe("ShadowFrustumSystem.update", () => {
  it("recenters the target on the player's position (before snapping, to first order)", () => {
    const sun = noonSun();
    const sys = new ShadowFrustumSystem(sun, CONFIG);
    sys.update(ctxAt(10, 1.7, -20));

    // Snapped to a texel grid, so not exact, but within one texel of the player.
    const texelSize = (CONFIG.halfExtent * 2) / CONFIG.mapSize;
    expect(Math.abs(sun.target.position.x - 10)).toBeLessThan(texelSize);
    expect(Math.abs(sun.target.position.z - -20)).toBeLessThan(texelSize);
  });

  it("preserves the light DIRECTION exactly (position - target unchanged) — shading never shifts", () => {
    const sun = noonSun();
    const originalDirection = sun.position.clone().sub(sun.target.position);
    const sys = new ShadowFrustumSystem(sun, CONFIG);

    sys.update(ctxAt(40, 1.7, -60));

    const newDirection = sun.position.clone().sub(sun.target.position);
    expect(newDirection.x).toBeCloseTo(originalDirection.x, 9);
    expect(newDirection.y).toBeCloseTo(originalDirection.y, 9);
    expect(newDirection.z).toBeCloseTo(originalDirection.z, 9);
  });

  it("moves BOTH position and target by the same delta (translation, not a re-aim)", () => {
    const sun = noonSun();
    const beforeTarget = sun.target.position.clone();
    const beforePosition = sun.position.clone();
    const sys = new ShadowFrustumSystem(sun, CONFIG);

    sys.update(ctxAt(5, 1.7, 5));

    const targetDelta = sun.target.position.clone().sub(beforeTarget);
    const positionDelta = sun.position.clone().sub(beforePosition);
    expect(positionDelta.x).toBeCloseTo(targetDelta.x, 9);
    expect(positionDelta.y).toBeCloseTo(targetDelta.y, 9);
    expect(positionDelta.z).toBeCloseTo(targetDelta.z, 9);
  });

  // The light's right/up plane is NOT world-axis-aligned for a tilted sun
  // direction like the shipped noon sun (0.6,1,0.4) — the along-light-direction
  // component is deliberately left unsnapped (see `shadowFrustum.ts`) and DOES
  // leak into raw world X/Z when the light isn't purely vertical, so these
  // "does it actually stay put" checks project onto the SAME right/up basis
  // the System itself computes (`lightBasis`), not raw world coordinates.
  const NOON_DIRECTION: Vec3 = [0.6, 1, 0.4];
  const noonBasis = lightBasis(NOON_DIRECTION);

  function alongRightUp(v: THREE.Vector3): { right: number; up: number } {
    return {
      right: v.x * noonBasis.right[0] + v.y * noonBasis.right[1] + v.z * noonBasis.right[2],
      up: v.x * noonBasis.up[0] + v.y * noonBasis.up[1] + v.z * noonBasis.up[2],
    };
  }

  /** Build a player position from EXPLICIT right/up (and a fixed forward)
   *  coordinates in the noon light's own basis, so a test can place a point
   *  safely mid-bucket (or precisely on a boundary) regardless of how the
   *  basis happens to map onto world XZ. */
  function playerAt(right: number, up: number): THREE.Vector3 {
    return new THREE.Vector3(
      right * noonBasis.right[0] + up * noonBasis.up[0],
      right * noonBasis.right[1] + up * noonBasis.up[1] + 1.7,
      right * noonBasis.right[2] + up * noonBasis.up[2],
    );
  }

  it("does not shimmer for sub-texel player motion (snapped right/up bucket is unchanged)", () => {
    const sun = noonSun();
    const sys = new ShadowFrustumSystem(sun, CONFIG);
    const texelSize = (CONFIG.halfExtent * 2) / CONFIG.mapSize;

    // Exactly on a grid point (safely mid-bucket, `texelSize / 2` from either
    // boundary) so a small nudge can never straddle a boundary by bad luck.
    const base = playerAt(3 * texelSize, -2 * texelSize);
    sys.update(ctxAt(base.x, base.y, base.z));
    const first = alongRightUp(sun.target.position);

    // A tiny nudge well under half a texel (~0.146 world units at this config).
    const nudged = playerAt(3 * texelSize + texelSize * 0.05, -2 * texelSize - texelSize * 0.05);
    sys.update(ctxAt(nudged.x, nudged.y, nudged.z));
    const second = alongRightUp(sun.target.position);
    expect(second.right).toBeCloseTo(first.right, 9);
    expect(second.up).toBeCloseTo(first.up, 9);
  });

  it("moves in whole-texel steps (along the light's right axis) as the player crosses a texel boundary", () => {
    const sun = noonSun();
    const sys = new ShadowFrustumSystem(sun, CONFIG);
    const texelSize = (CONFIG.halfExtent * 2) / CONFIG.mapSize;

    sys.update(ctxAt(0, 1.7, 0));
    const a = alongRightUp(sun.target.position);
    // Move purely along the light's own right axis by 5.5 texels, so the
    // crossing is unambiguous regardless of how right/up map onto world XZ.
    const move = 5.5 * texelSize;
    const player = new THREE.Vector3(
      noonBasis.right[0] * move,
      noonBasis.right[1] * move,
      noonBasis.right[2] * move,
    );
    sys.update(ctxAt(player.x, player.y + 1.7, player.z));
    const b = alongRightUp(sun.target.position);

    const movedRight = Math.abs(b.right - a.right);
    const steps = movedRight / texelSize;
    expect(steps).toBeCloseTo(Math.round(steps), 3);
  });

  it("tracks the sun direction as it changes across frames (still preserved each time)", () => {
    const sun = noonSun();
    const sys = new ShadowFrustumSystem(sun, CONFIG);

    sys.update(ctxAt(0, 1.7, 0));
    // Simulate the day cycle moving the sun to a new (dusk-ish) direction
    // before the NEXT frame's update — mirrors registration AFTER DayCycleSystem.
    const duskDirection = new THREE.Vector3(-0.7, 0.3, 0.2).multiplyScalar(200);
    sun.target.position.set(0, 0, 0);
    sun.position.copy(duskDirection);

    sys.update(ctxAt(30, 1.7, 30));
    const newDirection = sun.position.clone().sub(sun.target.position);
    expect(newDirection.x).toBeCloseTo(duskDirection.x, 6);
    expect(newDirection.y).toBeCloseTo(duskDirection.y, 6);
    expect(newDirection.z).toBeCloseTo(duskDirection.z, 6);
  });
});
