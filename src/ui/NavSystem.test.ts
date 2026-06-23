import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { NavSystem } from "./NavSystem.ts";
import { createNavStore } from "./navStore.ts";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";
import type { DiscoverablePoi } from "../content/discoverablePois.ts";
import type { Engine } from "../engine/Engine.ts";
import type { FrameContext } from "../engine/types.ts";

/** A camera at the origin looking down -Z, like Three.js's default forward. */
function frontCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
  cam.position.set(0, 0, 0);
  cam.lookAt(0, 0, -1);
  cam.updateMatrixWorld(true);
  return cam;
}

/** Minimal Engine stand-in: NavSystem only reads `engine.camera`. */
function fakeEngine(camera: THREE.PerspectiveCamera): Engine {
  return { camera } as unknown as Engine;
}

function fakeVehicle(pos: THREE.Vector3) {
  return { state: { position: pos } } as { state: { position: THREE.Vector3 } };
}

const ctx: FrameContext = {
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(),
  dt: 1 / 60,
  elapsed: 0,
};

function poi(id: string, position: THREE.Vector3, order = 1): DiscoverablePoi {
  return { id, order, title: id, teaser: "", body: "", color: 0x123456, position };
}

describe("NavSystem (#44)", () => {
  it("marks a POI in front of the camera as on-screen with a centred position", () => {
    const cam = frontCamera();
    const pois = [poi("ahead", new THREE.Vector3(0, 0, -100))];
    const navStore = createNavStore();
    const discovery = createDiscoveryStore(pois.length);
    const sys = new NavSystem(fakeEngine(cam), fakeVehicle(new THREE.Vector3(0, 0, 0)), pois, navStore, discovery);

    sys.update(ctx);
    const markers = navStore.getSnapshot().markers;
    expect(markers).toHaveLength(1);
    const m = markers[0];
    expect(m.id).toBe("ahead");
    expect(m.onScreen).toBe(true);
    // Dead centre of the screen.
    expect(m.x).toBeCloseTo(50, 0);
    expect(m.y).toBeCloseTo(50, 0);
    expect(m.label).toBe("100 m");
  });

  it("marks a POI behind the camera as off-screen with an edge angle", () => {
    const cam = frontCamera();
    const pois = [poi("behind", new THREE.Vector3(0, 0, 100))]; // behind a -Z camera
    const navStore = createNavStore();
    const discovery = createDiscoveryStore(pois.length);
    const sys = new NavSystem(fakeEngine(cam), fakeVehicle(new THREE.Vector3(0, 0, 0)), pois, navStore, discovery);

    sys.update(ctx);
    const markers = navStore.getSnapshot().markers;
    expect(markers).toHaveLength(1);
    expect(markers[0].onScreen).toBe(false);
    expect(Number.isFinite(markers[0].edgeAngle)).toBe(true);
  });

  it("hides a POI once it is discovered", () => {
    const cam = frontCamera();
    const pois = [poi("ahead", new THREE.Vector3(0, 0, -100))];
    const navStore = createNavStore();
    const discovery = createDiscoveryStore(pois.length);
    discovery.setDiscovered(["ahead"]);
    const sys = new NavSystem(fakeEngine(cam), fakeVehicle(new THREE.Vector3(0, 0, 0)), pois, navStore, discovery);

    sys.update(ctx);
    expect(navStore.getSnapshot().markers).toHaveLength(0);
  });

  it("computes distance from the vehicle, not the camera", () => {
    const cam = frontCamera();
    const pois = [poi("ahead", new THREE.Vector3(0, 0, -100))];
    const navStore = createNavStore();
    const discovery = createDiscoveryStore(pois.length);
    // Vehicle is 60 m closer than the camera origin.
    const sys = new NavSystem(fakeEngine(cam), fakeVehicle(new THREE.Vector3(0, 0, -40)), pois, navStore, discovery);

    sys.update(ctx);
    expect(navStore.getSnapshot().markers[0].label).toBe("60 m");
  });

  it("excludes a discovered POI when the showDiscovered reader returns false", () => {
    const cam = frontCamera();
    const pois = [poi("ahead", new THREE.Vector3(0, 0, -100))];
    const navStore = createNavStore();
    const discovery = createDiscoveryStore(pois.length);
    discovery.setDiscovered(["ahead"]);
    const sys = new NavSystem(
      fakeEngine(cam),
      fakeVehicle(new THREE.Vector3(0, 0, 0)),
      pois,
      navStore,
      discovery,
      () => false,
    );

    sys.update(ctx);
    expect(navStore.getSnapshot().markers).toHaveLength(0);
  });

  it("includes a discovered POI when the showDiscovered reader returns true", () => {
    const cam = frontCamera();
    const pois = [poi("ahead", new THREE.Vector3(0, 0, -100))];
    const navStore = createNavStore();
    const discovery = createDiscoveryStore(pois.length);
    discovery.setDiscovered(["ahead"]);
    const sys = new NavSystem(
      fakeEngine(cam),
      fakeVehicle(new THREE.Vector3(0, 0, 0)),
      pois,
      navStore,
      discovery,
      () => true,
    );

    sys.update(ctx);
    const markers = navStore.getSnapshot().markers;
    expect(markers).toHaveLength(1);
    expect(markers[0].id).toBe("ahead");
  });

  it("caps off-screen edge arrows to the 3 nearest undiscovered POIs", () => {
    const cam = frontCamera();
    // Five POIs all behind the camera (off-screen) at increasing distances.
    const pois = [10, 20, 30, 40, 50].map((d, i) => poi(`p${i}`, new THREE.Vector3(0, 0, d), i + 1));
    const navStore = createNavStore();
    const discovery = createDiscoveryStore(pois.length);
    const sys = new NavSystem(fakeEngine(cam), fakeVehicle(new THREE.Vector3(0, 0, 0)), pois, navStore, discovery);

    sys.update(ctx);
    const offScreen = navStore.getSnapshot().markers.filter((m) => !m.onScreen);
    expect(offScreen).toHaveLength(3);
    // The nearest three (p0, p1, p2) survive the cap.
    expect(offScreen.map((m) => m.id).sort()).toEqual(["p0", "p1", "p2"]);
  });
});
