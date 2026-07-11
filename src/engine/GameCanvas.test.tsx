import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { GameHandle } from "./GameCanvas.tsx";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";
import type { DiscoveryStore } from "../discovery/discoveryStore.ts";
import { createHudStore } from "../ui/hudStore.ts";
import { createNavStore } from "../ui/navStore.ts";
import { createSession } from "../gameSession.ts";
import { createSettingsStore } from "../settings/settingsStore.ts";
import { createQuestStore } from "../quest/questStore.ts";
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

// The bloom compositor is the sibling of createRenderer that constructs a
// postprocessing EffectComposer + effects — all WebGL-only. GameCanvas reaches
// it through a dynamic import() (the lazy postfx chunk), which this vi.mock
// intercepts the same as a static one, so the medium-default jsdom tier
// (bloom: true) doesn't drag a real composer into the headless shell. The
// tier-gating contract itself is proven in GameCanvas.compositor.test.tsx.
vi.mock("./createCompositor.ts", () => ({
  createBloomCompositor: () => ({ render() {}, setSize() {}, dispose() {} }),
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
  renderFromView: vi.fn(),
  setCompositor() {}, // the lazy compositor attaches here on the bloom tiers
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

// The position-free journal projection the handle exposes alongside POIS (M3):
// same ids/order, with the content + colour the journal renders and no THREE.
const JOURNAL_POIS = POIS.map((p) => ({
  ...p,
  teaser: `${p.title} teaser`,
  body: `${p.title} body`,
  color: 0xffffff,
}));

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
      journalPois: JOURNAL_POIS,
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
    quest: { store: createQuestStore(POIS.length), getFinaleGlow: () => 0 },
  };
  return { handle, store, resetCalls: () => resetCalls };
}

/** Flip the quest store to won — the TreasurePanel's rising edge. */
function driveToTreasure(handle: GameHandle) {
  act(() =>
    handle.quest!.store.set({
      cluesFound: 3,
      cluesTotal: 3,
      digOwnsKey: false,
      missingPages: 0,
      digProgress: null,
      finaleActive: false,
      treasureFound: true,
      playSeconds: 100,
      deaths: 0,
      fruitEaten: 4,
    }),
  );
}


describe("GameCanvas — handle seam shape (T13)", () => {
  it("exposes a position-free journalPois sibling and a consumeInteract drain", () => {
    const { handle } = makeHandle();

    // journalPois is the sibling projection, not the same reference as pois…
    expect(handle.discovery.journalPois).not.toBe(handle.discovery.pois);
    // …same ids/order as POIS, carrying the journal content + colour…
    expect(handle.discovery.journalPois.map((p) => p.id)).toEqual(
      POIS.map((p) => p.id),
    );
    expect(handle.discovery.journalPois.map((p) => p.order)).toEqual(
      POIS.map((p) => p.order),
    );
    for (const p of handle.discovery.journalPois) {
      expect(typeof p.teaser).toBe("string");
      expect(typeof p.body).toBe("string");
      expect(typeof p.color).toBe("number");
      // …and carries no THREE position — the whole point of the seam.
      expect(p).not.toHaveProperty("position");
    }

    // consumeInteract is the queued-edge drain the journal calls before openPoi.
    expect(typeof handle.discovery.consumeInteract).toBe("function");
    expect(handle.discovery.consumeInteract()).toBe(false);
  });
});

describe("GameCanvas — verifier camera-framing hook (__frameView__)", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    engineStub.renderFromView.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    delete (window as { __frameView__?: unknown }).__frameView__;
  });

  it("installs __frameView__ on mount, forwards to the engine, and removes it on unmount", () => {
    const { handle } = makeHandle();
    const { unmount } = render(<GameCanvas build={() => handle} showStats={false} />);

    // The Playwright smoke verifier reaches the framing hook on `window`.
    expect(typeof window.__frameView__).toBe("function");

    // It forwards the eye/target straight to the engine's render-one-frame seam.
    window.__frameView__!([10, 20, 30], [0, 5, 0]);
    expect(engineStub.renderFromView).toHaveBeenCalledWith([10, 20, 30], [0, 5, 0]);

    // The hook is a mount-scoped automation seam — gone once the world tears down.
    unmount();
    expect(window.__frameView__).toBeUndefined();
  });
});

describe("GameCanvas — TreasurePanel wiring (pivot slice G)", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("raises the win dialog on the quest store's treasureFound rising edge", () => {
    const { handle } = makeHandle();
    render(<GameCanvas build={() => handle} showStats={false} />);

    expect(screen.queryByRole("dialog", { name: /emerald idol/i })).toBeNull();
    driveToTreasure(handle);
    expect(screen.getByRole("dialog", { name: /emerald idol/i })).toBeInTheDocument();
  });

  it("keep exploring lifts the treasure pause and dismisses without opening the menu", () => {
    const { handle } = makeHandle();
    render(<GameCanvas build={() => handle} showStats={false} />);
    driveToTreasure(handle);
    act(() => handle.session.setPaused("treasure", true));

    fireEvent.click(screen.getByRole("button", { name: "Keep exploring" }));
    expect(screen.queryByRole("dialog", { name: /emerald idol/i })).toBeNull();
    expect(handle.session.isPaused("treasure")).toBe(false);
    expect(screen.queryByRole("dialog", { name: /settings/i })).toBeNull();
  });

  it("one Escape dismisses the panel and does NOT open the SettingsMenu", () => {
    const { handle } = makeHandle();
    render(<GameCanvas build={() => handle} showStats={false} />);
    driveToTreasure(handle);
    expect(screen.getByRole("dialog", { name: /emerald idol/i })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /emerald idol/i })).toBeNull();
    // The capture-phase Escape never reached the menu opener.
    expect(screen.queryByRole("button", { name: /resume/i })).toBeNull();
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
