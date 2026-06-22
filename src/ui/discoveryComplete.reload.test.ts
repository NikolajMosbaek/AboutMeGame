import { describe, expect, it } from "vitest";
import * as THREE from "three";

import { createDiscoveryStore } from "../discovery/discoveryStore.ts";
import { createPersistence } from "../discovery/persistence.ts";
import { DiscoverySystem } from "../discovery/DiscoverySystem.ts";
import { createSession } from "../gameSession.ts";
import type { DiscoverablePoi } from "../content/discoverablePois.ts";
import type { DiscoverySnapshot } from "../discovery/discoveryStore.ts";
import type { ControlState, InputSnapshot } from "../movement/input.ts";
import type { VehicleSystem } from "../movement/vehicle.ts";
import { completionFor } from "./discoveryComplete.ts";

// Reload guard, proven where the real logic lives (not only in the pure
// function): a DiscoverySystem seeded from persistence that already holds all
// 13 ids must emit a *completed* first snapshot, and a React detector that
// seeds its prevRef from getSnapshot() before subscribing must NOT fire the
// completion panel for that already-saved progress. This is the engine-seeding
// counterpart to completionFor's `if (!prev) return false` unit test.

const TOTAL = 13;

const POIS: DiscoverablePoi[] = Array.from({ length: TOTAL }, (_, i) => ({
  id: `poi-${i + 1}`,
  order: i + 1,
  title: `Landmark ${i + 1}`,
  teaser: `teaser ${i + 1}`,
  body: `body ${i + 1}`,
  color: 0,
  // Parked far from every landmark so update() never opens a reveal.
  position: new THREE.Vector3(1000 + i, 0, 1000 + i),
}));

function fakeInput(): InputSnapshot {
  return {
    state: { forward: 0, turn: 0, thrust: 0, boost: false } as ControlState,
    consumeToggleMode: () => false,
    consumeInteract: () => false,
  };
}

function fakeVehicle(pos: THREE.Vector3): VehicleSystem {
  return { state: { position: pos } } as unknown as VehicleSystem;
}

/** Persistence backed by an in-memory Storage shim. */
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

describe("completion reload guard (engine-seeded)", () => {
  it("emits a completed first snapshot and a seeded detector does not fire", () => {
    // Persistence already holds all 13 ids — a returning player at 13/13.
    const persist = mem();
    persist.save(new Set(POIS.map((p) => p.id)));

    const store = createDiscoveryStore(TOTAL);
    // Constructing the system loads persistence and pushes it into the store,
    // so the very first snapshot the React layer sees is already completed.
    new DiscoverySystem(
      fakeInput(),
      fakeVehicle(new THREE.Vector3(0, 0, 0)),
      POIS,
      store,
      persist,
      createSession(),
    );

    const seeded = store.getSnapshot();
    expect(seeded.discoveredCount).toBe(TOTAL);
    expect(seeded.completed).toBe(true);

    // Mirror CompletionPanel's mount: seed prevRef from getSnapshot() *before*
    // subscribing, then run one onChange. With a re-emit of the same completed
    // snapshot, completionFor must return false — no panel on reload.
    let prev: DiscoverySnapshot | null = null;
    let fired = false;
    const onChange = () => {
      const next = store.getSnapshot();
      if (completionFor(prev, next)) fired = true;
      prev = next;
    };
    prev = store.getSnapshot(); // the seed
    const unsubscribe = store.subscribe(onChange);

    // Force one emit of the already-completed snapshot (a churned re-set of the
    // same discovered ids is skipped, so nudge a different observable field).
    store.setNearby({
      id: POIS[0].id,
      order: POIS[0].order,
      title: POIS[0].title,
      teaser: POIS[0].teaser,
      inRange: false,
    });

    unsubscribe();
    expect(fired).toBe(false);
  });
});
