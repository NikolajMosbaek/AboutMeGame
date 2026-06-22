// Discovery burst system (#53) — fires a particle pop at a landmark the instant
// it's revealed. It listens to the *same* discovery-store event the chime uses
// (a rise in `discoveredCount` with an `open` POI), looks up that landmark's
// world position, and triggers the pooled `DiscoveryBurst`. All deps are injected
// (the store, the landmark positions, the reduced-motion source), so it's
// unit-testable without WebGL.
//
// Non-essential motion: when reduced motion is active the burst is suppressed —
// the reveal still happens (panel, chime, content), it just doesn't animate.

import * as THREE from "three";
import type { System, FrameContext } from "../engine/types.ts";
import type { DiscoveryStore } from "../discovery/discoveryStore.ts";
import type { PlacedLandmark } from "../world/landmarks.ts";
import type { ReducedMotionSource } from "../world/buildWorld.ts";
import { DiscoveryBurst } from "./discoveryBurst.ts";

export class DiscoveryBurstSystem implements System {
  readonly id = "fx-burst";

  private readonly burst = new DiscoveryBurst();
  private readonly byId: Map<string, PlacedLandmark>;
  private lastDiscovered: number;
  private unsubscribe: () => void;

  constructor(
    scene: THREE.Scene,
    private readonly store: DiscoveryStore,
    placed: PlacedLandmark[],
    private readonly reducedMotion?: ReducedMotionSource,
  ) {
    this.byId = new Map(placed.map((p) => [p.poiId, p]));
    scene.add(this.burst.points);

    // Mount snapshot ⇒ don't replay saved progress as a burst.
    this.lastDiscovered = this.store.getSnapshot().discoveredCount;
    this.unsubscribe = this.store.subscribe(() => this.onChange());
  }

  private onChange(): void {
    const snap = this.store.getSnapshot();
    if (snap.discoveredCount <= this.lastDiscovered) return; // not a new find
    this.lastDiscovered = snap.discoveredCount;

    // Gate non-essential motion (#49) — skip the burst but keep the reveal.
    if (this.reducedMotion?.getSnapshot().reducedMotion) return;

    const open = snap.open;
    const landmark = open ? this.byId.get(open.id) : undefined;
    if (!landmark) return;
    // Pop a little above the base so the fountain reads against the structure.
    const at = landmark.position.clone();
    at.y += 6;
    this.burst.trigger(at, landmark.color);
  }

  update(ctx: FrameContext): void {
    this.burst.update(ctx.dt);
  }

  describe(): Record<string, unknown> {
    return { active: this.burst.active };
  }

  dispose(): void {
    this.unsubscribe();
    this.burst.points.removeFromParent();
    this.burst.dispose();
  }
}
