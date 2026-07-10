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

  it("sprint drains stamina in ~6s and blocks sprint under the floor via the gate", () => {
    const r = rig();
    r.input.state.moveZ = 1;
    r.input.state.sprint = true;
    run(r, 7 * FPS); // sprint past empty
    expect(r.store.getSnapshot().stamina).toBe(0);
    expect(r.sys.canSprint()).toBe(false);

    // Recovery: stop sprinting; ~10s to full from empty.
    r.input.state.sprint = false;
    run(r, 2 * FPS);
    expect(r.sys.canSprint()).toBe(true); // back over the re-engage floor
    run(r, 9 * FPS);
    expect(r.store.getSnapshot().stamina).toBe(FULL);
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
