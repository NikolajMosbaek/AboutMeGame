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
  const onFinaleStart = vi.fn();
  let found = opts.found ?? [];
  let panelOpen = false;
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
    () => panelOpen,
    { getSnapshot: () => ({ deaths: 2 }) },
    { getSnapshot: () => ({ eaten: 7 }) },
    store,
    session,
    reveal,
    undefined,
    onFinaleStart,
  );
  return {
    sys,
    store,
    session,
    reveal,
    onFinaleStart,
    player,
    press: () => (interact = true),
    setFound: (ids: string[]) => (found = ids),
    setPanelOpen: (v: boolean) => (panelOpen = v),
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

  it("digging takes ~digSeconds of holding your ground, then the finale runs unpaused", () => {
    const r = rig({ found: CLUES, at: DIG });
    r.press();
    run(r, 1); // consume: dig starts
    expect(r.store.getSnapshot().digProgress).not.toBeNull();

    run(r, Math.ceil(TUNE.digSeconds * FPS) + 2);
    // Dig complete ⇒ the spectacle, NOT the win yet: chest up, birds startled,
    // world still live — treasureFound (the panel's edge) waits for the end.
    const s = r.store.getSnapshot();
    expect(s.finaleActive).toBe(true);
    expect(s.treasureFound).toBe(false);
    expect(s.digProgress).toBeNull();
    expect(r.reveal).toHaveBeenCalledOnce();
    expect(r.onFinaleStart).toHaveBeenCalledOnce();
    expect(r.session.paused).toBe(false);
  });

  it("the finale ends after ~finaleSeconds: treasureFound flips and the session pauses", () => {
    const r = rig({ found: CLUES, at: DIG });
    r.press();
    run(r, Math.ceil(TUNE.digSeconds * FPS) + 2);
    expect(r.store.getSnapshot().finaleActive).toBe(true);

    run(r, Math.ceil(TUNE.finaleSeconds * FPS) + 2);
    const s = r.store.getSnapshot();
    expect(s.finaleActive).toBe(false);
    expect(s.treasureFound).toBe(true);
    expect(r.session.isPaused("treasure")).toBe(true);
    expect(r.onFinaleStart).toHaveBeenCalledOnce();
    // Stats froze at the win (the panel reads them from the same snapshot).
    expect(s.deaths).toBe(2);
    expect(s.fruitEaten).toBe(7);
  });

  it("the dig never re-arms during the finale", () => {
    const r = rig({ found: CLUES, at: DIG });
    r.press();
    run(r, Math.ceil(TUNE.digSeconds * FPS) + 2);
    expect(r.store.getSnapshot().finaleActive).toBe(true);
    expect(r.store.getSnapshot().digOwnsKey).toBe(false);

    r.press();
    run(r, 1);
    expect(r.store.getSnapshot().digProgress).toBeNull();
    expect(r.reveal).toHaveBeenCalledOnce();
  });

  it("publishes the missing-page count only at the dig patch", () => {
    // Away from the dig the count is 0 — it means nothing there.
    const away = rig({ found: ["a", "b", "c"], at: { x: 0, z: 0 } });
    run(away, 1);
    expect(away.store.getSnapshot().missingPages).toBe(0);

    // At the dig with 3 of 6 read: 3 missing (the locked-dig hint's count).
    const locked = rig({ found: ["a", "b", "c"], at: DIG });
    run(locked, 1);
    expect(locked.store.getSnapshot().missingPages).toBe(3);
    expect(locked.store.getSnapshot().digOwnsKey).toBe(false);

    // The fig's own unread page counts too: 5 of 6 read ⇒ 1 missing.
    const oneShort = rig({ found: CLUES.slice(0, 5), at: DIG });
    run(oneShort, 1);
    expect(oneShort.store.getSnapshot().missingPages).toBe(1);

    // All read ⇒ nothing missing, the dig owns the key instead.
    const ready = rig({ found: CLUES, at: DIG });
    run(ready, 1);
    expect(ready.store.getSnapshot().missingPages).toBe(0);
    expect(ready.store.getSnapshot().digOwnsKey).toBe(true);
  });

  it("clears the missing-page count once the treasure is found", () => {
    const r = rig({ found: CLUES, at: DIG });
    r.press();
    run(r, Math.ceil((TUNE.digSeconds + TUNE.finaleSeconds) * FPS) + 4);
    expect(r.store.getSnapshot().treasureFound).toBe(true);
    r.session.setPaused("treasure", false);
    r.setFound(["a"]); // impossible in prod (pages persist) — a pure guard check
    run(r, 1);
    expect(r.store.getSnapshot().missingPages).toBe(0);
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

  it("never starts a dig while a reveal panel is open (the one-frame race)", () => {
    const r = rig({ found: CLUES, at: DIG });
    r.setPanelOpen(true); // the fig page was JUST opened; session pause lags a frame
    r.press(); // the press meant to close the panel
    run(r, 1);
    expect(r.store.getSnapshot().digProgress).toBeNull();
    expect(r.store.getSnapshot().digOwnsKey).toBe(false);
    // The press was left for DiscoverySystem to close the panel with.
    expect(r.sys["input"].consumeInteract()).toBe(true);

    r.setPanelOpen(false);
    r.press();
    run(r, 1);
    expect(r.store.getSnapshot().digProgress).not.toBeNull(); // now it digs
  });

  it("digs exactly once: after the treasure, presses at the patch flow on", () => {
    const r = rig({ found: CLUES, at: DIG });
    r.press();
    run(r, Math.ceil((TUNE.digSeconds + TUNE.finaleSeconds) * FPS) + 4);
    expect(r.store.getSnapshot().treasureFound).toBe(true);
    r.session.setPaused("treasure", false); // "keep exploring"

    r.press();
    run(r, 1);
    expect(r.store.getSnapshot().digProgress).toBeNull();
    expect(r.store.getSnapshot().digOwnsKey).toBe(false);
    expect(r.reveal).toHaveBeenCalledOnce();
  });
});
