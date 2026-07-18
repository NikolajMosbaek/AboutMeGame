// Leaf-burst FX (J1 slice 6, #221) — a puff of leaf-coloured particles at the
// flock centre the instant birds flush out of a tree, so the gag reads
// visually even when the flock itself is half-hidden by canopy. Reuses the
// pooled `DiscoveryBurst` fountain (one Points draw call, zero asset bytes);
// this system is only the wiring: drain the birds' flush-position queue,
// trigger, honour reduced motion.

import * as THREE from "three";
import type { System, FrameContext } from "../engine/types.ts";
import type { ReducedMotionSource } from "../world/buildWorld.ts";
import { DiscoveryBurst } from "./discoveryBurst.ts";

/** The birds' flush-position queue — `BirdsSystem` satisfies it. Its own
 *  queue, separate from the audio's `justFlushed()` edge, so two consumers
 *  never fight over one drained flag. */
export interface FlushBurstSource {
  consumeFlushBurst(): { x: number; y: number; z: number } | null;
}

/** Canopy-leaf green — matches the foliage palette, not the landmark colors. */
const LEAF_COLOR = 0x5a8a3c;

export class LeafBurstSystem implements System {
  readonly id = "fx-leaf-burst";

  private readonly burst = new DiscoveryBurst();
  private readonly at = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly source: FlushBurstSource,
    private readonly reducedMotion?: ReducedMotionSource,
  ) {
    scene.add(this.burst.points);
  }

  update(ctx: FrameContext): void {
    const pos = this.source.consumeFlushBurst();
    // Non-essential motion: under reduced motion the queue still drains (no
    // buildup), the particles just never fire.
    if (pos && !this.reducedMotion?.getSnapshot().reducedMotion) {
      this.burst.trigger(this.at.set(pos.x, pos.y, pos.z), LEAF_COLOR);
    }
    this.burst.update(ctx.dt);
  }

  describe(): Record<string, unknown> {
    return { active: this.burst.active };
  }

  dispose(): void {
    this.burst.points.removeFromParent();
    this.burst.dispose();
  }
}
