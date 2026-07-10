// Underwater fog (#184) — the 3D half of the submerged look (the DOM wash is
// UnderwaterOverlay's). A System registered AFTER DayCycleSystem, which writes
// the fog colour every frame: this one layers a lerp toward deep teal plus a
// density boost on top while the camera's eye is below `WORLD.seaLevel`, and
// restores the EXACT base density the frame it surfaces — the colour needs no
// restore because the day cycle rewrites it each frame before this runs, so
// blend 0 simply means "don't touch it". Zero geometry, zero draw calls: it
// mutates the one existing `FogExp2` in place, and is a no-op on the low tier
// (fog disabled, handle null) — the DOM wash still carries the cue there.

import * as THREE from "three";
import type { FrameContext, System } from "../engine/types.ts";
import { WORLD } from "./worldConfig.ts";

/** Deep-teal underwater fog colour (sRGB, like the dayCycle palette). */
export const UNDERWATER_FOG_SRGB: [number, number, number] = [0.05, 0.24, 0.27];
/** Submerged fog density — much thicker than the airborne 0.0022: metres of
 *  visibility, not hundreds, is what sells being under the surface. */
export const UNDERWATER_FOG_DENSITY = 0.045;
/** Blend-in rate per second: fully teal ~a third of a second after the eye
 *  goes under (surfacing restores instantly — gasping for air reads sharp). */
const BLEND_IN_PER_SEC = 3;

export class UnderwaterFxSystem implements System {
  readonly id = "underwaterFx";

  /** 0 = the day cycle's fog untouched, 1 = fully underwater. */
  private blend = 0;
  private readonly baseDensity: number;
  private readonly teal = new THREE.Color().setRGB(...UNDERWATER_FOG_SRGB, THREE.SRGBColorSpace);

  constructor(private readonly fog: THREE.FogExp2 | null) {
    this.baseDensity = fog?.density ?? 0;
  }

  update(ctx: FrameContext): void {
    if (!this.fog) return;
    const submerged = ctx.camera.position.y < WORLD.seaLevel;

    if (!submerged) {
      if (this.blend !== 0) {
        // Surfaced: restore exactly. Density snaps back to the constructed
        // base; the colour was already rewritten by the day cycle this frame.
        this.blend = 0;
        this.fog.density = this.baseDensity;
      }
      return;
    }

    this.blend = Math.min(1, this.blend + BLEND_IN_PER_SEC * ctx.dt);
    // The day cycle wrote its palette colour just before us, so this lerp is
    // a per-frame crossfade day-fog → teal, never a compounding drift.
    this.fog.color.lerp(this.teal, this.blend);
    this.fog.density =
      this.baseDensity + (UNDERWATER_FOG_DENSITY - this.baseDensity) * this.blend;
  }

  // No describe(): the blend churns during transitions, and "underwater" is
  // already visible via the explorer's submerged flag in the survival state.
}
