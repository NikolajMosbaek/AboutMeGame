import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { FrameContext } from "../engine/types.ts";
import { lightBasis, type Vec3 } from "./shadowFrustum.ts";
import { ShadowFrustumSystem, type ShadowFrustumConfig, type SunDirectionSource } from "./shadowFrustumSystem.ts";

/** A minimal frame context carrying just what this System reads: the active
 *  camera's world position. */
function ctxAt(x: number, y: number, z: number): FrameContext {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(x, y, z);
  return { scene: new THREE.Scene(), camera, dt: 0.016, elapsed: 1 };
}

const CONFIG: ShadowFrustumConfig = { halfExtent: 75, mapSize: 1024 };

/** A bare `THREE.DirectionalLight` — this System now owns writing its
 *  position/target from the injected {@link SunDirectionSource} every frame,
 *  so the fixture no longer needs to pre-seed a position/target itself
 *  (unlike the old `noonSun()`, which mimicked what `DayCycleSystem` would
 *  have written — that responsibility moved to the fake direction source). */
function bareSun(): THREE.DirectionalLight {
  return new THREE.DirectionalLight(0xfff1d6, 1.6);
}

const NOON_DIRECTION: Vec3 = [0.6, 1, 0.4];

/** A `SunDirectionSource` fake whose answer can be swapped between updates
 *  (`set`) — the seam this System reads instead of ever re-deriving direction
 *  from `sun.position - sun.target.position`. Returns a UNIT vector, matching
 *  the real `DayCycleSystem.getSunDirection()` contract. */
function fakeSunDirection(initial: Vec3 = NOON_DIRECTION): SunDirectionSource & { set(dir: Vec3): void } {
  const v = new THREE.Vector3(...initial).normalize();
  return {
    getSunDirection: () => v,
    set(dir: Vec3) {
      v.set(dir[0], dir[1], dir[2]).normalize();
    },
  };
}

describe("ShadowFrustumSystem construction", () => {
  it("sizes the ortho shadow camera to ±halfExtent", () => {
    const sun = bareSun();
    new ShadowFrustumSystem(sun, fakeSunDirection(), CONFIG);
    const cam = sun.shadow.camera;
    expect(cam.left).toBe(-75);
    expect(cam.right).toBe(75);
    expect(cam.top).toBe(75);
    expect(cam.bottom).toBe(-75);
  });

  it("does NOT touch near/far (sky.ts's whole-island depth range stays a safe default)", () => {
    const sun = bareSun();
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 600;
    new ShadowFrustumSystem(sun, fakeSunDirection(), CONFIG);
    expect(sun.shadow.camera.near).toBe(1);
    expect(sun.shadow.camera.far).toBe(600);
  });

  it("tunes bias/normalBias for the tighter frustum", () => {
    const sun = bareSun();
    new ShadowFrustumSystem(sun, fakeSunDirection(), CONFIG);
    expect(sun.shadow.bias).toBeLessThan(0); // still a small negative bias
    expect(sun.shadow.bias).toBeGreaterThan(-0.001); // but not the old, coarser magnitude
    expect(sun.shadow.normalBias).toBeGreaterThan(0);
  });
});

describe("ShadowFrustumSystem.update", () => {
  it("recenters the target on the player's position (before snapping, to first order)", () => {
    const sun = bareSun();
    const sys = new ShadowFrustumSystem(sun, fakeSunDirection(), CONFIG);
    sys.update(ctxAt(10, 1.7, -20));

    // Snapped to a texel grid, so not exact, but within one texel of the player.
    const texelSize = (CONFIG.halfExtent * 2) / CONFIG.mapSize;
    expect(Math.abs(sun.target.position.x - 10)).toBeLessThan(texelSize);
    expect(Math.abs(sun.target.position.z - -20)).toBeLessThan(texelSize);
  });

  it("writes the INJECTED direction exactly (position - target matches the source) — never derived from the scene graph", () => {
    const sun = bareSun();
    const direction = fakeSunDirection(NOON_DIRECTION);
    const sys = new ShadowFrustumSystem(sun, direction, CONFIG);

    sys.update(ctxAt(40, 1.7, -60));

    const rendered = sun.position.clone().sub(sun.target.position).normalize();
    const expected = direction.getSunDirection();
    expect(rendered.x).toBeCloseTo(expected.x, 9);
    expect(rendered.y).toBeCloseTo(expected.y, 9);
    expect(rendered.z).toBeCloseTo(expected.z, 9);
  });

  it("moves BOTH position and target by the same delta as the player moves (translation, not a re-aim)", () => {
    const sun = bareSun();
    const sys = new ShadowFrustumSystem(sun, fakeSunDirection(), CONFIG);

    sys.update(ctxAt(5, 1.7, 5));
    const firstTarget = sun.target.position.clone();
    const firstPosition = sun.position.clone();

    sys.update(ctxAt(45, 1.7, 25));
    const targetDelta = sun.target.position.clone().sub(firstTarget);
    const positionDelta = sun.position.clone().sub(firstPosition);
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
    const sun = bareSun();
    const sys = new ShadowFrustumSystem(sun, fakeSunDirection(), CONFIG);
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
    const sun = bareSun();
    const sys = new ShadowFrustumSystem(sun, fakeSunDirection(), CONFIG);
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

  // Review fix regression: the OLD implementation derived direction from
  // `sun.position - sun.target.position`, which only stayed correct on frame 1
  // (target still at the origin). This test used to fake that correctness by
  // manually resetting `sun.target.position` to (0,0,0) between frames —
  // simulating a `DayCycleSystem` behaviour that doesn't exist and masking the
  // real bug (the frustum system, not the day cycle, owns `sun.target`).
  // Now it drives the fake direction source through several frames — including
  // a direction CHANGE, and a player position well off the origin, where the
  // old bug's error was largest — with no scene-graph reset of any kind, and
  // asserts the rendered direction matches the injected source every frame.
  it("tracks the sun direction as it changes across frames, off-origin, with no fake target reset", () => {
    const sun = bareSun();
    const direction = fakeSunDirection(NOON_DIRECTION);
    const sys = new ShadowFrustumSystem(sun, direction, CONFIG);

    const player: Vec3 = [100, 1.7, 20];
    sys.update(ctxAt(player[0], player[1], player[2]));
    let rendered = sun.position.clone().sub(sun.target.position).normalize();
    let expected = direction.getSunDirection();
    expect(rendered.x).toBeCloseTo(expected.x, 6);
    expect(rendered.y).toBeCloseTo(expected.y, 6);
    expect(rendered.z).toBeCloseTo(expected.z, 6);

    // The day cycle moves the sun to a new (dusk-ish) direction before the
    // NEXT frame — no manual target reset, just a new answer from the source.
    direction.set([-0.7, 0.3, 0.2]);
    sys.update(ctxAt(player[0], player[1], player[2]));
    rendered = sun.position.clone().sub(sun.target.position).normalize();
    expected = direction.getSunDirection();
    expect(rendered.x).toBeCloseTo(expected.x, 6);
    expect(rendered.y).toBeCloseTo(expected.y, 6);
    expect(rendered.z).toBeCloseTo(expected.z, 6);

    // A THIRD frame, still off-origin, still no reset — the old bug's error
    // compounded further with every additional frame.
    sys.update(ctxAt(player[0] + 5, player[1], player[2] + 5));
    rendered = sun.position.clone().sub(sun.target.position).normalize();
    expected = direction.getSunDirection();
    expect(rendered.x).toBeCloseTo(expected.x, 6);
    expect(rendered.y).toBeCloseTo(expected.y, 6);
    expect(rendered.z).toBeCloseTo(expected.z, 6);
  });
});
