// Living-sky day cycle (G3 slice) — the per-frame WRITER that connects the pure,
// already-tested `dayPalette(t)` look math to the live sky handles built by
// `sky.ts` (`sky.sun` / `sky.dome` / `sky.fog`). It is the SINGLE production
// importer of `./dayCycle`, so the chain `buildWorld → dayCycleSystem →
// dayCycle` is what pulls the palette into the shipped bundle and defeats
// tree-shaking (the flipped guard at dayCycle.test.ts locks that).
//
// This System is clock + writes, nothing else. ALL look math stays in the pure
// `dayPalette`; this file adds NO interpolation, NO clamps and NO colour
// authoring. It mirrors `WaterSystem`'s mechanism (a system-owned scalar
// accumulator advanced ONLY when motion is allowed, gate read live each frame,
// never reset) so a held cycle resumes seamlessly — but UNLIKE WaterSystem it
// must still WRITE while held (the GOLDEN_T pin), so a fresh reduced-motion load
// shows golden hour and toggling the setting snaps to the flattering still at
// once instead of holding the construction-time noon.
//
// Zero new geometry / draw calls / triangles / asset bytes: it only mutates the
// existing sun light, dome shader uniforms and fog colour IN PLACE. Each colour
// is written through the destination holder's own `setRGB(...srgbTuple,
// SRGBColorSpace)` — no temporary `Color` is allocated per frame, the holder
// objects are never swapped, `dome.uniforms` is never reassigned, and
// `dome.dispose()` is never called (the Sky owns the material).

import * as THREE from "three";
import type { FrameContext, System } from "../engine/types.ts";
import type { ReducedMotionSource } from "./buildWorld.ts";
import { dayPalette, GOLDEN_T } from "./dayCycle.ts";
import { WORLD } from "./worldConfig.ts";

/**
 * Real-time seconds for one full dawn→noon→dusk→evening→dawn loop. A slow,
 * ambient cycle — long enough that the change is felt, not watched. Named here
 * so the art tune is a one-line edit; the headless test reads it (never a
 * hand-typed literal) when asserting loop fractions.
 */
export const PERIOD_SECONDS = 180;

/**
 * The magnitude the unit sun direction is scaled to before being written to
 * `sun.position`. `sky.ts` ships `new Vector3(0.6,1,0.4).multiplyScalar(
 * islandRadius)`, and `(0.6,1,0.4)` has length ≈ 1.2329, so the shipped sun sits
 * at |pos| ≈ 246.58 = (120,200,80) — NOT at `islandRadius` (200). Reconstructing
 * a UNIT direction from (elevation,azimuth) and scaling by `islandRadius` would
 * land it 19 % short, shifting the orthographic shadow camera (which sits AT
 * `sun.position` with a fixed near/far) and introducing noon near-plane clipping
 * that does not exist on `main` — breaking the "NOON look unchanged" guarantee.
 * Scaling by this length reproduces (120,200,80) bit-exact at the noon keyframe.
 */
export const SUN_DISTANCE = WORLD.islandRadius * Math.hypot(0.6, 1, 0.4);

/**
 * Drives the living sky: each frame it samples `dayPalette` at the current loop
 * fraction and writes the result in place into the sun (colour, intensity,
 * direction), the dome gradient (top/bottom uniform colours) and the fog colour.
 *
 * Registered UNCONDITIONALLY in `buildWorld` (like `BeaconPulseSystem`): the sun
 * and dome exist on every tier, and the fog handle is `null`-guarded for the low
 * tier (where fog is disabled). Injected the three live handles individually —
 * never the whole `World`/`Sky` — so the unit test stays headless with plain
 * value-holder fakes and this System never traverses the scene graph.
 */
export class DayCycleSystem implements System {
  readonly id = "dayCycle";

  /** System-owned clock. NOT `ctx.elapsed` — that keeps ticking during a freeze
   *  and would jump-cut the sky on resume; this only advances when motion is
   *  allowed, so a held cycle resumes exactly where it paused. */
  private t = 0;

  constructor(
    private readonly sun: THREE.DirectionalLight,
    private readonly dome: THREE.ShaderMaterial,
    private readonly fog: THREE.FogExp2 | null,
    private readonly reducedMotion?: ReducedMotionSource,
  ) {}

  update(ctx: FrameContext): void {
    // Read the gate LIVE every frame (mirrors WaterSystem/BeaconPulseSystem) so
    // the pause-menu toggle takes effect at once — no rebuild.
    const still = this.reducedMotion?.getSnapshot().reducedMotion ?? false;

    // When still: PIN to golden hour and HOLD the accumulator (no advance, no
    // reset). We still WRITE — unlike WaterSystem's early-return — so a fresh
    // reduced-motion load shows the flattering golden dusk, not noon, and a live
    // flip snaps to the pin on the very next frame. When moving: advance and
    // euclidean-wrap into [0, PERIOD_SECONDS); dayPalette wraps the fraction the
    // same way and its closing keyframe rejoins dawn, so the seam is jump-free.
    if (!still) {
      this.t = THREE.MathUtils.euclideanModulo(this.t + ctx.dt, PERIOD_SECONDS);
    }

    const p = dayPalette(still ? GOLDEN_T : this.t / PERIOD_SECONDS);

    // --- Sun: colour, intensity, direction (all in place) --------------------
    this.sun.color.setRGB(...p.sunColor, THREE.SRGBColorSpace);
    this.sun.intensity = p.sunIntensity;
    // Unit direction from (elevation, azimuth) — azimuth clockwise from +Z toward
    // +X (matching dayPalette's convention) — scaled to SUN_DISTANCE so the noon
    // keyframe reproduces sky.ts's (120,200,80) bit-exact.
    const ce = Math.cos(p.sunElevation);
    this.sun.position.set(
      ce * Math.sin(p.sunAzimuth) * SUN_DISTANCE,
      Math.sin(p.sunElevation) * SUN_DISTANCE,
      ce * Math.cos(p.sunAzimuth) * SUN_DISTANCE,
    );

    // --- Dome gradient: top + bottom uniform colours (mutated by reference) --
    this.dome.uniforms.topColor.value.setRGB(...p.domeTop, THREE.SRGBColorSpace);
    this.dome.uniforms.bottomColor.value.setRGB(...p.domeBottom, THREE.SRGBColorSpace);

    // --- Fog: live handle only; null on the low tier (fog disabled) ----------
    this.fog?.color.setRGB(...p.fogColor, THREE.SRGBColorSpace);
  }

  // No describe() — the loop fraction churns every frame, so contributing it
  // would make the render_game_to_text snapshot non-deterministic (mirroring
  // WaterSystem / BeaconPulseSystem). The visible state (that the sky cycles) is
  // implied by this System's presence.
}
