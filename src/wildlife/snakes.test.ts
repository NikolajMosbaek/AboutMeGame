import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  ALERT_RADIUS,
  APPROACH_MAX,
  APPROACH_MIN,
  DEESCALATE_DURATION,
  SNAKE_COUNT,
  STRIKE_COOLDOWN,
  STRIKE_DAMAGE,
  STRIKE_RADIUS,
  SnakesSystem,
  initialSnakeState,
  placeSnakes,
  stepSnake,
} from "./snakes.ts";
import { buildTerrain } from "../world/terrain.ts";
import { POI_ANCHORS, SPAWN, WORLD } from "../world/worldConfig.ts";

const FRAME = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), dt: 1 / 60, elapsed: 0 };

function player(x: number, z: number) {
  return { state: { position: new THREE.Vector3(x, 0, z) } };
}

describe("placeSnakes (deterministic placement)", () => {
  const terrain = buildTerrain();

  it(`places exactly one snake per site (${SNAKE_COUNT} total)`, () => {
    const placements = placeSnakes(terrain);
    expect(placements).toHaveLength(SNAKE_COUNT);
    expect(placements).toHaveLength(POI_ANCHORS.length);
  });

  it("never places a snake inside the camp clearing", () => {
    const placements = placeSnakes(terrain);
    for (const p of placements) {
      const d = Math.hypot(p.x - SPAWN.x, p.z - SPAWN.z);
      expect(d).toBeGreaterThanOrEqual(WORLD.campClearRadius - 1e-6);
    }
  });

  it("places every non-camp snake within the APPROACH_MIN..APPROACH_MAX band of its site", () => {
    const placements = placeSnakes(terrain);
    for (let i = 0; i < POI_ANCHORS.length; i++) {
      const anchor = POI_ANCHORS[i];
      if (anchor.archetype === "camp") continue;
      const p = placements[i];
      const d = Math.hypot(p.x - anchor.x, p.z - anchor.z);
      expect(d).toBeGreaterThanOrEqual(APPROACH_MIN - 1e-6);
      expect(d).toBeLessThanOrEqual(APPROACH_MAX + 1e-6);
    }
  });

  it("is deterministic: two builds produce identical placements", () => {
    const a = placeSnakes(terrain);
    const b = placeSnakes(terrain);
    expect(a).toEqual(b);
  });
});

describe("stepSnake (idle → alert → strike → de-escalate)", () => {
  it("stays idle while the player is far away", () => {
    let s = initialSnakeState();
    for (let i = 0; i < 60; i++) s = stepSnake(s, 1 / 60, ALERT_RADIUS + 10).state;
    expect(s.mode).toBe("idle");
  });

  it("raises to alert once the player is within ALERT_RADIUS", () => {
    const { state } = stepSnake(initialSnakeState(), 1 / 60, ALERT_RADIUS - 0.5);
    expect(state.mode).toBe("alert");
  });

  it("strikes and reports `struck` the instant the player is within STRIKE_RADIUS", () => {
    const s = stepSnake(initialSnakeState(), 0, ALERT_RADIUS - 0.5).state; // alert
    const { state, struck } = stepSnake(s, 1 / 60, STRIKE_RADIUS - 0.5);
    expect(state.mode).toBe("strike");
    expect(struck).toBe(true);
  });

  it("does not strike again before the cooldown elapses, even standing in range", () => {
    let s = stepSnake(initialSnakeState(), 0, ALERT_RADIUS - 0.5).state;
    let r = stepSnake(s, 0, STRIKE_RADIUS - 0.5);
    expect(r.struck).toBe(true);
    s = r.state;
    r = stepSnake(s, STRIKE_COOLDOWN - 0.1, STRIKE_RADIUS - 0.5);
    expect(r.struck).toBe(false);
    expect(r.state.mode).toBe("strike");
  });

  it("strikes again once the cooldown fully elapses, still in range", () => {
    let s = stepSnake(initialSnakeState(), 0, ALERT_RADIUS - 0.5).state;
    let r = stepSnake(s, 0, STRIKE_RADIUS - 0.5);
    s = r.state;
    r = stepSnake(s, STRIKE_COOLDOWN + 0.01, STRIKE_RADIUS - 0.5);
    expect(r.struck).toBe(true);
  });

  it("de-escalates when the player backs off past the alert radius, then settles to idle", () => {
    let s = stepSnake(initialSnakeState(), 0, ALERT_RADIUS - 0.5).state; // alert
    let r = stepSnake(s, 1 / 60, ALERT_RADIUS + 10); // backs off
    expect(r.state.mode).toBe("deescalate");
    s = r.state;
    r = stepSnake(s, DEESCALATE_DURATION + 0.1, ALERT_RADIUS + 10);
    expect(r.state.mode).toBe("idle");
  });

  it("re-escalates to strike from de-escalate if the player closes back in", () => {
    let s = stepSnake(initialSnakeState(), 0, ALERT_RADIUS - 0.5).state;
    s = stepSnake(s, 1 / 60, ALERT_RADIUS + 10).state; // deescalate
    expect(s.mode).toBe("deescalate");
    const r = stepSnake(s, 1 / 60, STRIKE_RADIUS - 0.5);
    expect(r.state.mode).toBe("strike");
  });

  it("is deterministic: identical inputs produce identical output", () => {
    const s = initialSnakeState();
    const a = stepSnake(s, 1 / 60, 1.0);
    const b = stepSnake(s, 1 / 60, 1.0);
    expect(a).toEqual(b);
  });
});

describe("SnakesSystem", () => {
  const terrain = buildTerrain();

  function rig(px: number, pz: number) {
    const scene = new THREE.Scene();
    const session = { paused: false };
    const hurt = vi.fn();
    const sys = new SnakesSystem(scene, terrain, player(px, pz), session, hurt);
    return { scene, session, hurt, sys };
  }

  it("builds exactly 2 draw calls (body + head InstancedMesh) for all 6 snakes", () => {
    const { scene } = rig(0, 0);
    const meshes: THREE.InstancedMesh[] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) meshes.push(o);
    });
    expect(meshes).toHaveLength(2);
    for (const m of meshes) expect(m.count).toBe(SNAKE_COUNT);
  });

  it("calls the injected hurt() on a strike, exactly once per cooldown window", () => {
    const placements = placeSnakes(terrain);
    const near = placements[0];
    const { session, hurt, sys } = rig(near.x, near.z); // standing right on a snake
    void session;
    for (let i = 0; i < 5; i++) sys.update(FRAME); // a handful of frames within one cooldown
    expect(hurt).toHaveBeenCalledTimes(1);
    expect(hurt).toHaveBeenCalledWith(STRIKE_DAMAGE);
  });

  it("holds all movement/damage while the session is paused", () => {
    const placements = placeSnakes(terrain);
    const near = placements[0];
    const { session, hurt, sys } = rig(near.x, near.z);
    session.paused = true;
    for (let i = 0; i < 200; i++) sys.update(FRAME);
    expect(hurt).not.toHaveBeenCalled();
  });

  it("never chases: a snake's body placement never moves across frames", () => {
    const placements = placeSnakes(terrain);
    const near = placements[0];
    const { scene, sys } = rig(near.x, near.z);
    const bodyBefore = matrixSnapshot(scene, "wildlife-snake-body");
    for (let i = 0; i < 120; i++) sys.update(FRAME);
    const bodyAfter = matrixSnapshot(scene, "wildlife-snake-body");
    expect(bodyAfter).toEqual(bodyBefore);
  });

  it("disposes every geometry/material without throwing, and detaches from the scene", () => {
    const { scene, sys } = rig(0, 0);
    expect(() => sys.dispose()).not.toThrow();
    expect(scene.children.find((o) => o.name === "wildlife-snake-body")).toBeUndefined();
    expect(scene.children.find((o) => o.name === "wildlife-snake-head")).toBeUndefined();
  });

  it("bands the coiled body with darker colour stripes (Objects slice 2), not one flat colour", () => {
    const { scene } = rig(0, 0);
    let bodyMesh: THREE.InstancedMesh | undefined;
    scene.traverse((o) => {
      if (o instanceof THREE.InstancedMesh && o.name === "wildlife-snake-body") bodyMesh = o;
    });
    const color = bodyMesh!.geometry.getAttribute("color");
    const first = new THREE.Color(color.getX(0), color.getY(0), color.getZ(0));
    let sawDifferent = false;
    for (let i = 1; i < color.count; i++) {
      const c = new THREE.Color(color.getX(i), color.getY(i), color.getZ(i));
      if (!c.equals(first)) sawDifferent = true;
    }
    expect(sawDifferent).toBe(true);
  });
});

function matrixSnapshot(scene: THREE.Scene, name: string): number[][] {
  let mesh: THREE.InstancedMesh | undefined;
  scene.traverse((o) => {
    if (o instanceof THREE.InstancedMesh && o.name === name) mesh = o;
  });
  if (!mesh) throw new Error(`no InstancedMesh named "${name}"`);
  const out: number[][] = [];
  const m = new THREE.Matrix4();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    out.push([...m.elements]);
  }
  return out;
}
