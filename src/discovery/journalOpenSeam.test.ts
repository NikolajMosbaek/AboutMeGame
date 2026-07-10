import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createDiscoveryStore } from "./discoveryStore.ts";
import { createPersistence } from "./persistence.ts";
import { DiscoverySystem } from "./DiscoverySystem.ts";
import { createSession } from "../gameSession.ts";
import { createPlayerInput } from "../player/input.ts";
import type { DiscoverablePoi } from "../content/discoverablePois.ts";
import type { PositionSource } from "./DiscoverySystem.ts";
import type { FrameContext } from "../engine/types.ts";

/**
 * T9 — flaw-one fix verified END-TO-END at the system seam.
 *
 * Flaw one (the interact-edge leak): `input.ts` arms `interactQueued` on any
 * Enter/`e` keydown. `DiscoverySystem.update` consumes that edge at the top of
 * the frame (line 41); with a reveal open it treats the edge as "close the
 * panel" (lines 48-49). The journal opens its reveal from a click/Enter on a
 * row, so an Enter press can still be sitting in the queue. Without a drain the
 * very next `DiscoverySystem.update` would consume that stale edge and call
 * `closePoi`, dismissing the just-opened reveal one tick later.
 *
 * The fix (T8): the journal open action calls `consumeInteract()` — the SAME
 * edge `DiscoverySystem.update` reads — synchronously, immediately before
 * `store.openPoi`. This test proves the seam holds with the REAL
 * `InputController` as the single source of truth (not a fake), so the drain
 * and the system consume share one edge. The proximity reveal path is immune
 * by construction (it consumes then opens in the same update) and is re-pinned
 * here as the contrast case.
 */

const ctx: FrameContext = {
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(),
  dt: 1 / 60,
  elapsed: 0,
};

// A player standing FAR from every landmark, so the only way a reveal exists is
// the journal open action — never the proximity path. Keeps this test about the
// journal seam and nothing else.
function farPlayer(): PositionSource {
  return { state: { position: new THREE.Vector3(10_000, 0, 10_000) } };
}

const POIS: DiscoverablePoi[] = [
  { id: "a", order: 1, title: "Alpha", teaser: "ta", body: "ba", color: 0, position: new THREE.Vector3(0, 0, 0) },
  { id: "b", order: 2, title: "Beta", teaser: "tb", body: "bb", color: 0, position: new THREE.Vector3(100, 0, 0) },
];

/** A persistence backed by an in-memory Storage shim (no real localStorage). */
function mem() {
  const m = new Map<string, string>();
  const storage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
  return createPersistence(storage);
}

/** Press the keyboard interact edge (Enter), exactly as a player would — this
 *  arms `interactQueued` inside the real controller, the same flag both the
 *  journal drain and `DiscoverySystem.update` consume. */
function pressInteract() {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
}

describe("journal open survives the next DiscoverySystem.update (T9, flaw one)", () => {
  it("drains the queued interact edge so one update does NOT close the just-opened reveal", () => {
    const input = createPlayerInput(document.createElement("div"), false);
    const store = createDiscoveryStore(POIS.length);
    const session = createSession();
    const sys = new DiscoverySystem(input, farPlayer(), POIS, store, mem(), session);

    // The journal open action, modelled exactly as `JournalPanel.open`: it
    // drains the SAME interact edge `DiscoverySystem.update` reads, strictly
    // before committing the open. `buildDiscovery.consumeInteract` forwards to
    // this very `input.consumeInteract`, so this is the production wiring.
    const journalOpen = (poi: DiscoverablePoi) => {
      input.consumeInteract();
      store.openPoi({ id: poi.id, order: poi.order, title: poi.title, body: poi.body, interaction: poi.interaction });
    };

    // A stale interact edge is queued (the player pressed Enter), then the
    // journal opens a reveal while that edge is still pending.
    pressInteract();
    journalOpen(POIS[0]);
    expect(store.getSnapshot().open?.id).toBe("a");

    // One DiscoverySystem.update. The drain emptied the edge, so update reads
    // `interact === false` and leaves the reveal open (flaw one fixed).
    sys.update(ctx);
    expect(store.getSnapshot().open?.id).toBe("a");
    // And the reveal pause reason is established from the surviving open.
    expect(session.isPaused("reveal")).toBe(true);

    input.dispose();
  });

  it("WITHOUT the drain the same stale edge closes the reveal on the next update (the bug the drain prevents)", () => {
    // The negative control: skip the drain in the open action and the leak
    // reappears — proving the assertion above is load-bearing, not vacuous.
    const input = createPlayerInput(document.createElement("div"), false);
    const store = createDiscoveryStore(POIS.length);
    const sys = new DiscoverySystem(input, farPlayer(), POIS, store, mem(), createSession());

    const openWithoutDrain = (poi: DiscoverablePoi) =>
      store.openPoi({ id: poi.id, order: poi.order, title: poi.title, body: poi.body, interaction: poi.interaction });

    pressInteract();
    openWithoutDrain(POIS[0]);
    expect(store.getSnapshot().open?.id).toBe("a");

    sys.update(ctx);
    // The stale edge was consumed as a "close" — the reveal is gone one tick
    // later. This is exactly flaw one; the drain above is what stops it.
    expect(store.getSnapshot().open).toBeNull();

    input.dispose();
  });

  it("survives even when the player keeps holding Enter (auto-repeat is suppressed, so no fresh edge re-arms)", () => {
    // A held Enter fires `e.repeat` keydowns; `input.ts` only arms the edge on
    // the initial (non-repeat) press, so after the journal drain a subsequent
    // OS auto-repeat does NOT re-queue an edge that the next update would eat.
    const input = createPlayerInput(document.createElement("div"), false);
    const store = createDiscoveryStore(POIS.length);
    const sys = new DiscoverySystem(input, farPlayer(), POIS, store, mem(), createSession());

    const journalOpen = (poi: DiscoverablePoi) => {
      input.consumeInteract();
      store.openPoi({ id: poi.id, order: poi.order, title: poi.title, body: poi.body, interaction: poi.interaction });
    };

    pressInteract(); // initial press arms the edge
    journalOpen(POIS[0]);
    // OS auto-repeat while the key is still held — must NOT re-arm the edge.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", repeat: true }));

    sys.update(ctx);
    expect(store.getSnapshot().open?.id).toBe("a");

    input.dispose();
  });
});
