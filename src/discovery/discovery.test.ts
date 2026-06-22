import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createDiscoveryStore } from "./discoveryStore.ts";
import { createPersistence } from "./persistence.ts";
import { DiscoverySystem } from "./DiscoverySystem.ts";
import type { DiscoverablePoi } from "../content/discoverablePois.ts";
import type { ControlState, InputSnapshot } from "../movement/input.ts";
import type { VehicleSystem } from "../movement/vehicle.ts";
import type { FrameContext } from "../engine/types.ts";

const ctx: FrameContext = {
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(),
  dt: 1 / 60,
  elapsed: 0,
};

function fakeInput() {
  let interact = false;
  const snap: InputSnapshot = {
    state: { forward: 0, turn: 0, thrust: 0, boost: false } as ControlState,
    consumeToggleMode: () => false,
    consumeInteract: () => {
      const v = interact;
      interact = false;
      return v;
    },
  };
  return { snap, press: () => (interact = true) };
}

function fakeVehicle(pos: THREE.Vector3): VehicleSystem {
  return { state: { position: pos } } as unknown as VehicleSystem;
}

const POIS: DiscoverablePoi[] = [
  { id: "a", order: 1, title: "Alpha", teaser: "ta", body: "ba", color: 0, position: new THREE.Vector3(0, 0, 0) },
  { id: "b", order: 2, title: "Beta", teaser: "tb", body: "bb", color: 0, position: new THREE.Vector3(100, 0, 0) },
];

describe("DiscoverySystem (#37, #39)", () => {
  it("surfaces a teaser when near and an interact hint when in range", () => {
    const input = fakeInput();
    const store = createDiscoveryStore(POIS.length);
    const pos = new THREE.Vector3(12, 1, 0); // within interact radius of POI a
    const sys = new DiscoverySystem(input.snap, fakeVehicle(pos), POIS, store, mem(), { paused: false });

    sys.update(ctx);
    const n = store.getSnapshot().nearby;
    expect(n?.id).toBe("a");
    expect(n?.inRange).toBe(true);
  });

  it("shows teaser but not in-range when only within teaser radius", () => {
    const input = fakeInput();
    const store = createDiscoveryStore(POIS.length);
    const sys = new DiscoverySystem(input.snap, fakeVehicle(new THREE.Vector3(25, 1, 0)), POIS, store, mem(), {
      paused: false,
    });
    sys.update(ctx);
    expect(store.getSnapshot().nearby?.inRange).toBe(false);
  });

  it("reveals on interact, marks discovered, persists, and pauses", () => {
    const input = fakeInput();
    const store = createDiscoveryStore(POIS.length);
    const persist = mem();
    const session = { paused: false };
    const sys = new DiscoverySystem(input.snap, fakeVehicle(new THREE.Vector3(8, 1, 0)), POIS, store, persist, session);

    input.press();
    sys.update(ctx);
    expect(store.getSnapshot().open?.id).toBe("a");
    expect(store.getSnapshot().discoveredCount).toBe(1);
    expect([...persist.load()]).toContain("a");

    // next frame: paused while open
    sys.update(ctx);
    expect(session.paused).toBe(true);

    // interact again closes and resumes
    input.press();
    sys.update(ctx);
    expect(store.getSnapshot().open).toBeNull();
    sys.update(ctx);
    expect(session.paused).toBe(false);
  });

  it("restores discovered count from persistence", () => {
    const persist = mem();
    persist.save(new Set(["a"]));
    const store = createDiscoveryStore(POIS.length);
    new DiscoverySystem(fakeInput().snap, fakeVehicle(new THREE.Vector3(500, 0, 500)), POIS, store, persist, {
      paused: false,
    });
    expect(store.getSnapshot().discoveredCount).toBe(1);
  });
});

describe("discovery persistence", () => {
  it("round-trips an in-memory store", () => {
    const p = mem();
    p.save(new Set(["x", "y"]));
    expect([...p.load()].sort()).toEqual(["x", "y"]);
    p.clear();
    expect(p.load().size).toBe(0);
  });
});

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
