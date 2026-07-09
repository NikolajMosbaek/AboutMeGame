import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FirstPersonCameraSystem } from "./fpCamera.ts";
import { ExplorerSystem, TUNE } from "./explorer.ts";
import type { PlayerInputSnapshot, MoveState, LookDelta } from "./input.ts";
import type { Terrain } from "../world/terrain.ts";
import type { Boundaries } from "../world/boundaries.ts";
import type { Engine } from "../engine/Engine.ts";
import type { FrameContext } from "../engine/types.ts";

const ctx: FrameContext = {
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(),
  dt: 1 / 60,
  elapsed: 0,
};

function fakeInput() {
  const state: MoveState = { moveX: 0, moveZ: 0, sprint: false };
  const look: LookDelta = { dx: 0, dy: 0 };
  const snap: PlayerInputSnapshot = {
    state,
    consumeLook: () => {
      const d = { ...look };
      look.dx = 0;
      look.dy = 0;
      return d;
    },
    consumeInteract: () => false,
  };
  return { snap, state, look };
}

function flat(height = 0): Terrain {
  return { heightAt: () => height } as unknown as Terrain;
}
function open(): Boundaries {
  return { clampToBounds: () => {} } as unknown as Boundaries;
}
function fakeEngine() {
  return { camera: new THREE.PerspectiveCamera() } as unknown as Engine;
}

function motion(reducedMotion: boolean) {
  return { getSnapshot: () => ({ reducedMotion }) };
}

describe("FirstPersonCameraSystem (pivot slice B)", () => {
  it("puts the eye at eye height above the feet when standing still", () => {
    const engine = fakeEngine();
    const explorer = new ExplorerSystem(fakeInput().snap, flat(5), open(), { x: 2, z: 3 });
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
    const explorer = new ExplorerSystem(input.snap, flat(0), open(), { x: 0, z: 0, yaw: 0 });
    const cam = new FirstPersonCameraSystem(engine, explorer);
    explorer.update(ctx);
    cam.update(ctx);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(engine.camera.quaternion);
    // Explorer yaw 0 faces +Z: the camera's forward must agree.
    expect(fwd.z).toBeCloseTo(1, 3);
    expect(Math.abs(fwd.x)).toBeLessThan(1e-3);

    input.look.dx = Math.PI / 2; // turn right (east = +X)
    explorer.update(ctx);
    cam.update(ctx);
    const fwd2 = new THREE.Vector3(0, 0, -1).applyQuaternion(engine.camera.quaternion);
    expect(fwd2.x).toBeCloseTo(1, 3);
  });

  it("bobs the head while walking and holds steady when reduced motion is on", () => {
    const walkedHeights = (reduced: boolean) => {
      const engine = fakeEngine();
      const input = fakeInput();
      const explorer = new ExplorerSystem(input.snap, flat(0), open(), { x: 0, z: 0 });
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
