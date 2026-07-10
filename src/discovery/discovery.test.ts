import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createDiscoveryStore } from "./discoveryStore.ts";
import { createPersistence } from "./persistence.ts";
import { DiscoverySystem } from "./DiscoverySystem.ts";
import { createSession } from "../gameSession.ts";
import type { DiscoverablePoi } from "../content/discoverablePois.ts";
import type { InteractSource, PositionSource } from "./DiscoverySystem.ts";
import type { FrameContext } from "../engine/types.ts";

const ctx: FrameContext = {
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(),
  dt: 1 / 60,
  elapsed: 0,
};

function fakeInput() {
  let interact = false;
  const snap: InteractSource = {
    consumeInteract: () => {
      const v = interact;
      interact = false;
      return v;
    },
  };
  return { snap, press: () => (interact = true) };
}

function fakePlayer(pos: THREE.Vector3): PositionSource {
  return { state: { position: pos } };
}

const POIS: DiscoverablePoi[] = [
  { id: "a", order: 1, title: "Alpha", teaser: "ta", body: "ba", color: 0, position: new THREE.Vector3(0, 0, 0) },
  { id: "b", order: 2, title: "Beta", teaser: "tb", body: "bb", color: 0, position: new THREE.Vector3(100, 0, 0) },
];

describe("DiscoverySystem (#37, #39)", () => {
  it("drops persisted ids that aren't in this world's poi set (stale saves never inflate progress)", () => {
    const input = fakeInput();
    const store = createDiscoveryStore(POIS.length);
    const stale = mem();
    // A save written by the retired 13-landmark content set…
    stale.save(new Set(["poi-arrivals-gate", "poi-meta-mirror", "a"]));
    new DiscoverySystem(input.snap, fakePlayer(new THREE.Vector3(1000, 0, 1000)), POIS, store, stale, createSession());
    // …contributes only the ids that exist today ("a"); the rest are dropped.
    expect(store.getSnapshot().discoveredCount).toBe(1);
    expect(store.getSnapshot().discoveredIds).toEqual(["a"]);
  });


  it("surfaces a teaser when near and an interact hint when in range", () => {
    const input = fakeInput();
    const store = createDiscoveryStore(POIS.length);
    const pos = new THREE.Vector3(12, 1, 0); // within interact radius of POI a
    const sys = new DiscoverySystem(input.snap, fakePlayer(pos), POIS, store, mem(), createSession());

    sys.update(ctx);
    const n = store.getSnapshot().nearby;
    expect(n?.id).toBe("a");
    expect(n?.inRange).toBe(true);
  });

  it("shows teaser but not in-range when only within teaser radius", () => {
    const input = fakeInput();
    const store = createDiscoveryStore(POIS.length);
    const sys = new DiscoverySystem(input.snap, fakePlayer(new THREE.Vector3(25, 1, 0)), POIS, store, mem(), createSession());
    sys.update(ctx);
    expect(store.getSnapshot().nearby?.inRange).toBe(false);
  });

  it("reveals on interact, marks discovered, persists, and pauses", () => {
    const input = fakeInput();
    const store = createDiscoveryStore(POIS.length);
    const persist = mem();
    const session = createSession();
    const sys = new DiscoverySystem(input.snap, fakePlayer(new THREE.Vector3(8, 1, 0)), POIS, store, persist, session);

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

  it("carries the POI's interaction into the open snapshot end-to-end (#T7)", () => {
    const pois: DiscoverablePoi[] = [
      {
        id: "g",
        order: 1,
        title: "Guess",
        teaser: "tg",
        body: "bg",
        color: 0,
        position: new THREE.Vector3(0, 0, 0),
        interaction: {
          type: "guess",
          prompt: "Pick one",
          options: [
            { text: "x", correct: true },
            { text: "y", correct: false },
          ],
        },
      },
    ];
    const input = fakeInput();
    const store = createDiscoveryStore(pois.length);
    const sys = new DiscoverySystem(input.snap, fakePlayer(new THREE.Vector3(8, 1, 0)), pois, store, mem(), createSession());
    input.press();
    sys.update(ctx);
    expect(store.getSnapshot().open?.interaction.type).toBe("guess");
    expect(store.getSnapshot().open?.bodyUnlocked).toBe(false);
  });

  it("reveals a POI with no interaction as plain (#T7)", () => {
    const input = fakeInput();
    const store = createDiscoveryStore(POIS.length);
    const sys = new DiscoverySystem(input.snap, fakePlayer(new THREE.Vector3(8, 1, 0)), POIS, store, mem(), createSession());
    input.press();
    sys.update(ctx);
    expect(store.getSnapshot().open?.interaction.type).toBe("plain");
    expect(store.getSnapshot().open?.bodyUnlocked).toBe(true);
  });

  it("restores discovered count from persistence", () => {
    const persist = mem();
    persist.save(new Set(["a"]));
    const store = createDiscoveryStore(POIS.length);
    new DiscoverySystem(fakeInput().snap, fakePlayer(new THREE.Vector3(500, 0, 500)), POIS, store, persist, createSession());
    expect(store.getSnapshot().discoveredCount).toBe(1);
  });
});

describe("discoveryStore (#44 nav)", () => {
  it("exposes discoveredIds and keeps the count in sync", () => {
    const store = createDiscoveryStore(POIS.length);
    expect(store.getSnapshot().discoveredIds).toEqual([]);
    store.setDiscovered(["a", "b"]);
    expect(store.getSnapshot().discoveredIds).toEqual(["a", "b"]);
    expect(store.getSnapshot().discoveredCount).toBe(2);
  });

  it("returns a stable snapshot reference when discovered ids are unchanged", () => {
    const store = createDiscoveryStore(POIS.length);
    store.setDiscovered(["a"]);
    const first = store.getSnapshot();
    store.setDiscovered(["a"]);
    expect(store.getSnapshot()).toBe(first);
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
