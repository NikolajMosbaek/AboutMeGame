import { describe, expect, it } from "vitest";
import { SurvivalSystem, TUNE } from "./SurvivalSystem.ts";
import { createSurvivalStore, FULL } from "./survivalStore.ts";
import { ExplorerSystem } from "../player/explorer.ts";
import { createSession, type GameSession } from "../gameSession.ts";
import { FRAME, fakeInput, fakeTerrain, openBounds, noWater } from "../player/testDoubles.ts";
import type { WaterDepthAt } from "../player/explorer.ts";

const SPAWN = { x: 0, z: 0, yaw: 0 };

/** One assembled survival rig over flat, dry terrain unless told otherwise. */
function rig(opts: { water?: WaterDepthAt; session?: GameSession } = {}) {
  const input = fakeInput();
  const session = opts.session ?? createSession();
  const water = opts.water ?? noWater();
  const explorer = new ExplorerSystem(
    input.snap,
    fakeTerrain(2),
    openBounds(),
    water,
    SPAWN,
    session,
  );
  const store = createSurvivalStore();
  const sys = new SurvivalSystem(
    explorer,
    input.snap,
    water,
    store,
    { getSnapshot: () => ({ nearby: null }) },
    session,
    SPAWN,
  );
  return { input, session, explorer, store, sys };
}

/** Advance both systems n frames (explorer first, like the engine order). */
function run(r: ReturnType<typeof rig>, frames: number) {
  for (let i = 0; i < frames; i++) {
    r.explorer.update(FRAME);
    r.sys.update(FRAME);
  }
}

const FPS = 60;

describe("SurvivalSystem (pivot slice D)", () => {
  it("thirst and hunger decay at their tuned rates while playing", () => {
    const r = rig();
    run(r, 60 * FPS); // one minute
    const s = r.store.getSnapshot();
    expect(s.thirst).toBe(Math.round(FULL - TUNE.thirstPerSec * 60));
    expect(s.hunger).toBe(Math.round(FULL - TUNE.hungerPerSec * 60));
    expect(s.health).toBe(FULL); // nothing empty yet
  });

  it("holds all decay while the session is paused, and drains the interact edge", () => {
    const r = rig();
    r.session.setPaused("menu", true);
    r.input.press();
    run(r, 10 * FPS);
    const s = r.store.getSnapshot();
    expect(s.thirst).toBe(FULL);
    expect(s.hunger).toBe(FULL);
    // The press behind the menu was drained, not saved up.
    expect(r.input.snap.consumeInteract()).toBe(false);
  });

  it("sprint drains stamina in ~6s, then hysteresis holds it off until stamina recovers past the re-engage line (no floor chatter)", () => {
    const r = rig();
    r.input.state.moveZ = 1;
    r.input.state.sprint = true;
    run(r, 7 * FPS); // sprint past empty
    expect(r.store.getSnapshot().stamina).toBe(0);
    expect(r.sys.canSprint()).toBe(false); // exhausted → latched out

    // Partial recovery to BETWEEN the floor (10) and the re-engage line (25):
    // the old bug re-allowed sprint the instant stamina ticked past 10, so a
    // held Shift chattered on/off. Hysteresis keeps sprint latched out here.
    r.input.state.sprint = false;
    run(r, 2 * FPS); // ~20 stamina at FULL/10 per second
    const mid = r.store.getSnapshot().stamina;
    expect(mid).toBeGreaterThan(TUNE.sprintMinStamina);
    expect(mid).toBeLessThan(TUNE.sprintReengageStamina);
    expect(r.sys.canSprint()).toBe(false); // still latched out — no chatter

    // Once stamina climbs past the re-engage line, sprint is available again.
    run(r, 2 * FPS); // now ≥ 25
    expect(r.store.getSnapshot().stamina).toBeGreaterThanOrEqual(TUNE.sprintReengageStamina);
    expect(r.sys.canSprint()).toBe(true);

    run(r, 9 * FPS);
    expect(r.store.getSnapshot().stamina).toBe(FULL);
  });

  it("does not chatter at the floor: holding sprint while empty keeps the gate flatly false", () => {
    const r = rig();
    r.input.state.moveZ = 1;
    r.input.state.sprint = true; // held down the whole time
    run(r, 7 * FPS); // drain to empty
    expect(r.sys.canSprint()).toBe(false);

    // Keep holding sprint. Stamina stays pinned at the floor, and the gate must
    // stay flatly false every single frame — never flicker true the way the
    // no-hysteresis gate did the instant stamina ticked one unit past 10.
    for (let i = 0; i < 90; i++) {
      run(r, 1);
      expect(r.sys.canSprint()).toBe(false);
    }
  });

  it("an empty thirst meter drains health at the tuned rate", () => {
    const r = rig();
    // Fast-forward thirst to empty (7 min), then 20 more seconds of drought.
    run(r, 7 * 60 * FPS + 20 * FPS);
    const s = r.store.getSnapshot();
    expect(s.thirst).toBe(0);
    // 20 s at starveDrainPerSec off a full bar.
    expect(s.health).toBe(Math.round(FULL - TUNE.starveDrainPerSec * 20));
  });

  it("drinking restores thirst one gulp per press, only near water", () => {
    const everywhereWater: WaterDepthAt = () => 0.4;
    const r = rig({ water: everywhereWater });
    run(r, 60 * FPS); // get thirsty first
    const thirstBefore = r.store.getSnapshot().thirst;

    expect(r.store.getSnapshot().canDrink).toBe(true);
    r.input.press();
    run(r, 1);
    expect(r.store.getSnapshot().thirst).toBe(
      Math.min(FULL, Math.round(thirstBefore + TUNE.drinkPerGulp)),
    );

    // A held/second frame without a new press adds nothing.
    const after = r.store.getSnapshot().thirst;
    run(r, 1);
    expect(r.store.getSnapshot().thirst).toBe(after);
  });

  it("a press on dry land is consumed and does NOT bank a drink for later", () => {
    // Dry rig: press now…
    const r = rig();
    r.input.press();
    run(r, 1);
    expect(r.input.snap.consumeInteract()).toBe(false); // drained
    expect(r.store.getSnapshot().canDrink).toBe(false);
    expect(r.store.getSnapshot().thirst).toBeLessThanOrEqual(FULL);
  });

  it("a clue prompt in range owns the key: the press is not drunk", () => {
    const everywhereWater: WaterDepthAt = () => 0.4;
    const input = fakeInput();
    const session = createSession();
    const explorer = new ExplorerSystem(input.snap, fakeTerrain(2), openBounds(), everywhereWater, SPAWN, session);
    const store = createSurvivalStore();
    const sys = new SurvivalSystem(
      explorer,
      input.snap,
      everywhereWater,
      store,
      { getSnapshot: () => ({ nearby: { inRange: true } }) },
      session,
      SPAWN,
    );
    for (let i = 0; i < 60 * FPS; i++) {
      explorer.update(FRAME);
      sys.update(FRAME);
    }
    const before = store.getSnapshot().thirst;
    input.press();
    explorer.update(FRAME);
    sys.update(FRAME);
    expect(store.getSnapshot().thirst).toBe(before); // site outranks drink
  });

  it("health at zero: death pauses the session, respawn wakes at camp with quest intact", () => {
    const r = rig();
    // Walk away from spawn so respawn visibly teleports back.
    r.input.state.moveZ = 1;
    run(r, 5 * FPS);
    r.input.state.moveZ = 0;
    expect(r.explorer.state.position.z).toBeGreaterThan(5);

    // Starve to death (thirst empties at 7min; health 100 at 2/s ≈ 50s more).
    run(r, 13 * 60 * FPS);
    const dead = r.store.getSnapshot();
    expect(dead.health).toBe(0);
    expect(dead.alive).toBe(false);
    expect(dead.deaths).toBe(1);
    expect(r.session.isPaused("death")).toBe(true);
    expect(r.sys.canSprint()).toBe(false);

    r.sys.respawn();
    const woke = r.store.getSnapshot();
    expect(woke.alive).toBe(true);
    expect(woke.health).toBe(TUNE.respawnLevel);
    expect(woke.thirst).toBe(TUNE.respawnLevel);
    expect(woke.hunger).toBe(TUNE.respawnLevel);
    expect(woke.deaths).toBe(1); // the count survives
    expect(r.session.isPaused("death")).toBe(false);
    expect(r.explorer.state.position.x).toBeCloseTo(SPAWN.x, 5);
    expect(r.explorer.state.position.z).toBeCloseTo(SPAWN.z, 5);
  });

  it("hurt() takes damage (the wildlife seam) and can kill through the same death path", () => {
    const r = rig();
    r.sys.hurt(25);
    expect(r.store.getSnapshot().health).toBe(75);
    r.sys.hurt(500);
    const s = r.store.getSnapshot();
    expect(s.health).toBe(0);
    expect(s.alive).toBe(false);
    expect(s.deaths).toBe(1);
    expect(r.session.isPaused("death")).toBe(true);
    // Dead: further damage is a no-op (no double-counted deaths).
    r.sys.hurt(10);
    expect(r.store.getSnapshot().deaths).toBe(1);
  });

  it("eat() restores hunger (the foraging seam), clamped at full", () => {
    const r = rig();
    run(r, 60 * FPS);
    const before = r.store.getSnapshot().hunger;
    r.sys.eat(25);
    expect(r.store.getSnapshot().hunger).toBe(Math.min(FULL, Math.round(before + 25)));
    r.sys.eat(500);
    expect(r.store.getSnapshot().hunger).toBe(FULL);
  });

  it("regenerates health slowly when fed and watered above half", () => {
    const everywhereWater: WaterDepthAt = () => 0.4;
    const r = rig({ water: everywhereWater });
    // Starve a LITTLE health off: thirst empties at 7:00; stop at 7:12 —
    // 12 s of drought ≈ −24 health, well clear of death.
    run(r, 7 * 60 * FPS + 12 * FPS);
    expect(r.store.getSnapshot().health).toBeLessThan(FULL);
    expect(r.store.getSnapshot().alive).toBe(true);
    for (let i = 0; i < 4; i++) {
      r.input.press();
      run(r, 1);
    }
    r.sys.eat(FULL);
    const healingFrom = r.store.getSnapshot().health;
    run(r, 10 * FPS);
    expect(r.store.getSnapshot().health).toBe(
      Math.min(FULL, Math.round(healingFrom + TUNE.regenPerSec * 10)),
    );
  });
});

// ---------------------------------------------------------------------------
// Swimming & breath (#184)

/** A survival rig floating in deep lagoon water (depth 5 m everywhere). */
function swimRig(zones?: import("../world/waterZones.ts").SwimZones) {
  const input = fakeInput();
  const session = createSession();
  const terrain = fakeTerrain(-5);
  const water: WaterDepthAt = (x, z) => 0 - terrain.heightAt(x, z);
  const explorer = new ExplorerSystem(
    input.snap,
    terrain,
    openBounds(),
    water,
    SPAWN,
    session,
    undefined,
    zones ?? { inLagoon: () => true, riverFlowAt: () => null },
  );
  const store = createSurvivalStore();
  const sys = new SurvivalSystem(
    explorer,
    input.snap,
    water,
    store,
    { getSnapshot: () => ({ nearby: null }) },
    session,
    SPAWN,
  );
  return { input, session, explorer, store, sys };
}

function runSwim(r: ReturnType<typeof swimRig>, frames: number) {
  for (let i = 0; i < frames; i++) {
    r.explorer.update(FRAME);
    r.sys.update(FRAME);
  }
}

describe("SurvivalSystem breath (#184)", () => {
  it("drains over ~30 s submerged, and drowning bites health at the tuned rate", () => {
    const r = swimRig();
    runSwim(r, 2);
    expect(r.store.getSnapshot().submerged).toBe(false); // floating: head up
    expect(r.store.getSnapshot().breath).toBe(FULL);

    // Dive: nose down + forward.
    r.input.look.dy = 1.2;
    r.input.state.moveZ = 1;
    runSwim(r, 2 * FPS);
    expect(r.store.getSnapshot().submerged).toBe(true);

    // ~half gone around the 15 s mark (give or take the dive-in frames)…
    runSwim(r, 13 * FPS);
    const half = r.store.getSnapshot().breath;
    expect(half).toBeGreaterThan(40);
    expect(half).toBeLessThan(60);

    // …empty past 30 s, and health starts draining at drownDrainPerSec.
    runSwim(r, 17 * FPS);
    expect(r.store.getSnapshot().breath).toBe(0);
    const h0 = r.store.getSnapshot().health;
    runSwim(r, 5 * FPS);
    const h1 = r.store.getSnapshot().health;
    expect(h0 - h1).toBeGreaterThan(TUNE.drownDrainPerSec * 5 - 2);
    expect(h0 - h1).toBeLessThan(TUNE.drownDrainPerSec * 5 + 2);
  });

  it("refills in ~3 s once surfaced (buoyancy floats an idle swimmer back up)", () => {
    const r = swimRig();
    r.input.look.dy = 1.2;
    r.input.state.moveZ = 1;
    runSwim(r, 12 * FPS); // ~10 s under: breath well below full
    expect(r.store.getSnapshot().breath).toBeLessThan(75);

    // Let go of everything: buoyancy brings the head back over the surface.
    r.input.state.moveZ = 0;
    runSwim(r, 20 * FPS);
    expect(r.store.getSnapshot().submerged).toBe(false);
    expect(r.store.getSnapshot().breath).toBe(FULL); // 3 s refill is long past
  });

  it("death by drowning follows the same death path", () => {
    const r = swimRig();
    r.input.look.dy = 1.2;
    r.input.state.moveZ = 1;
    // 30 s of breath + 100 health / 4 per s = 25 s → dead within ~60 s.
    runSwim(r, 60 * FPS);
    const s = r.store.getSnapshot();
    expect(s.health).toBe(0);
    expect(s.alive).toBe(false);
    expect(r.session.isPaused("death")).toBe(true);
  });
});

describe("SurvivalSystem stamina in the water (#184)", () => {
  it("cruise swimming drains at ~1/8 of the sprint rate", () => {
    const r = swimRig();
    r.input.state.moveZ = 1;
    runSwim(r, 12 * FPS);
    const expected = FULL - TUNE.staminaDrainPerSec * TUNE.swimStaminaFactor * 12;
    const got = r.store.getSnapshot().stamina;
    expect(got).toBeGreaterThan(expected - 3);
    expect(got).toBeLessThan(expected + 3);
  });

  it("sprint-swim drains at ~1/3 of the sprint rate", () => {
    const r = swimRig();
    r.input.state.moveZ = 1;
    r.input.state.sprint = true;
    runSwim(r, 6 * FPS);
    const expected = FULL - TUNE.staminaDrainPerSec * TUNE.sprintSwimStaminaFactor * 6;
    const got = r.store.getSnapshot().stamina;
    expect(got).toBeGreaterThan(expected - 3);
    expect(got).toBeLessThan(expected + 3);
  });

  it("the river's grip wrings stamina at the full sprint rate, even adrift", () => {
    const flow = { x: 0, z: 1 };
    const r = swimRig({ inLagoon: () => false, riverFlowAt: () => flow });
    runSwim(r, 2);
    expect(r.explorer.state.gripped).toBe(true);
    runSwim(r, 3 * FPS); // no input at all — the grip itself is the exertion
    const expected = FULL - TUNE.staminaDrainPerSec * 3;
    const got = r.store.getSnapshot().stamina;
    expect(got).toBeGreaterThan(expected - 3);
    expect(got).toBeLessThan(expected + 3);
  });

  it("a still float rests: stamina recovers at the surface", () => {
    const r = swimRig();
    r.input.state.moveZ = 1;
    runSwim(r, 20 * FPS); // spend some swimming
    r.input.state.moveZ = 0;
    const tired = r.store.getSnapshot().stamina;
    runSwim(r, 5 * FPS);
    expect(r.store.getSnapshot().stamina).toBeGreaterThan(tired);
  });
});

describe("drinking while swimming (#184)", () => {
  it("water at the body still counts as reachable: a press gulps", () => {
    const r = swimRig();
    runSwim(r, 60 * FPS); // get thirsty afloat
    const before = r.store.getSnapshot().thirst;
    expect(r.store.getSnapshot().canDrink).toBe(true);
    r.input.press();
    runSwim(r, 1);
    expect(r.store.getSnapshot().thirst).toBe(
      Math.min(FULL, Math.round(before + TUNE.drinkPerGulp)),
    );
  });
});
