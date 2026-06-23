// Water swell clock (G1 slice 3, T6) — the live half of the two-anchor vertex
// patch. The shader's swell is a pure function of `position` and a single
// `uTime` uniform; this System is the ONLY thing that advances that uniform, so
// the surface ripples without any per-frame geometry or texture work.
//
// It owns the `{value}` object BY REFERENCE — the SAME object `buildBoundaries`
// merged into the material in `onBeforeCompile` (exposed as
// `boundaries.waterUniforms`). Mutating `.value` in place updates the running
// program with no scene traversal and no post-compile staleness; the object
// identity is never swapped, so the live shader keeps reading one stable handle.
//
// Reduced motion (#49) freezes the swell by HOLDING the current phase, not by
// resetting to 0 (a reset is itself a one-frame jump-cut — motion for exactly
// the users who asked for none). The clock is a SYSTEM-OWNED accumulator
// advanced only when motion is allowed — deliberately NOT `ctx.elapsed`, which
// keeps ticking during the freeze and would jump the surface on resume. Because
// the accumulator only moves when motion is allowed, freeze holds and resume is
// seamless.

import * as THREE from "three";
import type { System, FrameContext } from "../engine/types.ts";
import type { ReducedMotionSource } from "./buildWorld.ts";
import type { WaterUniforms } from "./boundaries.ts";
import { WRAP_PERIOD } from "./waterSurface.ts";

/**
 * Advances the water's `uTime` uniform so the compiled two-sine vertex swell
 * animates. Constructed ONLY on medium/high (where `displacement` is on and the
 * boundaries handle exposes `waterUniforms`); never installed on low.
 *
 * Owns a single scalar accumulator advanced by `ctx.dt` each frame when motion
 * is allowed, wrapped modulo {@link WRAP_PERIOD} so the `sin()` argument stays
 * float32-safe over a long-lived tab — the period is the shared continuous
 * period of both sines, so the wrap is seamless (no visible jump). Zero
 * per-frame allocation: one scalar add and one in-place write into a
 * pre-existing uniform.
 */
export class WaterSystem implements System {
  readonly id = "water";

  /** System-owned clock. NOT `ctx.elapsed` — that advances during the freeze
   *  and would snap the surface forward on resume; this only moves when motion
   *  is allowed, so a held phase resumes exactly where it paused. */
  private t = 0;

  constructor(
    private readonly uniforms: WaterUniforms,
    private readonly reducedMotion?: ReducedMotionSource,
  ) {}

  update(ctx: FrameContext): void {
    // Read the gate LIVE every frame (mirrors BeaconPulseSystem) so the
    // pause-menu toggle takes effect at once — no rebuild.
    const still = this.reducedMotion?.getSnapshot().reducedMotion ?? false;
    if (still) return; // HOLD the current phase — don't advance, don't reset.

    // Advance and wrap. `THREE.MathUtils.euclideanModulo` keeps the result in
    // [0, WRAP_PERIOD) for any input, where both sine phases close on an exact
    // cycle, so the wrap is continuous. One scalar add, one in-place write.
    this.t = THREE.MathUtils.euclideanModulo(this.t + ctx.dt, WRAP_PERIOD);
    this.uniforms.uTime.value = this.t;
  }

  // No describe() — the swell phase churns every frame, so contributing it would
  // make the render_game_to_text snapshot non-deterministic. The visible state
  // (that the water animates) is implied by this System's presence on med/high.

  dispose(): void {
    // The uniform / material / geometry are owned and released by
    // `boundaries.dispose()`; this System only held a reference, so there is
    // nothing to free here beyond dropping that reference with the instance.
  }
}
