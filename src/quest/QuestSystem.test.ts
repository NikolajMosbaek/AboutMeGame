import { describe, expect, it, vi } from "vitest";
import { QuestSystem, TUNE } from "./QuestSystem.ts";
import { createQuestStore } from "./questStore.ts";
import { createSession } from "../gameSession.ts";
import type { FrameContext } from "../engine/types.ts";

const FRAME = { scene: null, camera: null, dt: 1 / 60, elapsed: 0 } as unknown as FrameContext;
const FPS = 60;
const CLUES = ["a", "b", "c", "d", "e", "f"];
const DIG = { x: 100, z: -40 };

function rig(opts: { found?: string[]; at?: { x: number; z: number } } = {}) {
  const store = createQuestStore(CLUES.length);
  const session = createSession();
  const reveal = vi.fn();
  let found = opts.found ?? [];
  let interact = false;
  const player = { state: { position: opts.at ?? { x: 0, z: 0 } } };
  const sys = new QuestSystem(
    CLUES,
    DIG,
    player,
    {
      consumeInteract: () => {
        const v = interact;
        interact = false;
        return v;
      },
    },
    () => found,
    { getSnapshot: () => ({ deaths: 2 }) },
    { getSnapshot: () => ({ eaten: 7 }) },
    store,
    session,
    reveal,
  );
  return {
    sys,
    store,
    session,
    reveal,
    player,
    press: () => (interact = true),
    setFound: (ids: string[]) => (found = ids),
  };
}

function run(r: ReturnType<typeof rig>, frames: number) {
  for (let i = 0; i < frames; i++) r.sys.update(FRAME);
}

describe("QuestSystem (pivot slice G)", () => {
  it("counts read pages and mirrors the session stats", () => {
    const r = rig({ found: ["a", "c"] });
    run(r, 1);
    const s = r.store.getSnapshot();
    expect(s.cluesFound).toBe(2);
    expect(s.cluesTotal).toBe(6);
    expect(s.deaths).toBe(2);
    expect(s.fruitEaten).toBe(7);
    expect(s.digOwnsKey).toBe(false);
  });

  it("the dig owns the key only with ALL pages read AND standing at the patch", () => {
    const away = rig({ found: CLUES, at: { x: 0, z: 0 } });
    run(away, 1);
    expect(away.store.getSnapshot().digOwnsKey).toBe(false);

    const missing = rig({ found: CLUES.slice(0, 5), at: DIG });
    run(missing, 1);
    expect(missing.store.getSnapshot().digOwnsKey).toBe(false);

    const ready = rig({ found: CLUES, at: DIG });
    run(ready, 1);
    expect(ready.store.getSnapshot().digOwnsKey).toBe(true);
  });

  it("digging takes ~digSeconds of holding your ground, then reveals + pauses", () => {
    const r = rig({ found: CLUES, at: DIG });
    r.press();
    run(r, 1); // consume: dig starts
    expect(r.store.getSnapshot().digProgress).not.toBeNull();

    run(r, Math.ceil(TUNE.digSeconds * FPS) + 2);
    const s = r.store.getSnapshot();
    expect(s.treasureFound).toBe(true);
    expect(s.digProgress).toBeNull();
    expect(r.reveal).toHaveBeenCalledOnce();
    expect(r.session.isPaused("treasure")).toBe(true);
    // Stats froze at the win (the panel reads them from the same snapshot).
    expect(s.deaths).toBe(2);
    expect(s.fruitEaten).toBe(7);
  });

  it("walking off the patch cancels the dig", () => {
    const r = rig({ found: CLUES, at: DIG });
    r.press();
    run(r, 30); // half-dug
    expect(r.store.getSnapshot().digProgress).toBeGreaterThan(0);

    r.player.state.position = { x: DIG.x + TUNE.digReach + 2, z: DIG.z };
    run(r, 1);
    expect(r.store.getSnapshot().digProgress).toBeNull();
    expect(r.store.getSnapshot().treasureFound).toBe(false);
    expect(r.reveal).not.toHaveBeenCalled();
  });

  it("a press without every page read is NOT consumed (flows to the site chain)", () => {
    const r = rig({ found: CLUES.slice(0, 5), at: DIG });
    r.press();
    run(r, 1);
    expect(r.store.getSnapshot().digProgress).toBeNull();
    // The edge is still there for DiscoverySystem (registered after in prod).
    expect(r.sys["input"].consumeInteract()).toBe(true);
  });

  it("play time accumulates only while unpaused", () => {
    const r = rig();
    run(r, 90 * FPS);
    const played = r.store.getSnapshot().playSeconds;
    expect(Math.abs(played - 90)).toBeLessThanOrEqual(1); // float dt accumulation
    r.session.setPaused("menu", true);
    run(r, 30 * FPS);
    expect(r.store.getSnapshot().playSeconds).toBe(played); // frozen while paused
  });

  it("digs exactly once: after the treasure, presses at the patch flow on", () => {
    const r = rig({ found: CLUES, at: DIG });
    r.press();
    run(r, Math.ceil(TUNE.digSeconds * FPS) + 2);
    expect(r.store.getSnapshot().treasureFound).toBe(true);
    r.session.setPaused("treasure", false); // "keep exploring"

    r.press();
    run(r, 1);
    expect(r.store.getSnapshot().digProgress).toBeNull();
    expect(r.store.getSnapshot().digOwnsKey).toBe(false);
    expect(r.reveal).toHaveBeenCalledOnce();
  });
});
