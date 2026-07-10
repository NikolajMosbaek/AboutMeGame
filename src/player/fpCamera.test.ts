import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FirstPersonCameraSystem } from "./fpCamera.ts";
import { ExplorerSystem, TUNE } from "./explorer.ts";
import type { Engine } from "../engine/Engine.ts";
import { FRAME as ctx, fakeInput, fakeTerrain as flat, openBounds as open, noWater } from "./testDoubles.ts";

function fakeEngine() {
  return { camera: new THREE.PerspectiveCamera() } as unknown as Engine;
}

function motion(reducedMotion: boolean) {
  return { getSnapshot: () => ({ reducedMotion }) };
}

describe("FirstPersonCameraSystem (pivot slice B)", () => {
  it("puts the eye at eye height above the feet when standing still", () => {
    const engine = fakeEngine();
    const explorer = new ExplorerSystem(fakeInput().snap, flat(5), open(), noWater(), { x: 2, z: 3 });
    const cam = new FirstPersonCameraSystem(engine, explorer);
    explorer.update(ctx);
    cam.update(ctx);
    expect(engine.camera.position.x).toBeCloseTo(2, 5);
    expect(engine.camera.position.y).toBeCloseTo(5 + TUNE.eyeHeight, 5);
    expect(engine.camera.position.z).toBeCloseTo(3, 5);
  });

  it("faces the camera along the explorer's ground forward", () => {
    const engine = fakeEngine();
    const input = fakeInput();
    const explorer = new ExplorerSystem(input.snap, flat(0), open(), noWater(), { x: 0, z: 0, yaw: 0 });
    const cam = new FirstPersonCameraSystem(engine, explorer);
    explorer.update(ctx);
    cam.update(ctx);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(engine.camera.quaternion);
    // Explorer yaw 0 faces +Z: the camera's forward must agree.
    expect(fwd.z).toBeCloseTo(1, 3);
    expect(Math.abs(fwd.x)).toBeLessThan(1e-3);

    input.look.dx = Math.PI / 2; // device "turn right": facing +Z (south), right is west = -X
    explorer.update(ctx);
    cam.update(ctx);
    const fwd2 = new THREE.Vector3(0, 0, -1).applyQuaternion(engine.camera.quaternion);
    expect(fwd2.x).toBeCloseTo(-1, 3);
  });

  it("bobs the head while walking and holds steady when reduced motion is on", () => {
    const walkedHeights = (reduced: boolean) => {
      const engine = fakeEngine();
      const input = fakeInput();
      const explorer = new ExplorerSystem(input.snap, flat(0), open(), noWater(), { x: 0, z: 0 });
      const cam = new FirstPersonCameraSystem(engine, explorer, motion(reduced));
      input.state.moveZ = 1;
      const ys: number[] = [];
      for (let i = 0; i < 120; i++) {
        explorer.update(ctx);
        cam.update(ctx);
        ys.push(engine.camera.position.y);
      }
      return ys;
    };

    const moving = walkedHeights(false);
    const spread = Math.max(...moving) - Math.min(...moving);
    expect(spread).toBeGreaterThan(0.01); // visible bob…
    expect(spread).toBeLessThan(0.2); // …but subtle

    const reduced = walkedHeights(true);
    const spreadReduced = Math.max(...reduced) - Math.min(...reduced);
    expect(spreadReduced).toBeLessThan(1e-6); // dead level under reduced motion
  });
});

describe("FirstPersonCameraSystem while swimming (#184)", () => {
  function swimRig() {
    const engine = fakeEngine();
    const input = fakeInput();
    // Uniform deep water; a boundless lagoon zone makes it swimmable.
    const t = flat(-5);
    const explorer = new ExplorerSystem(
      input.snap, t, open(), (x, z) => 0 - t.heightAt(x, z), { x: 0, z: 0 },
      undefined, undefined, { inLagoon: () => true, riverFlowAt: () => null },
    );
    const cam = new FirstPersonCameraSystem(engine, explorer);
    return { engine, input, explorer, cam };
  }

  it("rides the swimming eye height, not the walking one", () => {
    const { engine, explorer, cam } = swimRig();
    explorer.update(ctx); // enters the swim, floats at the surface
    cam.update(ctx);
    expect(explorer.state.mode).toBe("swim");
    expect(engine.camera.position.y).toBeCloseTo(
      explorer.state.position.y + TUNE.swimEyeHeight,
      5,
    );
  });

  it("does not head-bob in the water, even at cruise speed", () => {
    const { engine, input, explorer, cam } = swimRig();
    input.state.moveZ = 1;
    const ys: number[] = [];
    const rel: number[] = [];
    for (let i = 0; i < 120; i++) {
      explorer.update(ctx);
      cam.update(ctx);
      ys.push(engine.camera.position.y);
      rel.push(engine.camera.position.y - explorer.state.position.y);
    }
    expect(explorer.state.speed).toBeGreaterThan(1); // genuinely moving
    // Eye tracks the body exactly — no stride bob layered on the water line.
    const spread = Math.max(...rel) - Math.min(...rel);
    expect(spread).toBeLessThan(1e-6);
  });
});
