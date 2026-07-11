// Regression test for a CONFIRMED code-review defect (visual-overhaul slice 2):
// `DayCycleSystem.update()` writes `sun.position` as an ABSOLUTE, origin-anchored
// vector (unit direction * SUN_DISTANCE) and never touches `sun.target`.
// `ShadowFrustumSystem.update()` used to derive its light direction as
// `sun.position - sun.target.position` — correct on frame 1 (target still sits
// at the origin), but from frame 2 onward `sun.target` has been parked at the
// player's snapped world position, so the derived direction becomes
// `D_n - player` instead of `D_n`: a steady-state skew that grows with the
// player's distance from the origin and corrupts diffuse shading AND shadow
// direction across the whole island.
//
// This test wires the REAL `DayCycleSystem` and REAL `ShadowFrustumSystem`
// together, sequential updates in `buildWorld`'s registration order (day cycle
// first — see `buildWorld.shadowFrustum.test.ts`'s pinned order assertion),
// with the player stationed well off the origin, and asserts the rendered
// light direction (`sun.position - sun.target.position`, normalized) matches
// the day cycle's own authoritative unit direction (`DayCycleSystem
// .getSunDirection()`) on EVERY frame — not just the first.

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { FrameContext } from "../engine/types.ts";
import { DayCycleSystem, PERIOD_SECONDS } from "./dayCycleSystem.ts";
import { ShadowFrustumSystem, type ShadowFrustumConfig } from "./shadowFrustumSystem.ts";

/** A `THREE.ShaderMaterial`-shaped fake exposing only the gradient uniforms
 *  `DayCycleSystem` writes (mirrors `dayCycleSystem.test.ts`'s fixture). */
function fakeDome(): THREE.ShaderMaterial {
  return {
    uniforms: {
      topColor: { value: new THREE.Color(0xffffff) },
      bottomColor: { value: new THREE.Color(0xffffff) },
      sunDirection: { value: new THREE.Vector3() },
      sunColor: { value: new THREE.Color(0xffffff) },
    },
  } as unknown as THREE.ShaderMaterial;
}

function ctxAt(x: number, y: number, z: number, dt: number): FrameContext {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(x, y, z);
  return { scene: new THREE.Scene(), camera, dt, elapsed: 0 };
}

const CONFIG: ShadowFrustumConfig = { halfExtent: 75, mapSize: 1024 };

describe("Sun direction stays consistent between DayCycleSystem and ShadowFrustumSystem off-origin (review fix)", () => {
  it("normalize(sun.position - sun.target.position) matches the day cycle's unit direction on EVERY frame", () => {
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    const dayCycle = new DayCycleSystem(sun, fakeDome(), null);
    const shadowFrustum = new ShadowFrustumSystem(sun, dayCycle, CONFIG);

    // Well off the origin — the bug's error grows with distance from it.
    const player: [number, number, number] = [100, 1.7, 20];
    // A meaningful dt each frame so the palette (and therefore the sun
    // direction) actually changes frame to frame — "spanning a palette change".
    const dtStep = 0.1 * PERIOD_SECONDS;

    for (let frame = 0; frame < 4; frame++) {
      const ctx = ctxAt(player[0], player[1], player[2], frame === 0 ? 0 : dtStep);
      // Registration order pinned in buildWorld.shadowFrustum.test.ts: day cycle
      // runs, THEN the shadow frustum, every frame.
      dayCycle.update(ctx);
      shadowFrustum.update(ctx);

      const expectedDir = dayCycle.getSunDirection();
      const renderedDir = sun.position.clone().sub(sun.target.position).normalize();

      expect(renderedDir.x).toBeCloseTo(expectedDir.x, 6);
      expect(renderedDir.y).toBeCloseTo(expectedDir.y, 6);
      expect(renderedDir.z).toBeCloseTo(expectedDir.z, 6);
    }
  });
});
