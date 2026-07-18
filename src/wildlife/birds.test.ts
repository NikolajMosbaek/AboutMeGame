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
import { SPRINT_FLUSH_RADIUS, SPRINT_FLUSH_SPEED } from "./birds.ts";
import { COMIC_TIMING, PLAIN_TIMING } from "./reactions.ts";
import { buildTerrain } from "../world/terrain.ts";

const FRAME = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), dt: 1 / 60, elapsed: 0 };

function player(x: number, z: number, speed = 0) {
  return { state: { position: new THREE.Vector3(x, 0, z), speed } };
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
    let s: FlockState = { mode: "regroup", timer: 0.5, refractory: 0 };
    s = stepFlock(s, 1 / 60, ALERT_RADIUS - 1);
    expect(s.mode).toBe("scatter");
    expect(s.timer).toBe(0);
  });

  it("regroup completes into orbit after REGROUP_DURATION with the player clear", () => {
    let s: FlockState = { mode: "regroup", timer: 0, refractory: 0 };
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
  it("sprint-past inside the flush radius holds a comic freeze beat, THEN flushes (J1 #219)", () => {
    // Sprinting at 20 u — outside the walk alert (18) but inside the flush
    // radius (26) — startles the flock through the grammar's freeze beat.
    let s = stepFlock(initialFlockState(), 0.1, 20, SPRINT_FLUSH_SPEED + 1, COMIC_TIMING);
    expect(s.mode).toBe("freeze");
    // The beat is COMMITTED — it plays out even if the sprint stops.
    for (let t = 0; t < COMIC_TIMING.freezeSeconds - 0.1; t += 0.1) {
      s = stepFlock(s, 0.1, 20, 0, COMIC_TIMING);
      expect(s.mode).toBe("freeze");
    }
    s = stepFlock(s, 0.2, 20, 0, COMIC_TIMING);
    expect(s.mode).toBe("flush");
  });

  it("walking at the same distance does NOT flush — speed is the trigger", () => {
    const s = stepFlock(initialFlockState(), 0.1, 20, 3, COMIC_TIMING);
    expect(s.mode).toBe("orbit");
  });

  it("sprinting beyond the flush radius does nothing", () => {
    const s = stepFlock(initialFlockState(), 0.1, SPRINT_FLUSH_RADIUS + 1, 8, COMIC_TIMING);
    expect(s.mode).toBe("orbit");
  });

  it("walking inside the alert radius still scatters immediately (unchanged contract)", () => {
    const s = stepFlock(initialFlockState(), 0.1, ALERT_RADIUS - 1, 3, COMIC_TIMING);
    expect(s.mode).toBe("scatter");
  });

  it("reduced motion (PLAIN_TIMING) skips the freeze beat — straight to flush", () => {
    const s = stepFlock(initialFlockState(), 0.1, 20, 8, PLAIN_TIMING);
    expect(s.mode).toBe("flush");
  });

  it("the flush arms the grammar's refractory — lapping the flock is one gag per cooldown", () => {
    // Complete a full flush cycle, then keep sprinting in the annulus: no
    // re-flush until the cooldown has drained.
    let s = stepFlock(initialFlockState(), 0.1, 20, 8, COMIC_TIMING);
    expect(s.mode).toBe("freeze");
    let elapsed = 0.1;
    while (s.mode !== "orbit" && elapsed < 20) {
      s = stepFlock(s, 0.1, 20, 8, COMIC_TIMING);
      elapsed += 0.1;
    }
    expect(s.mode).toBe("orbit");
    // Still inside the refractory (cooldown 8 s > the ~5.5 s cycle): no flush.
    s = stepFlock(s, 0.1, 20, 8, COMIC_TIMING);
    expect(s.mode).toBe("orbit");
    // Drain the remaining refractory, then the NEXT sprint-past fires again.
    while (s.refractory > 0) s = stepFlock(s, 0.1, 40, 0, COMIC_TIMING);
    s = stepFlock(s, 0.1, 20, 8, COMIC_TIMING);
    expect(s.mode).toBe("freeze");
  });

  it("flush settles into regroup like a scatter once the player is clear", () => {
    let s: FlockState = { mode: "flush", timer: 0, refractory: 0 };
    for (let t = 0; t < SCATTER_MIN_DURATION + 0.2; t += 0.1) {
      s = stepFlock(s, 0.1, 40, 0, COMIC_TIMING);
    }
    expect(s.mode).toBe("regroup");
  });

  it("is a pure function: identical inputs produce identical output", () => {
    const center = { x: 10, y: 5, z: -10 };
    const a = birdPose(center, "scatter", 1.2, 42, 3);
    const b = birdPose(center, "scatter", 1.2, 42, 3);
    expect(a).toEqual(b);
  });

  it("holds the pose during the freeze beat: factor 0 and wings dead-still", () => {
    expect(scatterFactor("freeze", 0.2)).toBe(0);
    const pose = birdPose({ x: 0, y: 20, z: 0 }, "freeze", 0.2, 5, 0);
    expect(pose.flap).toBe(0); // wings held — the "…!" beat
  });

  it("flush overshoots past a plain scatter's full spread, then settles", () => {
    // Mid-flush the overshoot envelope exceeds 1 (a plain scatter caps at 1).
    const climbed = scatterFactor("flush", 0.25);
    expect(climbed).toBeGreaterThan(1);
    // By the end of the react window it has settled back to ~1.
    expect(scatterFactor("flush", COMIC_TIMING.reactSeconds)).toBeCloseTo(1, 1);
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

  it("justFlushed() reports a flush edge exactly once — the audio seam (J1 #219)", () => {
    const scene = new THREE.Scene();
    // Sprinting 20 u from flock 0's waypoint: outside walk-alert, inside flush.
    const wp = FLOCK_WAYPOINTS[0];
    const sys = new BirdsSystem(scene, buildTerrain(), player(wp.x - 20, wp.z, 8), {
      paused: false,
    });
    let edges = 0;
    for (let i = 0; i < 90; i++) {
      sys.update(FRAME);
      if (sys.justFlushed()) edges++;
    }
    expect(edges).toBe(1); // one flush, one edge — held flush never re-reports
    sys.dispose();
  });

  it("honours reduced motion: no freeze beat, flush starts on the first frame", () => {
    const scene = new THREE.Scene();
    const wp = FLOCK_WAYPOINTS[0];
    const sys = new BirdsSystem(
      scene,
      buildTerrain(),
      player(wp.x - 20, wp.z, 8),
      { paused: false },
      { getSnapshot: () => ({ reducedMotion: true }) },
    );
    sys.update(FRAME);
    expect(sys.justFlushed()).toBe(true); // no held beat before the edge
    sys.dispose();
  });

  it("startle() sends every flock into a fresh scatter at once (the treasure finale)", () => {
    const { sys } = rig(1000, 1000); // player far away — nothing would scatter alone
    for (let i = 0; i < 10; i++) sys.update(FRAME);
    expect(sys.describe()).toEqual({ flocks: ["orbit", "orbit"] });

    sys.startle();
    expect(sys.describe()).toEqual({ flocks: ["scatter", "scatter"] });

    // A committed startle, exactly like a player-triggered one: it holds for
    // the scatter minimum even with no one nearby.
    for (let i = 0; i < Math.floor((SCATTER_MIN_DURATION - 0.2) * 60); i++) sys.update(FRAME);
    expect(sys.describe()).toEqual({ flocks: ["scatter", "scatter"] });
  });

  it("disposes every geometry/material without throwing, and detaches from the scene", () => {
    const { scene, sys } = rig();
    expect(() => sys.dispose()).not.toThrow();
    expect(scene.children.find((o) => o.name === "wildlife-birds")).toBeUndefined();
  });

  it("builds a body with a head/beak/tail (Objects slice 2), not a bare cone", () => {
    const { scene } = rig();
    const body = scene.getObjectByName("wildlife-bird-body") as THREE.InstancedMesh;
    // The prior bare 4-sided cone was 8 triangles; the merged
    // torso+head+beak+tail body is real geometry beyond that.
    const tris = body.geometry.getAttribute("position").count / 3;
    expect(tris).toBeGreaterThan(8);
  });

  it("gives the wing a tapered (root-wider-than-tip) planform, not a single degenerate triangle per side", () => {
    const { scene } = rig();
    const wing = scene.getObjectByName("wildlife-bird-wing") as THREE.InstancedMesh;
    const verts = wing.geometry.getAttribute("position").count;
    // The prior wing pair was exactly 2 triangles (6 vertices); the tapered
    // quad-per-side planform is strictly more.
    expect(verts).toBeGreaterThan(6);
  });
});
