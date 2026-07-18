import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  BREAK_OFF_DIST,
  CAMP_EXCLUSION,
  CHARGE_RANGE,
  EYE_DAY_EMISSIVE,
  EYE_NIGHT_EMISSIVE,
  JaguarSystem,
  NIGHT_BOLDNESS,
  STALK_MIN_SECONDS,
  STALK_RANGE,
  STRIKE_COOLDOWN,
  STRIKE_DAMAGE,
  SHADOW_MAX,
  SHADOW_MIN,
  TERRITORY,
  WADE_DEPTH,
  initialJaguarState,
  isNightPhase,
  stepJaguar,
  STARTLE_BOLT_SECONDS,
  STARTLE_FREEZE,
  STARTLED_COOLDOWN,
  type JaguarEnv,
  type JaguarState,
} from "./jaguar.ts";
import { WORLD } from "../world/worldConfig.ts";
import { buildTerrain } from "../world/terrain.ts";

const FRAME = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), dt: 1 / 60, elapsed: 0 };
const DT = 1 / 60;

const DRY = () => -1;
const CAMP = { x: 0, z: 200 }; // far from the territory, like the real camp

function env(over: Partial<JaguarEnv> = {}): JaguarEnv {
  return { player: { x: 1000, z: 1000 }, isNight: false, waterDepthAt: DRY, camp: CAMP, ...over };
}

function at(over: Partial<JaguarState> = {}): JaguarState {
  return { ...initialJaguarState(), ...over };
}

/** Run `seconds` of simulation at 60 fps; returns final state + strike count. */
function run(state: JaguarState, seconds: number, e: JaguarEnv) {
  let s = state;
  let strikes = 0;
  for (let i = 0; i < Math.ceil(seconds / DT); i++) {
    const r = stepJaguar(s, DT, e);
    s = r.state;
    if (r.struck) strikes++;
  }
  return { s, strikes };
}

describe("jaguar territory", () => {
  it("keeps every waypoint far from the camp clearing and the lagoon", () => {
    for (const wp of TERRITORY) {
      expect(Math.hypot(wp.x - -28, wp.z - 126)).toBeGreaterThan(100); // base camp
      expect(Math.hypot(wp.x - 0, wp.z - 142)).toBeGreaterThan(100); // lagoon
    }
  });
});

describe("stepJaguar — the hunt state machine", () => {
  it("prowls its territory waypoint to waypoint while no one is near", () => {
    const start = at();
    const { s } = run(start, 30, env());
    expect(s.mode).toBe("prowl");
    // It actually walked (toward waypoint 1).
    expect(Math.hypot(s.x - start.x, s.z - start.z)).toBeGreaterThan(10);
  });

  it("starts stalking when the player closes inside the stalk range", () => {
    const s0 = at();
    const inside = env({ player: { x: s0.x + STALK_RANGE - 1, z: s0.z } });
    expect(stepJaguar(s0, DT, inside).state.mode).toBe("stalk");

    const outside = env({ player: { x: s0.x + STALK_RANGE + 5, z: s0.z } });
    expect(stepJaguar(s0, DT, outside).state.mode).toBe("prowl");
  });

  it("is bolder at night: the stalk range grows by ×1.3", () => {
    const s0 = at();
    const between = env({ player: { x: s0.x + STALK_RANGE + 5, z: s0.z } }); // day-safe distance
    expect(stepJaguar(s0, DT, between).state.mode).toBe("prowl");
    expect(stepJaguar(s0, DT, { ...between, isNight: true }).state.mode).toBe("stalk");
    // Sanity: the night range really covers that distance.
    expect(STALK_RANGE * NIGHT_BOLDNESS).toBeGreaterThan(STALK_RANGE + 5);
  });

  it("shadows the player in the 15–25 u band while stalking", () => {
    const player = { x: 100, z: -100 };
    // Too far: closes in.
    const far = at({ mode: "stalk", x: player.x - SHADOW_MAX - 10, z: player.z });
    const closed = run(far, 2, env({ player })).s;
    expect(Math.hypot(closed.x - player.x, closed.z - player.z)).toBeLessThan(
      SHADOW_MAX + 10,
    );
    // Too close: backs off (never charges before the stalk minimum).
    const near = at({ mode: "stalk", x: player.x - SHADOW_MIN + 5, z: player.z });
    const backed = run(near, 2, env({ player })).s;
    expect(Math.hypot(backed.x - player.x, backed.z - player.z)).toBeGreaterThan(
      SHADOW_MIN - 5,
    );
  });

  it("charges only after ≥4 s of stalking AND the player within ~12 u", () => {
    const player = { x: 100, z: -100 };
    const s0 = at({ mode: "stalk", x: player.x - CHARGE_RANGE + 2, z: player.z, stalkSeconds: 0 });
    // Early: still stalking even at charge range.
    const early = stepJaguar(s0, DT, env({ player })).state;
    expect(early.mode).toBe("stalk");
    // Past the minimum: charge.
    const ripe = { ...s0, stalkSeconds: STALK_MIN_SECONDS };
    expect(stepJaguar(ripe, DT, env({ player })).state.mode).toBe("charge");
    // Past the minimum but out of charge range: keeps stalking.
    const farRipe = at({
      mode: "stalk",
      x: player.x - CHARGE_RANGE - 8,
      z: player.z,
      stalkSeconds: STALK_MIN_SECONDS,
    });
    expect(stepJaguar(farRipe, DT, env({ player })).state.mode).toBe("stalk");
  });

  it("strikes on contact (once), then retreats with the ~90 s cooldown", () => {
    const player = { x: 100, z: -100 };
    const charge = at({ mode: "charge", x: player.x - 10, z: player.z });
    const { s, strikes } = run(charge, 3, env({ player }));
    expect(strikes).toBe(1); // hit-and-run: exactly one hit
    expect(s.mode).toBe("retreat");
    expect(s.cooldown).toBeGreaterThan(STRIKE_COOLDOWN - 4);
  });

  it("retreats home and will not hunt again until the cooldown expires", () => {
    const player = { x: TERRITORY[0].x + 10, z: TERRITORY[0].z };
    const wounded = at({ mode: "retreat", x: player.x - 2, z: player.z, cooldown: STRIKE_COOLDOWN });
    // 30 s later: home in the territory, prowling, but deaf to the player.
    const mid = run(wounded, 30, env({ player })).s;
    expect(mid.mode).toBe("prowl");
    expect(mid.cooldown).toBeGreaterThan(0);
    // A player right next to it still doesn't re-trigger the stalk…
    const nearby = env({ player: { x: mid.x + 10, z: mid.z } });
    expect(stepJaguar(mid, DT, nearby).state.mode).toBe("prowl");
    // …until the cooldown has fully expired.
    expect(stepJaguar({ ...mid, cooldown: 0 }, DT, nearby).state.mode).toBe("stalk");
  });

  it("breaks off when the player opens more than 60 u", () => {
    const s0 = at({ mode: "stalk", x: 0, z: -100, stalkSeconds: 2 });
    const gone = env({ player: { x: BREAK_OFF_DIST + 5, z: -100 } });
    expect(stepJaguar(s0, DT, gone).state.mode).toBe("prowl");
  });

  it("breaks off when the player reaches the camp clearing", () => {
    const camp = { x: 0, z: 0 };
    const s0 = at({ mode: "charge", x: 40, z: 0 });
    const inCamp = env({ camp, player: { x: WORLD.campClearRadius - 2, z: 0 } });
    expect(stepJaguar(s0, DT, inCamp).state.mode).toBe("prowl");
    // And a hunt can't even start on someone in the clearing.
    const prowler = at({ x: 30, z: 0 });
    expect(stepJaguar(prowler, DT, inCamp).state.mode).toBe("prowl");
  });

  it("breaks off when the player wades into water", () => {
    const player = { x: 100, z: -100 };
    const wet = (x: number, z: number) => (x === player.x && z === player.z ? WADE_DEPTH + 0.3 : -1);
    const s0 = at({ mode: "charge", x: player.x - 8, z: player.z });
    expect(stepJaguar(s0, DT, env({ player, waterDepthAt: wet })).state.mode).toBe("prowl");
  });

  it("never sets foot in water deeper than a wade — the charge stops at the bank", () => {
    const player = { x: 120, z: -100 }; // dry ground beyond the channel
    // A deep channel at x ∈ (105, 112) between the jaguar and the player.
    const channel = (x: number) => (x > 105 && x < 112 ? 2 : -1);
    const s0 = at({ mode: "charge", x: 100, z: player.z });
    const { s, strikes } = run(s0, 10, env({ player, waterDepthAt: (x) => channel(x) }));
    expect(strikes).toBe(0);
    expect(s.x).toBeLessThanOrEqual(105.01);
    expect(channel(s.x)).toBeLessThanOrEqual(0); // still on dry land
  });

  it("never crosses into the camp's doubled exclusion ring, even mid-charge", () => {
    const camp = { x: 0, z: 0 };
    // Player outside the clearing (not safe), jaguar charging from beyond the ring.
    const player = { x: WORLD.campClearRadius + 3, z: 0 };
    const s0 = at({ mode: "charge", x: CAMP_EXCLUSION + 1.5, z: 0 });
    const { s, strikes } = run(s0, 10, env({ camp, player }));
    expect(strikes).toBe(0);
    expect(Math.hypot(s.x - camp.x, s.z - camp.z)).toBeGreaterThanOrEqual(CAMP_EXCLUSION - 1e-6);
  });

  it("is deterministic: same state + env in, same result out", () => {
    const s0 = at({ mode: "stalk", x: 10, z: -80, stalkSeconds: 1 });
    const e = env({ player: { x: 30, z: -80 } });
    expect(stepJaguar(s0, DT, e)).toEqual(stepJaguar(s0, DT, e));
  });
});

describe("stepJaguar — the snake double-take (J1 #221)", () => {
  const s0 = initialJaguarState();
  const stalkState = (): JaguarState => ({ ...s0, mode: "stalk", stalkSeconds: 1 });

  it("a snake underfoot mid-stalk startles it: freeze-beat, then a bolt, then prowl on a long cooldown", () => {
    // Snake right on the stalk path.
    const snake = { x: s0.x + 2, z: s0.z };
    const e = env({ player: { x: s0.x + 20, z: s0.z }, snakes: [snake] });
    let r = stepJaguar(stalkState(), DT, e);
    expect(r.state.mode).toBe("startled");
    expect(r.startled).toBe(true);

    // The freeze beat: held dead-still.
    const frozenX = r.state.x;
    for (let t = 0; t < STARTLE_FREEZE - DT; t += DT) {
      r = stepJaguar(r.state, DT, e);
      expect(r.state.x).toBe(frozenX);
    }
    // Then the ignominious bolt — AWAY from the snake, faster than a charge.
    for (let t = 0; t < 0.5; t += DT) r = stepJaguar(r.state, DT, e);
    expect(Math.hypot(r.state.x - snake.x, r.state.z - snake.z)).toBeGreaterThan(2);

    // The bolt resolves into prowl with the long humiliation cooldown.
    for (let t = 0; t < STARTLE_BOLT_SECONDS + 0.2; t += DT) r = stepJaguar(r.state, DT, e);
    expect(r.state.mode).toBe("prowl");
    expect(r.state.cooldown).toBeGreaterThan(STARTLED_COOLDOWN - 5);
  });

  it("startled reports its edge exactly once", () => {
    const snake = { x: s0.x + 2, z: s0.z };
    const e = env({ player: { x: s0.x + 20, z: s0.z }, snakes: [snake] });
    let r = stepJaguar(stalkState(), DT, e);
    expect(r.startled).toBe(true);
    r = stepJaguar(r.state, DT, e);
    expect(r.startled).toBe(false); // held startled ≠ a new edge
  });

  it("will not stalk again during the humiliation cooldown", () => {
    const snake = { x: s0.x + 2, z: s0.z };
    const e = env({ player: { x: s0.x + 6, z: s0.z }, snakes: [snake] });
    let r = stepJaguar(stalkState(), DT, e);
    for (let t = 0; t < STARTLE_FREEZE + STARTLE_BOLT_SECONDS + 1; t += DT) {
      r = stepJaguar(r.state, DT, e);
    }
    expect(r.state.mode).toBe("prowl");
    // Player well inside stalk range, but the cat has had enough today.
    r = stepJaguar(r.state, DT, env({ player: { x: r.state.x + 5, z: r.state.z }, snakes: [] }));
    expect(r.state.mode).toBe("prowl");
  });

  it("a committed CHARGE is never interrupted by a snake — the pounce stays dangerous", () => {
    const snake = { x: s0.x + 1, z: s0.z };
    const charging: JaguarState = { ...s0, mode: "charge" };
    const e = env({ player: { x: s0.x + 8, z: s0.z }, snakes: [snake] });
    const r = stepJaguar(charging, DT, e);
    expect(r.state.mode === "charge" || r.state.mode === "retreat").toBe(true);
  });

  it("no snakes in the env: stalking is byte-for-byte unaffected", () => {
    const e = env({ player: { x: s0.x + 20, z: s0.z } }); // no snakes field
    const r = stepJaguar(stalkState(), DT, e);
    expect(r.state.mode).toBe("stalk");
  });
});

describe("isNightPhase", () => {
  it("noon is day, evening is night", () => {
    expect(isNightPhase(0.25)).toBe(false);
    expect(isNightPhase(0.75)).toBe(true);
  });
});

describe("JaguarSystem", () => {
  const terrain = buildTerrain();

  function rig(opts: { px?: number; pz?: number; phase?: number } = {}) {
    const scene = new THREE.Scene();
    const session = { paused: false };
    const hurt = vi.fn();
    const player = { state: { position: new THREE.Vector3(opts.px ?? 1000, 0, opts.pz ?? 1000) } };
    const sys = new JaguarSystem(
      scene,
      terrain,
      DRY,
      { getPhase: () => opts.phase ?? 0.25 },
      player,
      session,
      hurt,
    );
    return { scene, session, sys, hurt, player };
  }

  it("spawns deterministically at the first territory waypoint, in 2 draw calls", () => {
    const { scene, sys } = rig();
    const group = scene.children.find((o) => o.name === "wildlife-jaguar")!;
    expect(group.position.x).toBe(TERRITORY[0].x);
    expect(group.position.z).toBe(TERRITORY[0].z);
    const meshes: THREE.Mesh[] = [];
    group.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    expect(meshes.length).toBe(2); // merged body + eyes
    expect(sys.describe()).toEqual(new JaguarSystem(
      new THREE.Scene(), terrain, DRY, { getPhase: () => 0.25 },
      { state: { position: new THREE.Vector3(1000, 0, 1000) } }, { paused: false }, () => {},
    ).describe());
  });

  it("holds the hunt while paused", () => {
    const wp = TERRITORY[0];
    const { session, sys } = rig({ px: wp.x + 10, pz: wp.z });
    session.paused = true;
    for (let i = 0; i < 120; i++) sys.update(FRAME);
    expect((sys.describe() as { jaguar: string }).jaguar).toBe("prowl");
    expect(sys.isStalking()).toBe(false);

    session.paused = false;
    sys.update(FRAME);
    expect(sys.isStalking()).toBe(true);
  });

  it("feeds a landed strike into the injected hurt(45) exactly once", () => {
    const wp = TERRITORY[0];
    const { sys, hurt, player } = rig({ px: wp.x + CHARGE_RANGE - 2, pz: wp.z });
    // Let the stalk minimum build (it shadows a static player, never charging)…
    for (let i = 0; i < 60 * 5; i++) sys.update(FRAME);
    expect(sys.isStalking()).toBe(true);
    expect(hurt).not.toHaveBeenCalled();
    // …then the player blunders right up to it: charge → strike.
    const pos = (sys.describe() as { at: { x: number; z: number } }).at;
    player.state.position.set(pos.x, 0, pos.z);
    for (let i = 0; i < 30; i++) sys.update(FRAME);
    expect(hurt).toHaveBeenCalledWith(STRIKE_DAMAGE);
    expect(hurt).toHaveBeenCalledTimes(1);
    // …and it is now gone (retreat), not camped on the player.
    expect(sys.isStalking()).toBe(false);
  });

  it("eyes are emissive at night, banked by day", () => {
    const { scene, sys } = rig({ phase: 0.75 }); // evening = night half
    sys.update(FRAME);
    const eyes = scene.getObjectByName("wildlife-jaguar-eyes") as THREE.Mesh;
    expect((eyes.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(
      EYE_NIGHT_EMISSIVE,
    );

    const day = rig({ phase: 0.25 });
    day.sys.update(FRAME);
    const dayEyes = day.scene.getObjectByName("wildlife-jaguar-eyes") as THREE.Mesh;
    expect((dayEyes.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(
      EYE_DAY_EMISSIVE,
    );
  });

  it("stays within the wildlife triangle budget", () => {
    const { scene } = rig();
    let tris = 0;
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const geo = o.geometry;
        tris += (geo.index ? geo.index.count : geo.getAttribute("position").count) / 3;
      }
    });
    expect(tris).toBeLessThan(2000);
  });

  it("disposes geometries and materials and detaches from the scene", () => {
    const { scene, sys } = rig();
    expect(() => sys.dispose()).not.toThrow();
    expect(scene.children.find((o) => o.name === "wildlife-jaguar")).toBeUndefined();
  });

  it("mottles the coat with rosette blotches (Objects slice 2), not one flat colour", () => {
    const { scene } = rig();
    const body = scene.getObjectByName("wildlife-jaguar-body") as THREE.Mesh;
    const color = body.geometry.getAttribute("color");
    const first = new THREE.Color(color.getX(0), color.getY(0), color.getZ(0));
    let sawDifferent = false;
    for (let i = 1; i < color.count; i++) {
      const c = new THREE.Color(color.getX(i), color.getY(i), color.getZ(i));
      if (!c.equals(first)) sawDifferent = true;
    }
    expect(sawDifferent).toBe(true);
  });

  it("builds a proportioned body (chest+hip lobes, head+muzzle+ears, curved tail, jointed legs)", () => {
    const { scene } = rig();
    const body = scene.getObjectByName("wildlife-jaguar-body") as THREE.Mesh;
    // The prior single-dodecahedron+box+cylinder+4-leg body was 116
    // triangles; this substantially richer silhouette is well beyond that,
    // still comfortably inside the per-creature <2000 budget above.
    const tris = body.geometry.getAttribute("position").count / 3;
    expect(tris).toBeGreaterThan(116);
    expect(tris).toBeLessThan(2000);
  });
});
