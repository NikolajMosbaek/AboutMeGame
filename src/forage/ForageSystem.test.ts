import { describe, expect, it, vi } from "vitest";
import { ForageSystem, NOURISH, TUNE, type FruitPlant } from "./ForageSystem.ts";
import { createForageStore } from "./forageStore.ts";
import { createSession } from "../gameSession.ts";
import type { FrameContext } from "../engine/types.ts";

const FRAME = { scene: null, camera: null, dt: 1 / 60, elapsed: 0 } as unknown as FrameContext;
const FPS = 60;

function rig(plants: FruitPlant[], opts: { siteInRange?: boolean } = {}) {
  const store = createForageStore();
  const session = createSession();
  const eat = vi.fn();
  const ripeness = vi.fn();
  let interact = false;
  const player = { state: { position: { x: 0, z: 0 } } };
  const sys = new ForageSystem(
    plants,
    player,
    {
      consumeInteract: () => {
        const v = interact;
        interact = false;
        return v;
      },
    },
    { getSnapshot: () => ({ nearby: opts.siteInRange ? { inRange: true } : null }) },
    eat,
    store,
    session,
    ripeness,
  );
  return { sys, store, session, eat, ripeness, player, press: () => (interact = true) };
}

function plant(kind: FruitPlant["kind"], x = 0, z = 0): FruitPlant {
  return { kind, x, z, ripe: true, regrowIn: 0 };
}

function run(r: ReturnType<typeof rig>, frames: number) {
  for (let i = 0; i < frames; i++) r.sys.update(FRAME);
}

describe("ForageSystem (pivot slice E)", () => {
  it("surfaces the nearest ripe plant in reach", () => {
    const r = rig([plant("mango", 8, 0), plant("banana", 1, 0), plant("berries", 2, 0)]);
    run(r, 1);
    expect(r.store.getSnapshot().nearby).toEqual({ kind: "banana" });
  });

  it("pick-and-eat: one press eats the fruit's worth, bares the plant, counts it", () => {
    const plants = [plant("mango", 1, 0)];
    const r = rig(plants);
    r.press();
    run(r, 1);
    expect(r.eat).toHaveBeenCalledWith(NOURISH.mango);
    expect(plants[0].ripe).toBe(false);
    expect(r.ripeness).toHaveBeenCalledWith(0, false);
    expect(r.store.getSnapshot().eaten).toBe(1);
    expect(r.store.getSnapshot().nearby).toBeNull(); // bare plant offers nothing
  });

  it("regrows after regrowSeconds of play time and re-offers", () => {
    const plants = [plant("berries", 1, 0)];
    const r = rig(plants);
    r.press();
    run(r, 1);
    expect(plants[0].ripe).toBe(false);

    run(r, TUNE.regrowSeconds * FPS + 2);
    expect(plants[0].ripe).toBe(true);
    expect(r.ripeness).toHaveBeenCalledWith(0, true);
    expect(r.store.getSnapshot().nearby).toEqual({ kind: "berries" });
  });

  it("the regrow clock holds while paused", () => {
    const plants = [plant("banana", 1, 0)];
    const r = rig(plants);
    r.press();
    run(r, 1);
    r.session.setPaused("menu", true);
    run(r, TUNE.regrowSeconds * FPS * 2);
    expect(plants[0].ripe).toBe(false); // no regrowth behind the menu
  });

  it("a clue prompt in range owns the key: no pick, no hint", () => {
    const plants = [plant("mango", 1, 0)];
    const r = rig(plants, { siteInRange: true });
    r.press();
    run(r, 1);
    expect(r.eat).not.toHaveBeenCalled();
    expect(plants[0].ripe).toBe(true);
    expect(r.store.getSnapshot().nearby).toBeNull();
  });

  it("out of reach means no offer and the press flows on (not consumed)", () => {
    const r = rig([plant("mango", 50, 50)]);
    r.press();
    run(r, 1);
    expect(r.eat).not.toHaveBeenCalled();
    // The edge is left for the survival drain (this system only takes what it uses).
    expect(r.store.getSnapshot().nearby).toBeNull();
  });

  it("dispose() tears down the injected world resources", () => {
    const disposer = vi.fn();
    const sys = new ForageSystem(
      [],
      { state: { position: { x: 0, z: 0 } } },
      { consumeInteract: () => false },
      { getSnapshot: () => ({ nearby: null }) },
      () => {},
      createForageStore(),
      createSession(),
      undefined,
      disposer,
    );
    sys.dispose();
    expect(disposer).toHaveBeenCalledOnce();
  });
});
