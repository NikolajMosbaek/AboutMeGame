import { describe, expect, it, beforeEach } from "vitest";
import * as THREE from "three";
import { VehicleSystem } from "./vehicle.ts";
import { buildTerrain } from "../world/terrain.ts";
import { buildBoundaries } from "../world/boundaries.ts";
import { WORLD } from "../world/worldConfig.ts";
import type { ControlState, InputSnapshot } from "./input.ts";
import type { FrameContext } from "../engine/types.ts";

function fakeInput() {
  const state: ControlState = { forward: 0, turn: 0, thrust: 0, boost: false };
  let toggle = false;
  let interact = false;
  const snap: InputSnapshot = {
    state,
    consumeToggleMode: () => {
      const v = toggle;
      toggle = false;
      return v;
    },
    consumeInteract: () => {
      const v = interact;
      interact = false;
      return v;
    },
  };
  return {
    snap,
    state,
    queueToggle: () => (toggle = true),
    queueInteract: () => (interact = true),
  };
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera();
function step(v: VehicleSystem, frames: number, dt = 1 / 60) {
  for (let i = 0; i < frames; i++) {
    const ctx: FrameContext = { scene, camera, dt, elapsed: i * dt };
    v.update(ctx);
  }
}

describe("VehicleSystem", () => {
  const terrain = buildTerrain();
  const boundaries = buildBoundaries();
  let input: ReturnType<typeof fakeInput>;
  let vehicle: VehicleSystem;

  beforeEach(() => {
    input = fakeInput();
    vehicle = new VehicleSystem(input.snap, terrain, boundaries, { x: 0, z: 0, yaw: 0 });
  });

  it("spawns on the ground at ride height", () => {
    const s = vehicle.state;
    expect(s.mode).toBe("drive");
    expect(s.position.y).toBeCloseTo(terrain.heightAt(0, 0) + 1.4, 1);
  });

  it("drives forward along its nose and stays on the terrain", () => {
    input.state.forward = 1;
    step(vehicle, 120); // 2s of acceleration
    const s = vehicle.state;
    expect(s.position.z).toBeGreaterThan(5); // moved +Z (yaw 0 ⇒ nose +Z)
    expect(s.speed).toBeGreaterThan(5);
    expect(s.position.y).toBeCloseTo(terrain.heightAt(s.position.x, s.position.z) + 1.4, 1);
  });

  it("never drives outside the world boundary", () => {
    input.state.forward = 1;
    step(vehicle, 1200); // 20s — would overshoot the island without clamping
    const { x, z } = vehicle.state.position;
    expect(Math.hypot(x, z)).toBeLessThanOrEqual(WORLD.boundaryRadius + 0.01);
  });

  it("toggles between drive and fly", () => {
    input.queueToggle();
    step(vehicle, 1);
    expect(vehicle.state.mode).toBe("fly");
    input.queueToggle();
    step(vehicle, 1);
    expect(vehicle.state.mode).toBe("drive");
  });

  it("gains altitude when flying with thrust, never sinking through the ground", () => {
    input.queueToggle();
    step(vehicle, 1); // now flying
    const before = vehicle.state.altitude;
    input.state.thrust = 1;
    input.state.forward = 0.2; // slight climb
    step(vehicle, 90);
    const after = vehicle.state;
    expect(after.altitude).toBeGreaterThan(before);
    const floor = terrain.heightAt(after.position.x, after.position.z);
    expect(after.position.y).toBeGreaterThan(floor); // above the ground
  });
});
