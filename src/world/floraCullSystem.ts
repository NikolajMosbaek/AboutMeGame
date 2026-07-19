// Understory distance culling (jungle-density epic, 2026-07-19). The 2200
// understory plants are 1–3 u tall: beyond ~100 u they contribute nothing to
// the frame but still cost their triangles in the main pass. `floraUpgrade`
// splits them into spatial chunk meshes with chunk-local bounding spheres;
// this system hides any chunk whose NEAREST possible instance (sphere edge)
// is beyond the draw distance. Frustum culling handles direction; this
// handles range. Canopy trees are deliberately NOT distance-culled — they
// are the vista.
//
// The chunk list arrives asynchronously (the lazy GLB swap), so the system
// reads it through a getter each frame — the holder-closure idiom
// (`World.weather`, the wind system holders). Cost: a handful of distance
// checks per frame over ≤ ~32 meshes; runs fine while paused (pure
// visibility, no simulation).

import type * as THREE from "three";
import type { FrameContext, System } from "../engine/types.ts";

/** Hide an understory chunk once its nearest edge is farther than this. */
export const UNDERSTORY_DRAW_DISTANCE = 90;

export class FloraCullSystem implements System {
  readonly id = "flora-cull";

  constructor(private readonly chunks: () => THREE.InstancedMesh[]) {}

  update(ctx: FrameContext): void {
    const cam = ctx.camera.position;
    for (const mesh of this.chunks()) {
      const sphere = mesh.boundingSphere;
      if (!sphere) continue; // never cull what we can't measure
      const edge = sphere.center.distanceTo(cam) - sphere.radius;
      mesh.visible = edge <= UNDERSTORY_DRAW_DISTANCE;
    }
  }

  describe(): Record<string, unknown> {
    const chunks = this.chunks();
    return { chunks: chunks.length, hidden: chunks.filter((c) => !c.visible).length };
  }
}
