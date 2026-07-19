import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { GameHandle } from "./GameCanvas.tsx";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";
import type { DiscoveryStore } from "../discovery/discoveryStore.ts";
import { createHudStore } from "../ui/hudStore.ts";
import { createSession } from "../gameSession.ts";
import type { GameSession } from "../gameSession.ts";
import { createSettingsStore } from "../settings/settingsStore.ts";
import type { JournalPanelProps } from "../ui/JournalPanel.tsx";

// GameCanvas owns a real WebGLRenderer + Engine + ResizeObserver, none of which
// jsdom provides. Stub the renderer + engine so the React shell mounts headless;
// this file proves only the T6 wiring (journalOpen state + the 'journal' pause
// reason + the discovery-store handoff that overlaps it with the reveal reason).
vi.mock("./createRenderer.ts", () => ({
  createRenderer: () => ({ shadowMap: { enabled: false }, setPixelRatio() {} }),
  applyRendererQuality: () => {},
}));

// Sibling to createRenderer: the bloom compositor builds WebGL-only
// postprocessing effects. GameCanvas reaches it through a dynamic import()
// (the lazy postfx chunk), which vi.mock intercepts the same as a static one —
// so the medium-default jsdom tier (bloom: true) keeps this headless shell
// test WebGL-free.
vi.mock("./createCompositor.ts", () => ({
  createBloomCompositor: () => ({ render() {}, setSize() {}, dispose() {} }),
}));

// Capture the props JournalPanel mounts with, so the test can drive its
// onClose/store from the outside without depending on the panel's own chrome.
const journalPanelProps: JournalPanelProps[] = [];
vi.mock("../ui/JournalPanel.tsx", () => ({
  JournalPanel: (props: JournalPanelProps) => {
    journalPanelProps.push(props);
    return null;
  },
}));

const engineStub = {
  resize() {},
  start() {},
  stop() {},
  advanceTime() {},
  renderFromView() {},
  setCompositor() {}, // the lazy compositor attaches here on the bloom tiers
  getState: () => ({}),
  dispose() {},
};
vi.mock("./Engine.ts", () => ({
  Engine: vi.fn(() => engineStub),
}));

import { GameCanvas } from "./GameCanvas.tsx";

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

const JOURNAL_POIS = POIS.map((p) => ({
  ...p,
  teaser: `${p.title} teaser`,
  body: `${p.title} body`,
  color: 0xffffff,
}));

function makeHandle(): { handle: GameHandle; store: DiscoveryStore; session: GameSession } {
  const store = createDiscoveryStore(POIS.length);
  const session = createSession();
  const handle: GameHandle = {
    discovery: {
      store,
      pois: POIS,
      journalPois: JOURNAL_POIS,
      reset() {
        store.setDiscovered([]);
      },
      consumeInteract: () => false,
    },
    hud: createHudStore(),
    settings: createSettingsStore(),
    session,
  };
  return { handle, store, session };
}

/** The most recent props JournalPanel was rendered with. */
function lastJournalProps(): JournalPanelProps {
  const last = journalPanelProps.at(-1);
  if (!last) throw new Error("JournalPanel was never rendered");
  return last;
}

describe("GameCanvas — Journal pause + handoff wiring (T6)", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    journalPanelProps.length = 0;
    // The first-run onboarding overlay opens on a fresh visit and (correctly)
    // blocks the J opener while it's up. Mark it seen so these tests exercise the
    // journal opener directly, not the onboarding precedence (covered elsewhere).
    localStorage.setItem("aboutmegame.onboarding.v1", "1");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("does not render the JournalPanel until the journal is opened", () => {
    const { handle } = makeHandle();
    render(<GameCanvas build={() => handle} showStats={false} />);
    expect(journalPanelProps.length).toBe(0);
  });

  it("opening the journal pauses the sim via the 'journal' reason, and the pause never drops for a frame across the reveal handoff", () => {
    const { handle, store, session } = makeHandle();
    // Drive requestAnimationFrame synchronously so the handoff poll runs under
    // our control: the journal reason must overlap the reveal reason every step.
    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const flushFrame = () =>
      act(() => {
        const cbs = rafQueue.splice(0);
        for (const cb of cbs) cb(0);
      });

    render(<GameCanvas build={() => handle} showStats={false} />);

    // Fresh world: nothing paused.
    expect(session.paused).toBe(false);

    // Open the journal (J). The 'journal' reason pauses the sim.
    act(() => {
      fireEvent.keyDown(window, { key: "j" });
    });
    expect(journalPanelProps.length).toBeGreaterThan(0);
    expect(session.paused).toBe(true);

    // The reveal commit: store.open goes non-null (as openPoi from the journal
    // would do). DiscoverySystem only derives the 'reveal' reason on its NEXT
    // tick, so right here the journal reason alone must still hold the pause.
    act(() => {
      store.openPoi({ id: "poi-alpha", order: 1, title: "Alpha", body: "Alpha body" });
    });
    expect(session.paused).toBe(true);

    // A frame passes WITHOUT the reveal reason yet (DiscoverySystem hasn't run):
    // the handoff must NOT clear the journal — paused stays true.
    flushFrame();
    expect(session.paused).toBe(true);
    expect(store.getSnapshot().open).not.toBeNull();

    // Now DiscoverySystem ticks and establishes the 'reveal' reason. The two
    // reasons coexist in the session Set for this instant — the overlap.
    act(() => {
      session.setPaused("reveal", true);
    });
    expect(session.paused).toBe(true);

    // The next handoff frame observes the reveal reason and clears journalOpen —
    // the journal reason drops, but the reveal reason already holds the pause, so
    // it never gaps to false across the whole handoff.
    flushFrame();
    expect(session.paused).toBe(true);

    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
  });

  it("clears journalOpen once both store.open is non-null and the reveal reason is live, unmounting the panel", () => {
    const { handle, store, session } = makeHandle();
    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const flushFrame = () =>
      act(() => {
        const cbs = rafQueue.splice(0);
        for (const cb of cbs) cb(0);
      });

    render(<GameCanvas build={() => handle} showStats={false} />);

    act(() => {
      fireEvent.keyDown(window, { key: "j" });
    });
    expect(journalPanelProps.length).toBeGreaterThan(0);
    expect(lastJournalProps()).toBeDefined();

    // Reveal commits + DiscoverySystem establishes the reveal reason.
    act(() => {
      store.openPoi({ id: "poi-alpha", order: 1, title: "Alpha", body: "Alpha body" });
      session.setPaused("reveal", true);
    });
    flushFrame();

    // journalOpen cleared — the panel unmounts and does not re-render on a store
    // nudge, while the reveal reason still holds the pause.
    const afterClear = journalPanelProps.length;
    act(() => {
      store.setNearby(null);
    });
    expect(journalPanelProps.length).toBe(afterClear);
    expect(session.paused).toBe(true);

    vi.unstubAllGlobals();
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
  });

  it("does not pause via 'journal' while a reveal is already open (J is ignored so modals don't stack)", () => {
    const { handle, store, session } = makeHandle();
    render(<GameCanvas build={() => handle} showStats={false} />);

    // A reveal is already up.
    act(() => {
      store.openPoi({ id: "poi-alpha", order: 1, title: "Alpha", body: "Alpha body" });
    });
    journalPanelProps.length = 0;

    act(() => {
      fireEvent.keyDown(window, { key: "j" });
    });
    // J was ignored — the reveal owns the foreground, no journal mounted.
    expect(journalPanelProps.length).toBe(0);
    expect(session.paused).toBe(false);
  });
});

describe("GameCanvas — J opener + Escape precedence (T11)", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    journalPanelProps.length = 0;
    // First-run onboarding correctly blocks J while it's up; mark it seen so these
    // tests exercise the opener precedence directly, not the onboarding gate.
    localStorage.setItem("aboutmegame.onboarding.v1", "1");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("pressing J with nothing open mounts the journal (journalOpen true)", () => {
    const { handle } = makeHandle();
    render(<GameCanvas build={() => handle} showStats={false} />);

    expect(journalPanelProps.length).toBe(0);
    act(() => {
      fireEvent.keyDown(window, { key: "j" });
    });
    expect(journalPanelProps.length).toBeGreaterThan(0);
  });

  it("pressing J while the menu is open is a no-op (no modal stacks behind the menu)", () => {
    const { handle } = makeHandle();
    render(<GameCanvas build={() => handle} showStats={false} />);

    // Open the menu (Escape with nothing else up).
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    journalPanelProps.length = 0;

    act(() => {
      fireEvent.keyDown(window, { key: "j" });
    });
    // J ignored — the menu owns the foreground, no journal mounted behind it.
    expect(journalPanelProps.length).toBe(0);
  });

  it("pressing J while the journal is already open is a no-op (no re-open)", () => {
    const { handle } = makeHandle();
    render(<GameCanvas build={() => handle} showStats={false} />);

    act(() => {
      fireEvent.keyDown(window, { key: "j" });
    });
    const afterOpen = journalPanelProps.length;
    expect(afterOpen).toBeGreaterThan(0);

    // A second J must not re-trigger the opener (journalOpen already true). Any
    // re-render of the still-mounted panel from React is fine; the guard means
    // the keydown itself adds no state change, so no extra mount round-trips.
    act(() => {
      fireEvent.keyDown(window, { key: "j" });
    });
    expect(journalPanelProps.length).toBe(afterOpen);
  });

  it("with the journal open, Escape closes the journal and does NOT open the menu (precedence)", () => {
    const { handle } = makeHandle();
    render(<GameCanvas build={() => handle} showStats={false} />);

    // Journal is up.
    act(() => {
      fireEvent.keyDown(window, { key: "j" });
    });
    expect(journalPanelProps.length).toBeGreaterThan(0);
    const onClose = lastJournalProps().onClose;

    // The journal owns Escape while topmost: GameCanvas's Escape handler must
    // early-return on journalOpen, so it neither opens the menu nor double-handles
    // the key — the JournalPanel's own Escape (its onClose) is the only closer.
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    // No SettingsMenu mounted behind the journal.
    expect(screen.queryByRole("dialog", { name: /settings|menu|paused/i })).toBeNull();

    // The panel's own onClose (what its Escape calls) clears journalOpen and
    // unmounts the journal without ever popping the menu.
    const beforeClose = journalPanelProps.length;
    act(() => {
      onClose();
    });
    const afterClose = journalPanelProps.length;
    // The journal stopped rendering (unmounted)…
    expect(afterClose).toBe(beforeClose);
    // …and a subsequent J re-opens it, proving the menu never claimed Escape.
    act(() => {
      fireEvent.keyDown(window, { key: "j" });
    });
    expect(journalPanelProps.length).toBeGreaterThan(afterClose);
  });
});
