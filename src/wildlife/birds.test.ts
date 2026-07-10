import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  ALERT_RADIUS,
  BirdsSystem,
  FLOCK_COUNT,
  FLOCK_WAYPOINTS,
  REGROUP_DURATION,
  SCATTER_MIN_DURATION,
  TOTAL_BIRDS,
  birdPose,
  initialFlockState,
  scatterFactor,
  stepFlock,
  type FlockState,
} from "./birds.ts";
import { buildTerrain } from "../world/terrain.ts";

const FRAME = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), dt: 1 / 60, elapsed: 0 };

function player(x: number, z: number) {
  return { state: { position: new THREE.Vector3(x, 0, z) } };
}

describe("stepFlock (birds scatter/regroup state machine)", () => {
  it("stays orbiting while the player is outside the alert radius", () => {
    let s = initialFlockState();
    for (let i = 0; i < 60; i++) s = stepFlock(s, 1 / 60, ALERT_RADIUS + 5);
    expect(s.mode).toBe("orbit");
  });

  it("scatters the instant the player closes inside the alert radius", () => {
    const s = stepFlock(initialFlockState(), 1 / 60, ALERT_RADIUS - 1);
    expect(s.mode).toBe("scatter");
  });

  it("holds scatter for the full minimum duration even if the player backs off immediately", () => {
    let s = stepFlock(initialFlockState(), 0, ALERT_RADIUS - 1); // enters scatter
    // Player instantly retreats, but scatter must hold at least SCATTER_MIN_DURATION.
    s = stepFlock(s, SCATTER_MIN_DURATION - 0.1, ALERT_RADIUS + 50);
    expect(s.mode).toBe("scatter");
  });

  it("moves to regroup once the minimum has elapsed AND the player is clear", () => {
    let s = stepFlock(initialFlockState(), 0, ALERT_RADIUS - 1);
    s = stepFlock(s, SCATTER_MIN_DURATION + 0.1, ALERT_RADIUS + 50);
    expect(s.mode).toBe("regroup");
  });

  it("stays scattered past the minimum if the player is still close", () => {
    let s = stepFlock(initialFlockState(), 0, ALERT_RADIUS - 1);
    s = stepFlock(s, SCATTER_MIN_DURATION + 0.1, ALERT_RADIUS - 1);
    expect(s.mode).toBe("scatter");
  });

  it("regroup restarts scatter if the player closes in again", () => {
    let s: FlockState = { mode: "regroup", timer: 0.5 };
    s = stepFlock(s, 1 / 60, ALERT_RADIUS - 1);
    expect(s.mode).toBe("scatter");
    expect(s.timer).toBe(0);
  });

  it("regroup completes into orbit after REGROUP_DURATION with the player clear", () => {
    let s: FlockState = { mode: "regroup", timer: 0 };
    s = stepFlock(s, REGROUP_DURATION + 0.01, ALERT_RADIUS + 50);
    expect(s.mode).toBe("orbit");
  });
});

describe("scatterFactor", () => {
  it("is 0 while orbiting and 1 once scatter has fully climbed out", () => {
    expect(scatterFactor("orbit", 0)).toBe(0);
    expect(scatterFactor("scatter", 100)).toBe(1);
  });

  it("eases back to 0 across the regroup window", () => {
    expect(scatterFactor("regroup", 0)).toBe(1);
    expect(scatterFactor("regroup", REGROUP_DURATION)).toBe(0);
  });
});

describe("birdPose (determinism)", () => {
  it("is a pure function: identical inputs produce identical output", () => {
    const center = { x: 10, y: 5, z: -10 };
    const a = birdPose(center, "scatter", 1.2, 42, 3);
    const b = birdPose(center, "scatter", 1.2, 42, 3);
    expect(a).toEqual(b);
  });

  it("puffs radius outward as scatter's factor grows", () => {
    const center = { x: 0, y: 0, z: 0 };
    const orbitPos = birdPose(center, "orbit", 0, 0, 0);
    const scatterPos = birdPose(center, "scatter", 1, 0, 0);
    const rOrbit = Math.hypot(orbitPos.x - center.x, orbitPos.z - center.z);
    const rScatter = Math.hypot(scatterPos.x - center.x, scatterPos.z - center.z);
    expect(rScatter).toBeGreaterThan(rOrbit);
  });
});

describe("BirdsSystem", () => {
  const terrain = buildTerrain();

  function rig(px = 0, pz = 0) {
    const scene = new THREE.Scene();
    const session = { paused: false };
    const sys = new BirdsSystem(scene, terrain, player(px, pz), session);
    return { scene, session, sys };
  }

  it("builds exactly 2 draw calls (body + wing InstancedMesh) regardless of bird count", () => {
    const { scene } = rig();
    let meshes = 0;
    scene.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) meshes++;
    });
    expect(meshes).toBe(2);
  });

  it(`instances ${TOTAL_BIRDS} birds across ${FLOCK_COUNT} flocks`, () => {
    const { scene } = rig();
    const meshes: THREE.InstancedMesh[] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) meshes.push(o);
    });
    for (const m of meshes) expect(m.count).toBe(TOTAL_BIRDS);
  });

  it("holds all movement while the session is paused", () => {
    const { session, sys } = rig(1000, 1000); // far from any flock
    session.paused = true;
    const before = sys.describe();
    for (let i = 0; i < 300; i++) sys.update(FRAME);
    expect(sys.describe()).toEqual(before);
  });

  it("does not react to a nearby player while paused, but scatters once resumed", () => {
    // Build directly on a flock's waypoint so the player starts "on top of" it.
    const wp = FLOCK_WAYPOINTS[0];
    const scene = new THREE.Scene();
    const session = { paused: true };
    const sys = new BirdsSystem(scene, terrain, player(wp.x, wp.z), session);

    for (let i = 0; i < 10; i++) sys.update(FRAME);
    expect(sys.describe()).toEqual({ flocks: ["orbit", "orbit"] });

    session.paused = false;
    for (let i = 0; i < 30; i++) sys.update(FRAME);
    const state = sys.describe() as { flocks: string[] };
    expect(state.flocks[0]).toBe("scatter");
  });

  it("disposes every geometry/material without throwing, and detaches from the scene", () => {
    const { scene, sys } = rig();
    expect(() => sys.dispose()).not.toThrow();
    expect(scene.children.find((o) => o.name === "wildlife-birds")).toBeUndefined();
  });
});
