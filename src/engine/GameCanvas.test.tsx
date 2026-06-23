import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { GameHandle } from "./GameCanvas.tsx";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";
import type { DiscoveryStore } from "../discovery/discoveryStore.ts";
import { createHudStore } from "../ui/hudStore.ts";
import { createNavStore } from "../ui/navStore.ts";
import { createSession } from "../gameSession.ts";
import { createSettingsStore } from "../settings/settingsStore.ts";
import { nextUndiscovered } from "../discovery/nextUndiscovered.ts";
import type { RevealPanelProps } from "../ui/RevealPanel.tsx";

// GameCanvas owns a real WebGLRenderer + Engine + ResizeObserver, none of which
// jsdom provides. Stub the renderer + engine so the React shell (overlays) mounts
// headless; this file proves only the T7 wiring (CompletionPanel ↔ Escape ↔
// resetProgress), not the Engine↔canvas integration (covered in Engine.test.ts).
vi.mock("./createRenderer.ts", () => ({
  createRenderer: () => ({ shadowMap: { enabled: false }, setPixelRatio() {} }),
  applyRendererQuality: () => {},
}));

// Capture the props RevealPanel is mounted with. The "Next landmark" affordance
// is rendered in a later slice (RevealPanel currently voids `pois`), so the wire
// at the GameCanvas seam (T3) is proved by the prop the panel *receives* — the
// exact `game.discovery.pois` reference — not by visible chrome.
const revealPanelProps: RevealPanelProps[] = [];
vi.mock("../ui/RevealPanel.tsx", () => ({
  RevealPanel: (props: RevealPanelProps) => {
    revealPanelProps.push(props);
    return null;
  },
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
      consumeInteract: () => false,
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

describe("GameCanvas — RevealPanel pois wiring (T3)", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    revealPanelProps.length = 0;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  /** The props RevealPanel was last mounted/re-rendered with. */
  function lastRevealProps(): RevealPanelProps {
    const last = revealPanelProps.at(-1);
    if (!last) throw new Error("RevealPanel was never rendered");
    return last;
  }

  it("mounts RevealPanel with a non-empty pois prop sourced from game.discovery.pois", () => {
    const { handle } = makeHandle();
    render(<GameCanvas build={() => handle} showStats={false} />);

    const { pois } = lastRevealProps();
    expect(pois.length).toBeGreaterThan(0);
    // The exact value GameCanvas hands CompletionPanel — one wire, one source.
    expect(pois).toBe(handle.discovery.pois);
  });

  it("hands RevealPanel a pois prop the next-landmark selector can resolve a title from for a non-last POI", () => {
    const { handle, store } = makeHandle();
    render(<GameCanvas build={() => handle} showStats={false} />);

    // Open a non-last landmark (order 1 of 3). DiscoverySystem discovers on open,
    // so the open id is already in the discovered set while the panel is up.
    act(() => {
      store.openPoi({ id: "poi-alpha", order: 1, title: "Alpha", body: "…" });
      store.setDiscovered(["poi-alpha"]);
    });

    const { pois } = lastRevealProps();
    const open = store.getSnapshot().open!;
    const next = nextUndiscovered(
      pois,
      store.getSnapshot().discoveredIds,
      open.id,
      open.order,
    );
    // The prop carries enough to name the next-by-order undiscovered landmark.
    expect(next).not.toBeNull();
    expect(next!.title).toBe("Beta");
  });
});
