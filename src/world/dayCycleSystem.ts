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
import { dayPalette, GOLDEN_T, type DayPalette } from "./dayCycle.ts";
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

  /** Scratch holder for the unit sun direction, reused every frame (never
   *  reallocated) and returned BY REFERENCE from {@link getSunDirection} — this
   *  System is the one and only owner of "which way is the sun", so a consumer
   *  (`ShadowFrustumSystem`) reads it here instead of ever re-deriving it from
   *  `sun.position - sun.target.position` (that difference stops meaning
   *  anything once something else — the shadow frustum's own recenter — moves
   *  `sun.target` off the origin this System still assumes). */
  private readonly sunDirection = new THREE.Vector3();

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
    // +X (matching dayPalette's convention). Written into the reused scratch
    // vector first (the authoritative unit direction `getSunDirection()` hands
    // out) then scaled to SUN_DISTANCE for `sun.position`, so the noon keyframe
    // reproduces sky.ts's (120,200,80) bit-exact. This absolute, origin-anchored
    // write is correct on the low tier (no `ShadowFrustumSystem` there) and
    // harmless on medium/high, where `ShadowFrustumSystem` runs AFTER this System
    // every frame and rewrites `sun.position`/`sun.target.position` consistently
    // from this same direction — see that System's own doc for why it never
    // re-derives direction from `sun.position - sun.target.position` itself.
    const ce = Math.cos(p.sunElevation);
    this.sunDirection.set(
      ce * Math.sin(p.sunAzimuth),
      Math.sin(p.sunElevation),
      ce * Math.cos(p.sunAzimuth),
    );
    this.sun.position.copy(this.sunDirection).multiplyScalar(SUN_DISTANCE);

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

  /**
   * The current loop fraction, `t ∈ [0,1)` (0 = dawn, 0.25 = noon, `GOLDEN_T` =
   * 0.5 = dusk, 0.75 = evening) — read by anything downstream of the sky that
   * needs day/night phase without importing `./dayCycle` itself (the wildlife
   * slice's butterfly/firefly crossfade; see `World.dayCycle`). Mirrors what is
   * actually PAINTED: pinned to `GOLDEN_T` under reduced motion, exactly like
   * the sky/dome/fog writes above, so a consumer never reads a phase the player
   * can't see.
   */
  getPhase(): number {
    if (this.reducedMotion?.getSnapshot().reducedMotion) return GOLDEN_T;
    return this.t / PERIOD_SECONDS;
  }

  /**
   * The palette this instance is CURRENTLY painting — exactly what `update()`
   * last wrote to the sun/dome/fog (pinned to `GOLDEN_T` under reduced
   * motion, same as {@link getPhase}). Recomputed from `getPhase()` on every
   * call rather than cached, so it can never drift from what's actually on
   * screen. Read by `EnvLightSystem` (visual-overhaul slice 2) to know what
   * to bake into the sky-driven IBL environment map, without that module
   * importing `./dayCycle` directly — keeping this file the ONE production
   * importer (the tree-shaking guard at `dayCycle.test.ts`).
   */
  getPalette(): DayPalette {
    return dayPalette(this.getPhase());
  }

  /**
   * The unit sun direction this instance last wrote into `sun.position` (before
   * the `SUN_DISTANCE` scale) — the SAME reused `THREE.Vector3` every call, never
   * a fresh allocation (mirrors the sun/dome/fog holders this System never
   * swaps). This is the ONE authoritative source of "which way is the sun" for
   * anything downstream that needs it as a direction rather than a palette —
   * today `ShadowFrustumSystem` (visual-overhaul slice 2), so it can re-center
   * the shadow frustum on the player WITHOUT ever reading `sun.position -
   * sun.target.position` (that difference is only valid while `sun.target`
   * sits at the origin this System assumes; once `ShadowFrustumSystem` parks
   * the target at the player, re-deriving direction from it would feed back a
   * skewed result forever after). Returned BY REFERENCE — callers must treat it
   * as read-only for the current frame, not retain and mutate it.
   */
  getSunDirection(): THREE.Vector3 {
    return this.sunDirection;
  }

  /**
   * The fixed golden-hour keyframe (`GOLDEN_T`), exposed as a static so a
   * caller that wants a ONE-TIME "golden hour" bake — the low-tier static
   * environment light, which never regenerates and so needs no live instance
   * — can reach it without importing `./dayCycle` itself.
   */
  static goldenPalette(): DayPalette {
    return dayPalette(GOLDEN_T);
  }
}
