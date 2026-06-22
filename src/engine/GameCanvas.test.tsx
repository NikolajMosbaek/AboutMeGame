import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { GameHandle } from "./GameCanvas.tsx";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";
import type { DiscoveryStore } from "../discovery/discoveryStore.ts";
import { createHudStore } from "../ui/hudStore.ts";
import { createNavStore } from "../ui/navStore.ts";
import { createSession } from "../gameSession.ts";
import { createSettingsStore } from "../settings/settingsStore.ts";

// GameCanvas owns a real WebGLRenderer + Engine + ResizeObserver, none of which
// jsdom provides. Stub the renderer + engine so the React shell (overlays) mounts
// headless; this file proves only the T7 wiring (CompletionPanel ↔ Escape ↔
// resetProgress), not the Engine↔canvas integration (covered in Engine.test.ts).
vi.mock("./createRenderer.ts", () => ({
  createRenderer: () => ({ shadowMap: { enabled: false }, setPixelRatio() {} }),
  applyRendererQuality: () => {},
}));

const engineStub = {
  resize() {},
  start() {},
  stop() {},
  advanceTime() {},
  getState: () => ({}),
  dispose() {},
};
vi.mock("./Engine.ts", () => ({
  Engine: vi.fn(() => engineStub),
}));

import { GameCanvas } from "./GameCanvas.tsx";

// jsdom has no ResizeObserver; GameCanvas observes its container on mount.
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const POIS = [
  { id: "poi-alpha", order: 1, title: "Alpha" },
  { id: "poi-beta", order: 2, title: "Beta" },
  { id: "poi-gamma", order: 3, title: "Gamma" },
];

/** The thirteen ordered landmarks the real island carries — three is enough to
 *  drive the latch here. The build hook hands GameCanvas a real handle built on
 *  the real stores, so the completion latch and reset() run for real. */
function makeHandle(): { handle: GameHandle; store: DiscoveryStore; resetCalls: () => number } {
  const store = createDiscoveryStore(POIS.length);
  let resetCalls = 0;
  const handle: GameHandle = {
    discovery: {
      store,
      pois: POIS,
      reset() {
        resetCalls += 1;
        store.setDiscovered([]);
      },
    },
    hud: createHudStore(),
    nav: createNavStore(),
    settings: createSettingsStore(),
    session: createSession(),
  };
  return { handle, store, resetCalls: () => resetCalls };
}

/** Discover every landmark with the final reveal open, then close it — the latch
 *  arms on the 13th find (open != null) and raises the panel on close. */
function driveToCompletion(store: DiscoveryStore) {
  act(() => {
    store.openPoi({ id: "c", order: 3, title: "Gamma", body: "…" });
    store.setDiscovered(["a", "b", "c"]);
  });
  act(() => store.closePoi());
}

describe("GameCanvas — CompletionPanel wiring (T7)", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("mounts the completion panel with game.discovery.pois once the final reveal closes", () => {
    const { handle, store } = makeHandle();
    render(<GameCanvas build={() => handle} showStats={false} />);

    // Nothing while the world is fresh.
    expect(screen.queryByRole("dialog", { name: /you found everything/i })).toBeNull();

    driveToCompletion(store);

    const panel = screen.getByRole("dialog", { name: /you found everything/i });
    expect(panel).toBeInTheDocument();
    // The ordered pois prop is what populated the list.
    for (const p of POIS) {
      expect(screen.getByText(p.title)).toBeInTheDocument();
    }
  });

  it("dismisses the panel with one Escape and does NOT open the SettingsMenu", () => {
    const { handle, store } = makeHandle();
    render(<GameCanvas build={() => handle} showStats={false} />);
    driveToCompletion(store);
    expect(screen.getByRole("dialog", { name: /you found everything/i })).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    // The completion panel is gone…
    expect(screen.queryByRole("dialog", { name: /you found everything/i })).toBeNull();
    // …and that single Escape did NOT also pop the pause/settings menu.
    expect(screen.queryByRole("dialog", { name: /paused/i })).toBeNull();
  });

  it("routes the panel's Replay CTA to game.discovery.reset()", () => {
    const { handle, store, resetCalls } = makeHandle();
    render(<GameCanvas build={() => handle} showStats={false} />);
    driveToCompletion(store);

    act(() => {
      screen.getByRole("button", { name: /replay/i }).click();
    });

    expect(resetCalls()).toBe(1);
    // reset() drops to 0/3, so completion is no longer true.
    expect(store.getSnapshot().completed).toBe(false);
    // The panel lowered on Replay (it does not linger a frame).
    expect(screen.queryByRole("dialog", { name: /you found everything/i })).toBeNull();
  });
});
