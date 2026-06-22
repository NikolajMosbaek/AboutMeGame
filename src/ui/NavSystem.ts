import * as THREE from "three";
import type { System, FrameContext } from "../engine/types.ts";
import type { Engine } from "../engine/Engine.ts";
import type { DiscoverablePoi } from "../content/discoverablePois.ts";
import type { DiscoveryStore } from "../discovery/discoveryStore.ts";
import type { NavStore, NavMarker } from "./navStore.ts";

/** Show at most this many off-screen edge arrows, so the rim doesn't clutter. */
const MAX_EDGE_ARROWS = 3;

/**
 * Navigation hints (#44): each frame, project every UNDISCOVERED landmark to
 * screen space so the player can always find the next one. On-screen POIs get a
 * dot at their projected x%/y%; off-screen POIs get an edge arrow whose angle
 * points toward them — capped to the nearest few to avoid a ring of arrows.
 * Distance is measured from the vehicle (what the player feels), not the trailing
 * camera. Registered after the camera so it reads the post-update view matrix.
 * Engine (for the live camera), vehicle, pois, and both stores are injected, so
 * the projection math is unit-tested with a fake camera and no renderer.
 */
export class NavSystem implements System {
  readonly id = "nav";
  private readonly ndc = new THREE.Vector3();

  constructor(
    private readonly engine: Engine,
    private readonly vehicle: { state: { position: THREE.Vector3 } },
    private readonly pois: DiscoverablePoi[],
    private readonly navStore: NavStore,
    private readonly discovery: DiscoveryStore,
  ) {}

  update(_ctx: FrameContext): void {
    const discovered = new Set(this.discovery.getSnapshot().discoveredIds);
    const camera = this.engine.camera;
    // Refresh the camera's world/inverse matrices so projection is exact for
    // THIS frame (the renderer otherwise only updates them at render time, one
    // step later).
    camera.updateMatrixWorld();
    const eye = this.vehicle.state.position;

    type Pending = { marker: NavMarker; dist: number };
    const onScreen: NavMarker[] = [];
    const offScreen: Pending[] = [];

    for (const poi of this.pois) {
      if (discovered.has(poi.id)) continue;

      const dist = eye.distanceTo(poi.position);
      const label = `${Math.round(dist)} m`;

      // Project the world point into normalised device coordinates (-1..1).
      this.ndc.copy(poi.position).project(camera);
      const visible = this.ndc.z < 1 && Math.abs(this.ndc.x) <= 1 && Math.abs(this.ndc.y) <= 1;

      if (visible) {
        onScreen.push({
          id: poi.id,
          color: poi.color,
          label,
          onScreen: true,
          // NDC → screen percentage; y is flipped (NDC up is +, screen down is +).
          x: round1((this.ndc.x * 0.5 + 0.5) * 100),
          y: round1((-this.ndc.y * 0.5 + 0.5) * 100),
          edgeAngle: 0,
        });
      } else {
        // Behind the camera mirrors NDC; flip so the arrow points the right way.
        const flip = this.ndc.z >= 1 ? -1 : 1;
        // Screen-space angle (0 = right, grows clockwise toward screen-down).
        const edgeAngle = Math.atan2(-this.ndc.y * flip, this.ndc.x * flip);
        offScreen.push({
          dist,
          marker: { id: poi.id, color: poi.color, label, onScreen: false, x: 0, y: 0, edgeAngle: round3(edgeAngle) },
        });
      }
    }

    // Keep only the nearest few edge arrows.
    offScreen.sort((a, b) => a.dist - b.dist);
    const arrows = offScreen.slice(0, MAX_EDGE_ARROWS).map((p) => p.marker);

    this.navStore.set([...onScreen, ...arrows]);
  }

  describe(): Record<string, unknown> {
    const markers = this.navStore.getSnapshot().markers;
    return {
      markers: markers.length,
      onScreen: markers.filter((m) => m.onScreen).length,
    };
  }
}

// Whole-percent screen position: a slowly-moving camera then changes the
// rounded layout far less often, so navStore's `sameLayout` no-op keeps the
// cached snapshot and React doesn't re-render markers every frame.
function round1(n: number): number {
  return Math.round(n);
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
