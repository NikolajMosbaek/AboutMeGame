import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DiscoveryBurst, BURST_PARTICLES, BURST_DURATION } from "./discoveryBurst.ts";
import { DiscoveryBurstSystem } from "./DiscoveryBurstSystem.ts";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";
import { POINT_SPRITE_ALPHA_TEST } from "./pointSprite.ts";
import type { PlacedLandmark } from "../world/landmarks.ts";
import type { FrameContext } from "../engine/types.ts";

function ctx(dt: number): FrameContext {
  return { scene: {} as never, camera: {} as never, dt, elapsed: 0 };
}

function placed(): PlacedLandmark[] {
  return [
    {
      poiId: "p1",
      label: "One",
      position: new THREE.Vector3(10, 2, -5),
      object: new THREE.Object3D(),
      color: 0xff0000,
    },
  ];
}

function openInfo(id: string) {
  return { id, order: 1, title: "T", body: "B" };
}

describe("DiscoveryBurst (pooled particles)", () => {
  it("allocates a single Points cloud and starts idle/invisible", () => {
    const b = new DiscoveryBurst();
    expect(b.points).toBeInstanceOf(THREE.Points);
    expect(b.active).toBe(false);
    expect(b.points.visible).toBe(false);
    const pos = b.points.geometry.getAttribute("position");
    expect(pos.count).toBe(BURST_PARTICLES);
    b.dispose();
  });

  it("activates on trigger and parks after its duration", () => {
    const b = new DiscoveryBurst();
    b.trigger(new THREE.Vector3(0, 5, 0), 0x00ff00);
    expect(b.active).toBe(true);
    expect(b.points.visible).toBe(true);
    b.update(BURST_DURATION + 0.1);
    expect(b.active).toBe(false);
    expect(b.points.visible).toBe(false);
    b.dispose();
  });

  it("uses the shared soft-round point sprite (no more hard GL-point squares)", () => {
    const b = new DiscoveryBurst();
    const mat = b.points.material as THREE.PointsMaterial;
    expect(mat.alphaTest).toBe(POINT_SPRITE_ALPHA_TEST);
    expect(mat.transparent).toBe(true);
    b.dispose();
  });

  it("disposes its geometry and material", () => {
    const b = new DiscoveryBurst();
    let geoDisposed = false;
    let matDisposed = false;
    b.points.geometry.addEventListener("dispose", () => (geoDisposed = true));
    (b.points.material as THREE.Material).addEventListener("dispose", () => (matDisposed = true));
    b.dispose();
    expect(geoDisposed).toBe(true);
    expect(matDisposed).toBe(true);
  });
});

describe("DiscoveryBurstSystem", () => {
  it("fires a burst on a new reveal, locating the landmark", () => {
    const scene = new THREE.Scene();
    const store = createDiscoveryStore(1);
    const sys = new DiscoveryBurstSystem(scene, store, placed());

    expect(scene.children).toContain(sys["burst"].points);
    expect(sys.describe().active).toBe(false);

    store.openPoi(openInfo("p1"));
    store.setDiscovered(["p1"]);
    expect(sys.describe().active).toBe(true);
    sys.dispose();
  });

  it("does not replay saved progress at mount", () => {
    const scene = new THREE.Scene();
    const store = createDiscoveryStore(1);
    store.setDiscovered(["p1"]); // saved before the system mounts
    const sys = new DiscoveryBurstSystem(scene, store, placed());
    // A re-open of already-discovered progress must not burst.
    store.openPoi(openInfo("p1"));
    expect(sys.describe().active).toBe(false);
    sys.dispose();
  });

  it("is suppressed under reduced motion", () => {
    const scene = new THREE.Scene();
    const store = createDiscoveryStore(1);
    const reducedMotion = { getSnapshot: () => ({ reducedMotion: true }) };
    const sys = new DiscoveryBurstSystem(scene, store, placed(), reducedMotion);
    store.openPoi(openInfo("p1"));
    store.setDiscovered(["p1"]);
    expect(sys.describe().active).toBe(false); // reveal happened, burst didn't
    sys.dispose();
  });

  it("advances the burst each frame and removes its object on dispose", () => {
    const scene = new THREE.Scene();
    const store = createDiscoveryStore(1);
    const sys = new DiscoveryBurstSystem(scene, store, placed());
    store.openPoi(openInfo("p1"));
    store.setDiscovered(["p1"]);
    sys.update(ctx(BURST_DURATION + 0.1));
    expect(sys.describe().active).toBe(false);
    sys.dispose();
    expect(scene.children).not.toContain(sys["burst"].points);
  });
});
