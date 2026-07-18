import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  CHASE_DROP_RADIUS,
  CURIOUS_RADIUS,
  CURIOUS_STILL_SECONDS,
  DROP_TTL,
  FLEE_RADIUS,
  HEIST_MIN_GAP,
  HEIST_SEEK_RADIUS,
  MonkeysSystem,
  PICKUP_RADIUS,
  TAUNT_SECONDS,
  TROOP_ANCHORS,
  TROOP_SIZE,
  electThief,
  hopPose,
  initialMonkeyState,
  stepMonkey,
  type MonkeyState,
  type TroopEnv,
} from "./monkeys.ts";
import { COMIC_TIMING, PLAIN_TIMING } from "./reactions.ts";
import { buildTerrain } from "../world/terrain.ts";
import { POI_ANCHORS, SPAWN, WORLD } from "../world/worldConfig.ts";
import type { FruitPlant } from "../forage/ForageSystem.ts";

const FRAME = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), dt: 1 / 60, elapsed: 0 };
const STEP = { ...FRAME, dt: 0.25 };

function env(overrides: Partial<TroopEnv> = {}): TroopEnv {
  return {
    player: { x: 1000, z: 1000 },
    playerSpeed: 0,
    playerStillSeconds: 0,
    ...overrides,
  };
}

const calmState = (i = 0): MonkeyState => initialMonkeyState(i);

describe("TROOP_ANCHORS", () => {
  it("every anchor is inside the world and clear of every site and the camp", () => {
    for (const a of TROOP_ANCHORS) {
      expect(Math.hypot(a.x, a.z)).toBeLessThan(WORLD.boundaryRadius - 4);
      for (const poi of POI_ANCHORS) {
        expect(Math.hypot(a.x - poi.x, a.z - poi.z)).toBeGreaterThanOrEqual(10);
      }
      expect(Math.hypot(a.x - SPAWN.x, a.z - SPAWN.z)).toBeGreaterThanOrEqual(
        WORLD.campClearRadius + 4,
      );
    }
  });
});

describe("stepMonkey — troop / curious / flee", () => {
  it("troops deterministically (two runs identical), never leaving troop mode unprovoked", () => {
    let a = calmState(1);
    let b = calmState(1);
    for (let i = 0; i < 200; i++) {
      a = stepMonkey(a, 1 / 60, env(), COMIC_TIMING).state;
      b = stepMonkey(b, 1 / 60, env(), COMIC_TIMING).state;
    }
    expect(a).toEqual(b);
    expect(a.mode).toBe("troop");
  });

  it("gets curious when the player stands still nearby — and NOT when moving", () => {
    const near = { x: calmState(0).x + CURIOUS_RADIUS - 2, z: calmState(0).z };
    const still = env({ player: near, playerStillSeconds: CURIOUS_STILL_SECONDS + 1 });
    const moving = env({ player: near, playerSpeed: 3, playerStillSeconds: 0 });

    expect(stepMonkey(calmState(0), 0.1, still, COMIC_TIMING).state.mode).toBe("curious");
    expect(stepMonkey(calmState(0), 0.1, moving, COMIC_TIMING).state.mode).toBe("troop");
  });

  it("curious approaches but keeps a respectful distance, and retreats when the player moves", () => {
    const s0 = calmState(0);
    const playerPos = { x: s0.x + 10, z: s0.z };
    let s = stepMonkey(s0, 0.1, env({ player: playerPos, playerStillSeconds: 5 }), COMIC_TIMING)
      .state;
    const dBefore = Math.hypot(s.x - playerPos.x, s.z - playerPos.z);
    for (let i = 0; i < 40; i++) {
      s = stepMonkey(s, 0.1, env({ player: playerPos, playerStillSeconds: 5 + i }), COMIC_TIMING)
        .state;
    }
    const dAfter = Math.hypot(s.x - playerPos.x, s.z - playerPos.z);
    expect(dAfter).toBeLessThan(dBefore); // it came closer…
    expect(dAfter).toBeGreaterThan(4); // …but never right up to you

    s = stepMonkey(s, 0.1, env({ player: playerPos, playerSpeed: 4 }), COMIC_TIMING).state;
    expect(s.mode).toBe("troop"); // you moved — moment over
  });

  it("a too-close player triggers the grammar's freeze-beat, then a fleeing bound", () => {
    const s0 = calmState(0);
    const rightHere = { x: s0.x + FLEE_RADIUS - 1, z: s0.z };
    let s = stepMonkey(s0, 0.05, env({ player: rightHere, playerSpeed: 4 }), COMIC_TIMING).state;
    expect(s.mode).toBe("freeze");
    for (let t = 0; t <= COMIC_TIMING.freezeSeconds; t += 0.05) {
      s = stepMonkey(s, 0.05, env({ player: rightHere }), COMIC_TIMING).state;
    }
    expect(s.mode).toBe("flee");
    // Reduced motion: no beat.
    const plain = stepMonkey(
      calmState(0),
      0.05,
      env({ player: rightHere, playerSpeed: 4 }),
      PLAIN_TIMING,
    ).state;
    expect(plain.mode).toBe("flee");
  });

  it("fleeing increases distance from the player, then settles back to troop", () => {
    const s0: MonkeyState = { ...calmState(0), mode: "flee", timer: 0 };
    const playerPos = { x: s0.x + 1, z: s0.z };
    let s = s0;
    const d0 = 1;
    for (let t = 0; t < COMIC_TIMING.reactSeconds + 0.2; t += 0.1) {
      s = stepMonkey(s, 0.1, env({ player: playerPos }), COMIC_TIMING).state;
    }
    expect(Math.hypot(s.x - playerPos.x, s.z - playerPos.z)).toBeGreaterThan(d0);
    expect(s.mode).toBe("troop");
  });
});

describe("the fruit heist (pure)", () => {
  const target = { x: 30, z: 30, kind: "banana" as const, plantIndex: 0 };

  it("electThief picks the monkey nearest the plant", () => {
    const states = [0, 1, 2, 3].map((i) => ({ ...calmState(i), x: 100 + i * 50, z: 0 }));
    states[2].x = 31;
    states[2].z = 30;
    expect(electThief(states, { x: 30, z: 30 })).toBe(2);
  });

  it("the thief runs to the plant, steals, carries to a perch, taunts, then drops and scarpers", () => {
    let s: MonkeyState = { ...calmState(0), mode: "heist", heistTarget: target };
    const e = env({ player: { x: 38, z: 30 } });

    let stole = false;
    for (let t = 0; t < 30 && !stole; t += 0.1) {
      const r = stepMonkey(s, 0.1, e, COMIC_TIMING);
      s = r.state;
      if (r.stolePlant !== null) stole = true;
    }
    expect(stole).toBe(true);
    expect(s.carrying).toBe("banana");

    let dropped: { x: number; z: number; kind: string } | null = null;
    for (let t = 0; t < TAUNT_SECONDS + 30 && !dropped; t += 0.1) {
      const r = stepMonkey(s, 0.1, e, COMIC_TIMING);
      s = r.state;
      if (r.dropped) dropped = r.dropped;
    }
    expect(dropped?.kind).toBe("banana");
    expect(s.carrying).toBeNull();
    expect(s.mode).toBe("flee"); // scarpers after the gag
  });

  it("chasing the perched thief forces the drop early", () => {
    const s: MonkeyState = {
      ...calmState(0),
      mode: "heist",
      carrying: "mango",
      heistTarget: null, // already perched
      timer: 1, // mid-taunt, long before TAUNT_SECONDS
    };
    const r = stepMonkey(
      s,
      0.1,
      env({ player: { x: s.x + CHASE_DROP_RADIUS - 1, z: s.z } }),
      COMIC_TIMING,
    );
    expect(r.dropped).not.toBeNull();
    expect(r.state.carrying).toBeNull();
  });
});

describe("MonkeysSystem", () => {
  const terrain = buildTerrain();

  function rig(opts: { plants?: FruitPlant[]; px?: number; pz?: number; speed?: number } = {}) {
    const scene = new THREE.Scene();
    const plants = opts.plants ?? [];
    const eaten: string[] = [];
    const ripeFlips: Array<[number, boolean]> = [];
    const position = new THREE.Vector3(opts.px ?? 1000, 0, opts.pz ?? 1000);
    const playerState = { position, speed: opts.speed ?? 0 };
    const sys = new MonkeysSystem(scene, terrain, { state: playerState }, { paused: false }, {
      plants,
      setRipe: (i, ripe) => ripeFlips.push([i, ripe]),
      creditEat: (kind) => eaten.push(kind),
    });
    return { scene, sys, plants, eaten, ripeFlips, position, playerState };
  }

  /** Step the system `seconds` of play in 0.25 s slices. */
  const run = (sys: MonkeysSystem, seconds: number) => {
    for (let t = 0; t < seconds; t += 0.25) sys.update(STEP);
  };

  it("draws the whole troop + fruit in at most 2 InstancedMesh draw calls", () => {
    const { scene, sys } = rig();
    let count = 0;
    scene.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) count++;
    });
    expect(count).toBeLessThanOrEqual(2);
    sys.dispose();
  });

  it(`instances exactly ${TROOP_SIZE} monkeys`, () => {
    const { scene, sys } = rig();
    let body: THREE.InstancedMesh | undefined;
    scene.traverse((o) => {
      if (o instanceof THREE.InstancedMesh && o.name === "wildlife-monkey-body") body = o;
    });
    expect(body?.count).toBe(TROOP_SIZE);
    expect(HEIST_SEEK_RADIUS).toBeGreaterThan(0);
    sys.dispose();
  });

  it("never triggers a heist before the pacing gap has elapsed", () => {
    const plant: FruitPlant = {
      kind: "banana",
      x: TROOP_ANCHORS[0].x,
      z: TROOP_ANCHORS[0].z,
      ripe: true,
      regrowIn: 0,
    };
    const { sys } = rig({ plants: [plant], px: plant.x + 3, pz: plant.z });
    run(sys, HEIST_MIN_GAP - 2);
    expect(sys.describe().heisting).toBe(false);
    expect(plant.ripe).toBe(true);
    sys.dispose();
  });

  it("after the gap, a player near a ripe plant gets robbed; chasing forces the drop; walking over it eats it", () => {
    const plant: FruitPlant = {
      kind: "banana",
      x: TROOP_ANCHORS[0].x,
      z: TROOP_ANCHORS[0].z,
      ripe: true,
      regrowIn: 0,
    };
    const { sys, ripeFlips, eaten, position } = rig({ plants: [plant], px: plant.x + 3, pz: plant.z });

    // The robbery.
    for (let t = 0; t < HEIST_MIN_GAP + 90 && plant.ripe; t += 0.25) sys.update(STEP);
    expect(plant.ripe).toBe(false);
    expect(plant.regrowIn).toBeGreaterThan(0);
    expect(ripeFlips).toContainEqual([0, false]);

    // The chase: dog the thief's heels until it gives the fruit up. Dropping
    // right at the chasing player's feet means the walk-over scoop lands the
    // SAME frame (PICKUP_RADIUS ≥ the drop offset) — the payoff is instant.
    for (let t = 0; t < 60 && eaten.length === 0; t += 0.25) {
      const snap = sys.describe();
      const thiefIdx = snap.thief as number;
      if (thiefIdx >= 0) {
        const thief = (snap.positions as Array<{ x: number; z: number }>)[thiefIdx];
        position.set(thief.x, 0, thief.z);
      }
      sys.update(STEP);
    }
    expect(eaten).toEqual(["banana"]); // chased down, dropped, scooped
    expect((sys.describe().drops as unknown[]).length).toBe(0);
    expect(PICKUP_RADIUS).toBeGreaterThan(0);
    sys.dispose();
  });

  it("an unclaimed drop despawns after its TTL, never credited", () => {
    const plant: FruitPlant = {
      kind: "mango",
      x: TROOP_ANCHORS[0].x,
      z: TROOP_ANCHORS[0].z,
      ripe: true,
      regrowIn: 0,
    };
    const { sys, eaten, position } = rig({ plants: [plant], px: plant.x + 3, pz: plant.z });
    for (let t = 0; t < HEIST_MIN_GAP + 90 && plant.ripe; t += 0.25) sys.update(STEP);
    expect(plant.ripe).toBe(false);
    // Retreat far away; let the taunt time out and the drop expire unclaimed.
    position.set(1000, 0, 1000);
    run(sys, TAUNT_SECONDS + DROP_TTL + 10);
    expect((sys.describe().drops as unknown[]).length).toBe(0);
    // Walk to where the perch was: nothing to scoop.
    expect(eaten).toHaveLength(0);
    sys.dispose();
  });

  it("never heists while the player is inside the camp clearing", () => {
    const plant: FruitPlant = { kind: "berries", x: SPAWN.x + 2, z: SPAWN.z, ripe: true, regrowIn: 0 };
    const { sys } = rig({ plants: [plant], px: SPAWN.x, pz: SPAWN.z });
    run(sys, HEIST_MIN_GAP + 120);
    expect(plant.ripe).toBe(true); // camp is sanctuary
    sys.dispose();
  });

  it("reset() (respawn) returns the troop to normal life and vanishes carried fruit", () => {
    const plant: FruitPlant = {
      kind: "banana",
      x: TROOP_ANCHORS[0].x,
      z: TROOP_ANCHORS[0].z,
      ripe: true,
      regrowIn: 0,
    };
    const { sys } = rig({ plants: [plant], px: plant.x + 3, pz: plant.z });
    for (let t = 0; t < HEIST_MIN_GAP + 90 && plant.ripe; t += 0.25) sys.update(STEP);
    expect(sys.describe().heisting).toBe(true);
    sys.reset();
    expect(sys.describe().heisting).toBe(false);
    expect(sys.describe().carrying).toBe(0);
    sys.dispose();
  });

  it("holds all movement while paused", () => {
    const scene = new THREE.Scene();
    const session = { paused: true };
    const sys = new MonkeysSystem(
      scene,
      terrain,
      { state: { position: new THREE.Vector3(0, 0, 0), speed: 0 } },
      session,
      { plants: [], setRipe: () => {}, creditEat: () => {} },
    );
    const before = JSON.stringify(sys.describe().positions);
    run(sys, 5);
    expect(JSON.stringify(sys.describe().positions)).toBe(before);
    sys.dispose();
  });

  it("disposes without throwing and detaches from the scene", () => {
    const { scene, sys } = rig();
    sys.dispose();
    let remaining = 0;
    scene.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) remaining++;
    });
    expect(remaining).toBe(0);
  });
});

describe("hopPose", () => {
  it("is bounded, deterministic and bouncy (leaves the ground)", () => {
    const a = hopPose(1.5, 2);
    const b = hopPose(1.5, 2);
    expect(a).toEqual(b);
    let maxHop = 0;
    for (let t = 0; t < 3; t += 0.05) maxHop = Math.max(maxHop, hopPose(t, 1));
    expect(maxHop).toBeGreaterThan(0.1);
    expect(maxHop).toBeLessThan(1.5);
  });
});
