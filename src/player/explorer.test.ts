import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ExplorerSystem, TUNE, forwardXZFromYaw, rightXZFromYaw, compassDegFromYaw } from "./explorer.ts";
import type { Boundaries } from "../world/boundaries.ts";
import { createSession } from "../gameSession.ts";
import { FRAME, fakeInput, fakeTerrain, openBounds, seaLevelWater, noWater } from "./testDoubles.ts";
import { WORLD } from "../world/worldConfig.ts";

function run(sys: ExplorerSystem, frames: number) {
  for (let i = 0; i < frames; i++) sys.update(FRAME);
}

describe("ExplorerSystem (pivot slice B)", () => {
  it("spawns with feet on the terrain", () => {
    const t = fakeTerrain(7);
    const sys = new ExplorerSystem(fakeInput().snap, t, openBounds(), noWater(), { x: 3, z: 4 });
    expect(sys.state.position.y).toBe(7);
  });

  it("walks forward along +Z at walk speed when facing yaw 0", () => {
    const input = fakeInput();
    const t = fakeTerrain(0);
    const sys = new ExplorerSystem(input.snap, t, openBounds(), noWater(), { x: 0, z: 0, yaw: 0 });
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
    const sys = new ExplorerSystem(input.snap, fakeTerrain(0), openBounds(), noWater(), { x: 0, z: 0 });
    input.state.moveZ = 1;
    input.state.sprint = true;
    run(sys, 120);
    expect(sys.state.speed).toBeGreaterThan(TUNE.walkSpeed);
    expect(sys.state.sprinting).toBe(true);
  });

  it("sprint held with no movement is not sprinting", () => {
    const input = fakeInput();
    const sys = new ExplorerSystem(input.snap, fakeTerrain(0), openBounds(), noWater(), { x: 0, z: 0 });
    input.state.sprint = true;
    run(sys, 10);
    expect(sys.state.sprinting).toBe(false);
    expect(sys.state.speed).toBeLessThan(0.1);
  });

  it("look deltas turn the view and clamp pitch", () => {
    const input = fakeInput();
    const sys = new ExplorerSystem(input.snap, fakeTerrain(0), openBounds(), noWater(), { x: 0, z: 0, yaw: 0 });
    input.look.dx = Math.PI / 2; // quarter turn right (yaw is CCW-positive, so it decreases)
    sys.update(FRAME);
    expect(sys.state.yaw).toBeCloseTo(-Math.PI / 2, 5);

    input.look.dy = 10; // an absurd downward drag…
    sys.update(FRAME);
    expect(sys.state.pitch).toBe(-TUNE.maxPitch); // …clamps, never flips
  });

  it("strafe right moves along the camera's screen-right (-X when facing +Z)", () => {
    const input = fakeInput();
    const sys = new ExplorerSystem(input.snap, fakeTerrain(0), openBounds(), noWater(), { x: 0, z: 0, yaw: 0 });
    input.state.moveX = 1; // strafe right while facing +Z (south) → west = -X
    run(sys, 60);
    expect(sys.state.position.x).toBeLessThan(-2);
    expect(Math.abs(sys.state.position.z)).toBeLessThan(1e-6);
  });

  it("refuses steps up a cliff (grade beyond slopeBlockGrade)", () => {
    const input = fakeInput();
    // A wall at z >= 2: instant +50 m rise.
    const t = fakeTerrain(0, (_x, z) => (z >= 2 ? 50 : 0));
    const sys = new ExplorerSystem(input.snap, t, openBounds(), noWater(), { x: 0, z: 0, yaw: 0 });
    input.state.moveZ = 1;
    run(sys, 240); // 4 s of pushing at the wall
    expect(sys.state.position.z).toBeLessThan(2); // never climbed it
  });

  it("slows but passes a moderate uphill", () => {
    const input = fakeInput();
    // A steady 30% grade — hikeable.
    const t = fakeTerrain(0, (_x, z) => Math.max(0, z) * 0.3);
    const sys = new ExplorerSystem(input.snap, t, openBounds(), noWater(), { x: 0, z: 0, yaw: 0 });
    input.state.moveZ = 1;
    run(sys, 120);
    expect(sys.state.position.z).toBeGreaterThan(4); // still makes progress
    expect(sys.state.position.y).toBeCloseTo(sys.state.position.z * 0.3, 3); // feet on the slope
  });

  it("wades slowly through shallow water and refuses deep water", () => {
    const input = fakeInput();
    // Ground dips below sea level past z=0: -0.6 m (wade) then -3 m (deep) past z=6.
    const t = fakeTerrain(0, (_x, z) =>
      z < 0 ? 1 : z < 6 ? WORLD.seaLevel - 0.6 : WORLD.seaLevel - 3,
    );
    const sys = new ExplorerSystem(input.snap, t, openBounds(), seaLevelWater(t), { x: 0, z: 2, yaw: 0 });
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
    const sys = new ExplorerSystem(input.snap, fakeTerrain(0), openBounds(), noWater(), { x: 0, z: 0 }, session);
    input.state.moveZ = 1;
    run(sys, 60);
    const before = sys.state.position.clone();
    const yawBefore = sys.state.yaw;

    session.setPaused("menu", true);
    input.look.dx = 2; // a big drag behind the menu
    run(sys, 30);
    expect(sys.state.position.x).toBe(before.x);
    expect(sys.state.position.z).toBe(before.z);
    expect(sys.state.speed).toBe(0);

    session.setPaused("menu", false);
    sys.update(FRAME);
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
    const sys = new ExplorerSystem(input.snap, fakeTerrain(0), clamped, noWater(), { x: 8, z: 0, yaw: Math.PI / 2 });
    input.state.moveZ = 1; // facing +X
    run(sys, 300);
    expect(sys.state.position.x).toBeLessThanOrEqual(10);
  });
});

describe("yaw convention helpers (the ONE definition)", () => {
  it("forwardXZFromYaw: yaw 0 faces +Z, +π/2 (a CCW/left turn) faces +X, and stays unit", () => {
    expect(forwardXZFromYaw(0)).toEqual({ x: 0, z: 1 });
    const east = forwardXZFromYaw(Math.PI / 2);
    expect(east.x).toBeCloseTo(1, 6);
    expect(east.z).toBeCloseTo(0, 6);
    const f = forwardXZFromYaw(1.234);
    expect(Math.hypot(f.x, f.z)).toBeCloseTo(1, 6);
  });

  it("rightXZFromYaw is forward × up: facing +Z, screen-right is -X; the pair stays perpendicular", () => {
    const r0 = rightXZFromYaw(0);
    expect(r0.x).toBeCloseTo(-1, 6);
    expect(r0.z).toBeCloseTo(0, 6);
    const yaw = 0.83;
    const f = forwardXZFromYaw(yaw);
    const r = rightXZFromYaw(yaw);
    expect(f.x * r.x + f.z * r.z).toBeCloseTo(0, 6); // perpendicular
  });

  it("compassDegFromYaw: yaw 0 (facing +Z) reads S=180°, facing -Z reads N=0°, facing +X reads E=90°", () => {
    expect(compassDegFromYaw(0)).toBe(180);
    expect(compassDegFromYaw(Math.PI)).toBeCloseTo(0, 6);
    expect(compassDegFromYaw(Math.PI / 2)).toBeCloseTo(90, 6);
    // Always normalised into 0..360.
    expect(compassDegFromYaw(-7 * Math.PI)).toBeGreaterThanOrEqual(0);
    expect(compassDegFromYaw(-7 * Math.PI)).toBeLessThan(360);
  });
});
