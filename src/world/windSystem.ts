// Wind sway clock (visual-overhaul slice 6) — the live half of the
// `windPatch.ts` vertex patch, mirroring `waterSystem.ts` exactly: a single
// scalar accumulator, advanced by `dt` only when motion is allowed, wrapped
// modulo `WIND_WRAP_PERIOD` so the `sin()` argument stays float32-safe over a
// long-lived tab, written into ONE shared `{value}` uniform object every
// wind-patched material binds by reference.
//
// Reduced motion (#49) HOLDS the current phase rather than resetting to 0 —
// the same "a reset is itself a one-frame jump-cut" reasoning `WaterSystem`
// documents.

import * as THREE from "three";
import type { System, FrameContext } from "../engine/types.ts";
import type { ReducedMotionSource } from "./buildWorld.ts";
import { WIND_WRAP_PERIOD } from "./windSway.ts";

/** The uniform bag every wind-patched material shares — one `{value}` object,
 *  identity-stable, mutated in place each frame. */
export interface WindUniforms {
  uTime: { value: number };
}

export class WindSystem implements System {
  readonly id = "wind";

  private t = 0;
  /** Gust factor 0..1 (W1 #226): the sway clock runs up to 2.2x during a
   *  gust — frequency agitation, zero shader changes. */
  private gust = 0;

  constructor(
    private readonly uniforms: WindUniforms,
    private readonly reducedMotion?: ReducedMotionSource,
  ) {}

  update(ctx: FrameContext): void {
    const still = this.reducedMotion?.getSnapshot().reducedMotion ?? false;
    if (still) return; // HOLD the current phase — don't advance, don't reset.

    this.t = THREE.MathUtils.euclideanModulo(
      this.t + ctx.dt * (1 + 1.2 * this.gust),
      WIND_WRAP_PERIOD,
    );
    this.uniforms.uTime.value = this.t;
  }

  /** Storm agitation 0..1 — `WeatherSystem` drives this each frame. */
  setGust(gust01: number): void {
    this.gust = Math.min(1, Math.max(0, gust01));
  }

  // No describe() — the sway phase churns every frame (see `WaterSystem`'s own
  // note on why that would make the render_game_to_text snapshot
  // non-deterministic).

  dispose(): void {
    // The uniform object / materials / geometries are owned and released by
    // whatever built them (`floraUpgrade.ts`/`grass.ts`); this System only
    // holds a reference, so nothing to free here beyond dropping it.
  }
}
