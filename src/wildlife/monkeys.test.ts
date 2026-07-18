import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  CHASE_DROP_RADIUS,
  CURIOUS_RADIUS,
  CURIOUS_STILL_SECONDS,
  DROP_TTL,
  FIRST_HEIST_HEAD_START,
  FLEE_RADIUS,
  HEIST_MAX_RANGE,
  HEIST_MIN_GAP,
  HEIST_SEEK_RADIUS,
  HEIST_TIMEOUT,
  MonkeysSystem,
  PICKUP_RADIUS,
  TAUNT_SECONDS,
  TROOP_ANCHORS,
  TROOP_BANKS,
  TROOP_SIZE,
  WADE_DEPTH,
  dryPath,
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
    waterDepthAt: () => -1, // bone dry unless a test says otherwise
    ...overrides,
  };
}

/** A north–south river wall: deep water everywhere east of x = 10. */
const WALL = (x: number) => (x > 10 ? 3 : -1);

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

  it("every intra-bank patrol leg stays dry on the REAL terrain — the river splits the banks", () => {
    // This is the invariant behind the user-visible bug: the old single-ring
    // route crossed the carved river bed on 4 of 5 legs, so the troop swam
    // the river every patrol cycle. Banks must never route over deep water.
    const terrain = buildTerrain();
    const depth = (x: number, z: number) => WORLD.seaLevel - terrain.heightAt(x, z);
    expect(TROOP_BANKS.flat()).toEqual(TROOP_ANCHORS);
    for (const bank of TROOP_BANKS) {
      expect(bank.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < bank.length; i++) {
        const a = bank[i];
        const b = bank[(i + 1) % bank.length];
        for (let t = 0; t <= 1.0001; t += 0.02) {
          const d = depth(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
          expect(d).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it("the troop splits across both banks, each monkey starting on dry ground", () => {
    const terrain = buildTerrain();
    const banks = new Set<number>();
    for (let i = 0; i < TROOP_SIZE; i++) {
      const s = initialMonkeyState(i);
      banks.add(s.bank);
      expect(WORLD.seaLevel - terrain.heightAt(s.x, s.z)).toBeLessThanOrEqual(0);
      expect(s.anchor).toBeLessThan(TROOP_BANKS[s.bank].length);
    }
    expect(banks.size).toBe(TROOP_BANKS.length); // both banks staffed
  });
});

describe("water discipline (the monkeys-in-the-river fix)", () => {
  it("dryPath samples the straight line against deep water", () => {
    expect(dryPath(-30, 0, 5, 0, WALL)).toBe(true);
    expect(dryPath(-30, 0, 30, 0, WALL)).toBe(false);
    expect(dryPath(20, 5, 30, -5, WALL)).toBe(false); // both ends past the wall
  });

  it("a fleeing monkey never crosses deep water — it skirts the bank instead", () => {
    let s: MonkeyState = { ...calmState(0), x: 8, z: 0, mode: "flee", timer: 0 };
    // Player due west pushes the flee east, straight at the wall.
    const e = env({ player: { x: 0, z: 0 }, waterDepthAt: WALL });
    for (let t = 0; t < COMIC_TIMING.reactSeconds; t += 0.05) {
      s = stepMonkey(s, 0.05, e, COMIC_TIMING).state;
      expect(WALL(s.x)).toBeLessThanOrEqual(WADE_DEPTH);
    }
  });

  it("troop travel refuses steps into deep water even when the route points at it", () => {
    // Monkey 0's anchor is east of the wall; it must pace the bank, not swim.
    let s: MonkeyState = { ...calmState(0), x: 0, z: TROOP_ANCHORS[0].z, dwell: 0 };
    const e = env({ waterDepthAt: WALL });
    for (let i = 0; i < 400; i++) {
      s = stepMonkey(s, 0.05, e, COMIC_TIMING).state;
      expect(WALL(s.x)).toBeLessThanOrEqual(WADE_DEPTH);
    }
  });

  it("a curious approach stops at the water's edge — it stares from across the river", () => {
    let s: MonkeyState = { ...calmState(0), x: 4, z: 0, mode: "curious", timer: 0 };
    const e = env({ player: { x: 16, z: 0 }, playerStillSeconds: 10, waterDepthAt: WALL });
    for (let t = 0; t < 10; t += 0.1) {
      s = stepMonkey(s, 0.1, e, COMIC_TIMING).state;
      expect(WALL(s.x)).toBeLessThanOrEqual(WADE_DEPTH);
    }
  });
});

describe("heist reachability and timeout", () => {
  it("electThief skips ineligible monkeys and returns -1 when nobody can reach", () => {
    const states = [
      { x: 30, z: 0 },
      { x: 21, z: 1 },
    ];
    const plant = { x: 20, z: 0 };
    expect(electThief(states, plant, [true, false])).toBe(0);
    expect(electThief(states, plant, [false, false])).toBe(-1);
    expect(electThief(states, plant)).toBe(1); // no mask: nearest, as before
  });

  it("a heist blocked by water gives up after HEIST_TIMEOUT instead of stalling the gag forever", () => {
    let s: MonkeyState = {
      ...calmState(0),
      x: 0,
      z: 0,
      mode: "heist",
      heistTarget: { x: 40, z: 0, kind: "banana", plantIndex: 0 },
    };
    const e = env({ waterDepthAt: WALL });
    let t = 0;
    while (s.mode === "heist" && t < HEIST_TIMEOUT + 5) {
      s = stepMonkey(s, 0.25, e, COMIC_TIMING).state;
      t += 0.25;
    }
    expect(s.mode).not.toBe("heist");
    expect(t).toBeLessThanOrEqual(HEIST_TIMEOUT + 1);
  });

  it("never steals off a steered sidestep — arrival only counts on the direct line", () => {
    // The plant sits just past the water line: the thief closes to within
    // reach but every direct step is wet. Sidesteps must not count as
    // arrival, so the steal never fires and the give-up clock resolves it.
    let s: MonkeyState = { ...calmState(0), x: 9.5, z: 0, mode: "heist", timer: 0,
      heistTarget: { x: 10.6, z: 0, kind: "banana", plantIndex: 0 } };
    const e = env({ waterDepthAt: WALL });
    let stole = false;
    for (let t = 0; t < HEIST_TIMEOUT + 2 && s.mode === "heist"; t += 0.1) {
      const r = stepMonkey(s, 0.1, e, COMIC_TIMING);
      s = r.state;
      if (r.stolePlant !== null) stole = true;
    }
    expect(stole).toBe(false);
    expect(s.mode).toBe("flee"); // gave up honestly instead
  });

  it("a carrier blocked on the way to its perch drops the fruit where it stands and bails", () => {
    let s: MonkeyState = {
      ...calmState(0),
      x: 0,
      z: 0,
      mode: "heist",
      carrying: "mango",
      timer: 0,
      heistTarget: { x: 40, z: 0, kind: "mango", plantIndex: -1 },
    };
    const e = env({ waterDepthAt: WALL });
    let dropped: { x: number; z: number } | null = null;
    for (let t = 0; t < HEIST_TIMEOUT + 5 && !dropped; t += 0.25) {
      const r = stepMonkey(s, 0.25, e, COMIC_TIMING);
      s = r.state;
      if (r.dropped) dropped = r.dropped;
    }
    expect(dropped).not.toBeNull();
    expect(WALL(dropped!.x)).toBeLessThanOrEqual(WADE_DEPTH); // dropped on land
    expect(s.mode).toBe("flee");
    expect(s.carrying).toBeNull();
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

  it("the perch heads toward a REAL home anchor of the thief's bank — never out to sea, never at the plant", () => {
    // Steal near anchor 0; the perch must head toward an anchor of the
    // thief's own bank (validated dry land), and toward one far enough away
    // that the perch isn't the plant itself (or the chase radius eats the
    // gag the same frame).
    const s: MonkeyState = { ...calmState(0), mode: "heist", heistTarget: target };
    const e = env({ player: { x: 38, z: 30 } });
    let r = stepMonkey(s, 0.1, e, COMIC_TIMING);
    for (let t = 0; t < 30 && r.stolePlant === null; t += 0.1) {
      r = stepMonkey(r.state, 0.1, e, COMIC_TIMING);
    }
    const perch = r.state.heistTarget!;
    expect(Math.hypot(perch.x - target.x, perch.z - target.z)).toBeGreaterThan(5);
    expect(Math.hypot(perch.x, perch.z)).toBeLessThan(WORLD.boundaryRadius);
    // Same half-plane as at least one of the thief's own bank anchors.
    const towardOwnBank = TROOP_BANKS[r.state.bank].some(
      (a) =>
        (perch.x - target.x) * (a.x - target.x) + (perch.z - target.z) * (a.z - target.z) > 0,
    );
    expect(towardOwnBank).toBe(true);
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
    const waterDepthAt = (x: number, z: number) => WORLD.seaLevel - terrain.heightAt(x, z);
    const sys = new MonkeysSystem(scene, terrain, waterDepthAt, { state: playerState }, { paused: false }, {
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

  it("paces the first gag off a head start: no heist before the shortened first gap, armed soon after", () => {
    const plant: FruitPlant = {
      kind: "banana",
      x: TROOP_ANCHORS[0].x,
      z: TROOP_ANCHORS[0].z,
      ripe: true,
      regrowIn: 0,
    };
    const firstGap = HEIST_MIN_GAP - FIRST_HEIST_HEAD_START;
    expect(firstGap).toBeGreaterThan(10); // still a real wait, never instant
    const { sys } = rig({ plants: [plant], px: plant.x + 3, pz: plant.z });
    run(sys, firstGap - 2);
    expect(sys.describe().heisting).toBe(false);
    expect(plant.ripe).toBe(true);
    run(sys, 6); // …but the first gag lands minutes sooner than the steady gap
    expect(sys.describe().heisting).toBe(true);
    sys.dispose();
  });

  it("an idle monkey sits still at its anchor — no perpetual bouncing", () => {
    const { scene, sys } = rig();
    run(sys, 2); // far player: the whole troop is dwelling
    let body: THREE.InstancedMesh | undefined;
    scene.traverse((o) => {
      if (o instanceof THREE.InstancedMesh && o.name === "wildlife-monkey-body") body = o;
    });
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const snap = sys.describe().positions as Array<{ x: number; z: number }>;
    for (let i = 0; i < TROOP_SIZE; i++) {
      body!.getMatrixAt(i, m);
      m.decompose(p, q, sc);
      expect(p.y).toBeCloseTo(terrain.heightAt(snap[i].x, snap[i].z), 3);
    }
    sys.dispose();
  });

  it("a traveling monkey bounces — the hop belongs to movement, not to idling", () => {
    const { scene, sys } = rig();
    run(sys, 30); // past the first anchor dwell: someone is mid-leg
    let body: THREE.InstancedMesh | undefined;
    scene.traverse((o) => {
      if (o instanceof THREE.InstancedMesh && o.name === "wildlife-monkey-body") body = o;
    });
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    let maxHop = 0;
    for (let t = 0; t < 1; t += 0.05) {
      sys.update({ ...STEP, dt: 0.05 });
      const snap = sys.describe().positions as Array<{ x: number; z: number }>;
      for (let i = 0; i < TROOP_SIZE; i++) {
        body!.getMatrixAt(i, m);
        m.decompose(p, q, sc);
        maxHop = Math.max(maxHop, p.y - terrain.heightAt(snap[i].x, snap[i].z));
      }
    }
    expect(maxHop).toBeGreaterThan(0.05);
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

  it("aborts the heist when the player picks the plant first — no phantom fruit, no double meal", () => {
    const plant: FruitPlant = {
      kind: "banana",
      x: TROOP_ANCHORS[0].x,
      z: TROOP_ANCHORS[0].z,
      ripe: true,
      regrowIn: 0,
    };
    const { sys, eaten } = rig({ plants: [plant], px: plant.x + 3, pz: plant.z });
    // Run until a thief is in flight (heist assigned, fruit not yet stolen).
    for (let t = 0; t < HEIST_MIN_GAP + 60 && !sys.describe().heisting; t += 0.25) {
      sys.update(STEP);
    }
    expect(sys.describe().heisting).toBe(true);
    expect(plant.ripe).toBe(true);

    // The player beats the monkey to it (ForageSystem's pick).
    plant.ripe = false;
    plant.regrowIn = 42; // partially elapsed regrow — must NOT be stomped

    for (let t = 0; t < 30; t += 0.25) sys.update(STEP);
    expect(sys.describe().heisting).toBe(false);
    expect(sys.describe().carrying).toBe(0); // slunk off empty-handed
    expect(plant.regrowIn).toBe(42); // regrow clock untouched
    expect(eaten).toHaveLength(0); // and no phantom second meal ever arrives
    sys.dispose();
  });

  it("never elects a thief beyond the timeout's travel budget — a far plant stays unrobbed, and the troop drifts closer", () => {
    // (-34, -140) is dry land in the far south-west highland foot, > 120 u
    // from every monkey — inside a heist's reach only by a sprint that would
    // blow the give-up clock. The old code elected the runner anyway and
    // shipped a sprint-give-up-retry loop that also suppressed the drift.
    const plant: FruitPlant = { kind: "berries", x: -34, z: -140, ripe: true, regrowIn: 0 };
    expect(WORLD.seaLevel - terrain.heightAt(plant.x, plant.z)).toBeLessThanOrEqual(0);
    const { sys } = rig({ plants: [plant], px: plant.x + 3, pz: plant.z });
    for (const m of sys.describe().positions as Array<{ x: number; z: number }>) {
      expect(Math.hypot(m.x - plant.x, m.z - plant.z)).toBeGreaterThan(HEIST_MAX_RANGE);
    }
    // Well past HEIST_MAX_WAIT: the gag must never arm on the out-of-budget
    // plant — no sprint-give-up-retry loop, no phantom robbery. (The drift
    // fallback retargets patrols, but this plant is beyond every anchor.)
    for (let t = 0; t < 300; t += 0.25) {
      sys.update(STEP);
      expect(sys.describe().heisting).toBe(false);
    }
    expect(plant.ripe).toBe(true);
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
      () => -1,
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
