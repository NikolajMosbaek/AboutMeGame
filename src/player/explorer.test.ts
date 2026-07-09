import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ExplorerSystem, TUNE } from "./explorer.ts";
import type { PlayerInputSnapshot, MoveState, LookDelta } from "./input.ts";
import type { Terrain } from "../world/terrain.ts";
import type { Boundaries } from "../world/boundaries.ts";
import { createSession } from "../gameSession.ts";
import type { FrameContext } from "../engine/types.ts";
import { WORLD } from "../world/worldConfig.ts";

const ctx: FrameContext = {
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(),
  dt: 1 / 60,
  elapsed: 0,
};

/** A scripted input: tests write `state`/`look`/`interact` directly. */
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

/** Flat terrain at a fixed height, with optional overrides per region. */
function flatTerrain(height = 5, heightAt?: (x: number, z: number) => number): Terrain {
  return {
    heightAt: heightAt ?? (() => height),
    mesh: undefined,
  } as unknown as Terrain;
}

function openBounds(): Boundaries {
  return { clampToBounds: () => {} } as unknown as Boundaries;
}

function run(sys: ExplorerSystem, frames: number) {
  for (let i = 0; i < frames; i++) sys.update(ctx);
}

describe("ExplorerSystem (pivot slice B)", () => {
  it("spawns with feet on the terrain", () => {
    const sys = new ExplorerSystem(fakeInput().snap, flatTerrain(7), openBounds(), { x: 3, z: 4 });
    expect(sys.state.position.y).toBe(7);
    expect(sys.state.mode).toBe("walk");
  });

  it("walks forward along +Z at walk speed when facing yaw 0", () => {
    const input = fakeInput();
    const sys = new ExplorerSystem(input.snap, flatTerrain(0), openBounds(), { x: 0, z: 0, yaw: 0 });
    input.state.moveZ = 1;
    run(sys, 120); // 2 s — plenty to reach cruise
    const s = sys.state;
    expect(s.position.z).toBeGreaterThan(6); // moved meaningfully
    expect(Math.abs(s.position.x)).toBeLessThan(1e-6); // no drift
    expect(s.speed).toBeGreaterThan(TUNE.walkSpeed * 0.95);
    expect(s.speed).toBeLessThanOrEqual(TUNE.walkSpeed + 1e-6);
    expect(s.sprinting).toBe(false);
  });

  it("sprints faster than walking, and reports it", () => {
    const input = fakeInput();
    const sys = new ExplorerSystem(input.snap, flatTerrain(0), openBounds(), { x: 0, z: 0 });
    input.state.moveZ = 1;
    input.state.sprint = true;
    run(sys, 120);
    expect(sys.state.speed).toBeGreaterThan(TUNE.walkSpeed);
    expect(sys.state.sprinting).toBe(true);
  });

  it("sprint held with no movement is not sprinting", () => {
    const input = fakeInput();
    const sys = new ExplorerSystem(input.snap, flatTerrain(0), openBounds(), { x: 0, z: 0 });
    input.state.sprint = true;
    run(sys, 10);
    expect(sys.state.sprinting).toBe(false);
    expect(sys.state.speed).toBeLessThan(0.1);
  });

  it("look deltas turn the view and clamp pitch", () => {
    const input = fakeInput();
    const sys = new ExplorerSystem(input.snap, flatTerrain(0), openBounds(), { x: 0, z: 0, yaw: 0 });
    input.look.dx = Math.PI / 2; // quarter turn right
    sys.update(ctx);
    expect(sys.state.yaw).toBeCloseTo(Math.PI / 2, 5);

    input.look.dy = 10; // an absurd downward drag…
    sys.update(ctx);
    expect(sys.state.pitch).toBe(-TUNE.maxPitch); // …clamps, never flips

    // The nose follows yaw/pitch and stays unit length.
    expect(sys.state.nose.length()).toBeCloseTo(1, 5);
  });

  it("strafe moves perpendicular to the view", () => {
    const input = fakeInput();
    const sys = new ExplorerSystem(input.snap, flatTerrain(0), openBounds(), { x: 0, z: 0, yaw: 0 });
    input.state.moveX = 1; // strafe right while facing +Z
    run(sys, 60);
    expect(sys.state.position.x).toBeGreaterThan(2);
    expect(Math.abs(sys.state.position.z)).toBeLessThan(1e-6);
  });

  it("refuses steps up a cliff (grade beyond slopeBlockGrade)", () => {
    const input = fakeInput();
    // A wall at z >= 2: instant +50 m rise.
    const terrain = flatTerrain(0, (_x, z) => (z >= 2 ? 50 : 0));
    const sys = new ExplorerSystem(input.snap, terrain, openBounds(), { x: 0, z: 0, yaw: 0 });
    input.state.moveZ = 1;
    run(sys, 240); // 4 s of pushing at the wall
    expect(sys.state.position.z).toBeLessThan(2); // never climbed it
  });

  it("slows but passes a moderate uphill", () => {
    const input = fakeInput();
    // A steady 30% grade — hikeable.
    const terrain = flatTerrain(0, (_x, z) => Math.max(0, z) * 0.3);
    const sys = new ExplorerSystem(input.snap, terrain, openBounds(), { x: 0, z: 0, yaw: 0 });
    input.state.moveZ = 1;
    run(sys, 120);
    expect(sys.state.position.z).toBeGreaterThan(4); // still makes progress
    expect(sys.state.position.y).toBeCloseTo(sys.state.position.z * 0.3, 3); // feet on the slope
  });

  it("wades slowly through shallow water and refuses deep water", () => {
    const input = fakeInput();
    // Ground dips below sea level past z=0: -0.6 m (wade) then -3 m (deep) past z=6.
    const terrain = flatTerrain(0, (_x, z) =>
      z < 0 ? 1 : z < 6 ? WORLD.seaLevel - 0.6 : WORLD.seaLevel - 3,
    );
    const sys = new ExplorerSystem(input.snap, terrain, openBounds(), { x: 0, z: 2, yaw: 0 });
    input.state.moveZ = 1;
    run(sys, 60);
    expect(sys.state.wading).toBe(true);
    const wadeZ = sys.state.position.z;
    expect(wadeZ).toBeGreaterThan(2.5); // moving…
    expect(wadeZ).toBeLessThan(2 + TUNE.walkSpeed * 1); // …but visibly slowed

    run(sys, 600); // push on toward the deep channel for 10 s
    expect(sys.state.position.z).toBeLessThan(6); // never entered depth > maxWadeDepth
  });

  it("holds still and drains look while the session is paused", () => {
    const input = fakeInput();
    const session = createSession();
    const sys = new ExplorerSystem(input.snap, flatTerrain(0), openBounds(), { x: 0, z: 0 }, session);
    input.state.moveZ = 1;
    run(sys, 60);
    const before = sys.state.position.clone();
    const yawBefore = sys.state.yaw;

    session.setPaused("menu", true);
    input.look.dx = 2; // a big drag behind the menu
    run(sys, 30);
    expect(sys.state.position).toEqual(before);
    expect(sys.state.speed).toBe(0);

    session.setPaused("menu", false);
    sys.update(ctx);
    // The drag from behind the menu was drained, not applied on resume.
    expect(sys.state.yaw).toBeCloseTo(yawBefore, 5);
  });

  it("clamps to the world boundaries", () => {
    const input = fakeInput();
    const clamped: Boundaries = {
      clampToBounds: (p: THREE.Vector3) => {
        p.x = Math.min(p.x, 10);
      },
    } as unknown as Boundaries;
    const sys = new ExplorerSystem(input.snap, flatTerrain(0), clamped, { x: 8, z: 0, yaw: Math.PI / 2 });
    input.state.moveZ = 1; // facing +X
    run(sys, 300);
    expect(sys.state.position.x).toBeLessThanOrEqual(10);
  });
});
