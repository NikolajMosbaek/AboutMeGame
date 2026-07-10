import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  FISH_COUNT,
  FLEE_DURATION,
  FLEE_RADIUS,
  FishSystem,
  MIN_POOL_DEPTH,
  initialFishState,
  selectPools,
  stepFish,
} from "./fish.ts";
import { buildTerrain } from "../world/terrain.ts";
import { LAGOON } from "../world/worldConfig.ts";

const FRAME = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), dt: 1 / 60, elapsed: 0 };

function player(x: number, z: number) {
  return { state: { position: new THREE.Vector3(x, 0, z) } };
}

describe("selectPools", () => {
  it("keeps only points deeper than MIN_POOL_DEPTH", () => {
    const depthAt = (x: number, z: number) => (x === LAGOON.x && z === LAGOON.z ? 5 : 0.1);
    const pools = selectPools(depthAt);
    expect(pools).toEqual([{ x: LAGOON.x, z: LAGOON.z }]);
  });

  it("against the real world, finds the lagoon and river pools", () => {
    const terrain = buildTerrain();
    const waterDepthAt = (x: number, z: number) => 0 - terrain.heightAt(x, z);
    const pools = selectPools(waterDepthAt);
    expect(pools.length).toBeGreaterThan(0);
    expect(pools.some((p) => p.x === LAGOON.x && p.z === LAGOON.z)).toBe(true);
    for (const p of pools) expect(waterDepthAt(p.x, p.z)).toBeGreaterThan(MIN_POOL_DEPTH);
  });
});

describe("stepFish (patrol/flee state machine)", () => {
  const pool = { x: 0, z: 0 };

  it("patrols when the player is far away", () => {
    let s = initialFishState(pool, 0);
    for (let i = 0; i < 60; i++) s = stepFish(s, 1 / 60, pool, { x: 1000, z: 1000 });
    expect(s.mode).toBe("patrol");
  });

  it("flees the instant the player comes within FLEE_RADIUS", () => {
    const s0 = initialFishState(pool, 0);
    const s1 = stepFish(s0, 1 / 60, pool, { x: s0.x, z: s0.z + FLEE_RADIUS - 0.5 });
    expect(s1.mode).toBe("flee");
  });

  it("moves AWAY from the player while fleeing (distance increases)", () => {
    const s0 = initialFishState(pool, 0);
    const playerPos = { x: s0.x, z: s0.z + 1 }; // very close
    const s1 = stepFish(s0, 1 / 60, pool, playerPos);
    const before = Math.hypot(s0.x - playerPos.x, s0.z - playerPos.z);
    const after = Math.hypot(s1.x - playerPos.x, s1.z - playerPos.z);
    expect(after).toBeGreaterThan(before);
  });

  it("returns to patrol only after FLEE_DURATION AND the player is clear again", () => {
    let s = initialFishState(pool, 0);
    const closePlayer = { x: s.x, z: s.z + 1 };
    s = stepFish(s, 0, pool, closePlayer); // enters flee
    // Not enough time has passed yet, even though the fish has darted off.
    let probe = stepFish(s, FLEE_DURATION - 0.1, pool, { x: 1000, z: 1000 });
    expect(probe.mode).toBe("flee");
    // Enough time AND clear: resumes patrol.
    probe = stepFish(s, FLEE_DURATION + 0.1, pool, { x: 1000, z: 1000 });
    expect(probe.mode).toBe("patrol");
  });

  it("is deterministic: identical inputs produce identical output", () => {
    const s = initialFishState(pool, 2);
    const a = stepFish(s, 1 / 60, pool, { x: 3, z: 4 });
    const b = stepFish(s, 1 / 60, pool, { x: 3, z: 4 });
    expect(a).toEqual(b);
  });
});

describe("FishSystem", () => {
  const terrain = buildTerrain();
  const waterDepthAt = (x: number, z: number) => 0 - terrain.heightAt(x, z);

  function rig(px = 0, pz = 0) {
    const scene = new THREE.Scene();
    const session = { paused: false };
    const sys = new FishSystem(scene, waterDepthAt, player(px, pz), session);
    return { scene, session, sys };
  }

  it("builds exactly 1 draw call for all fish", () => {
    const { scene } = rig();
    let meshes = 0;
    scene.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) meshes++;
    });
    expect(meshes).toBe(1);
    let count = 0;
    scene.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) count = o.count;
    });
    expect(count).toBe(FISH_COUNT);
  });

  it("reports fish fleeing near a fish's pool and none fleeing far away", () => {
    const far = rig(10000, 10000);
    far.sys.update(FRAME);
    expect((far.sys.describe() as { fleeing: number }).fleeing).toBe(0);

    const close = rig(LAGOON.x, LAGOON.z);
    close.sys.update(FRAME);
    expect((close.sys.describe() as { fleeing: number }).fleeing).toBeGreaterThan(0);
  });

  it("holds all movement while the session is paused", () => {
    const { session, sys } = rig(LAGOON.x, LAGOON.z);
    session.paused = true;
    const before = sys.describe();
    for (let i = 0; i < 200; i++) sys.update(FRAME);
    expect(sys.describe()).toEqual(before);
  });

  it("disposes without throwing, and detaches from the scene", () => {
    const { scene, sys } = rig();
    expect(() => sys.dispose()).not.toThrow();
    expect(scene.children.find((o) => o.name === "wildlife-fish")).toBeUndefined();
  });
});
