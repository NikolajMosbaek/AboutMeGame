// Treasure-finale burst (owner note 2026-07-10: "something amazing must
// happen") — the grand sibling of DiscoveryBurstSystem's particle idiom. While
// the quest store's `finaleActive` window runs (~4.5 s between the dig
// completing and the win panel's pause), a sustained spiral of golden motes
// rises from the dig point, and the idol's emissive is pulsed past the bloom
// threshold (rest → peak → settled afterglow) so the compositor blooms the win.
//
// One pooled `THREE.Points` cloud (a single draw call), allocated once and
// parked invisible outside the finale — zero idle cost, no mid-game
// allocation. Reduced motion (#49 posture) swaps the spiral for a static glow:
// the idol simply holds the peak emissive for the finale, no animated motes.
//
// Visual-overhaul slice 7 (polish) upgrade: more motes (200→320), a per-mote
// sparkle twinkle (a vertex-colour multiplier, phased via `windSway.ts`'s
// `windPhase` — the same deterministic per-instance hash `windPatch.ts`'s
// foliage sway already uses, reused here purely as a phase generator), and
// `getFinaleGlow()` — a 0→1→0 signal `createCompositor.ts` reads to sweep
// bloom/vignette (and, high tier, a god-rays surge) across the WHOLE screen in
// lockstep with the spiral, without either file needing a second clock.

import * as THREE from "three";
import type { System, FrameContext } from "../engine/types.ts";
import type { ReducedMotionSource } from "../world/buildWorld.ts";
import { windPhase } from "../world/windSway.ts";

/** Motes in the spiral. One draw call regardless. Bumped from 200 for the
 *  visual-overhaul slice 7 finale upgrade — "more motes" per the design, still
 *  free (`windSystem.ts`, and therefore `windSway.ts`'s `windPhase`, is
 *  already eagerly bundled by every tier via `buildWorld.ts`'s static
 *  import, so reusing it here costs zero extra bytes). */
export const MOTE_COUNT = 320;
/** Warm gold — additive, so overlapping motes read as sparks of light. */
export const MOTE_COLOR = 0xffd76a;
/** Spiral column: base radius, total height, climb + spin rates. */
export const SPIRAL_RADIUS = 2.6;
export const SPIRAL_HEIGHT = 9;
export const RISE_SPEED = 2.2; // units/s upward
export const SPIN_SPEED = 1.8; // rad/s around the column
/** Sparkle brightness range (visual-overhaul slice 7) — per-mote vertex-colour
 *  multiplier, bounded ≤1 so the twinkle only ever DIMS a mote relative to the
 *  calibrated bloom-triggering base colour, never brightens past it. */
const SPARKLE_MID = 0.775;
const SPARKLE_AMPLITUDE = 0.225;
/** rad/s the twinkle cycles — much faster than `windSway.ts`'s own
 *  `WIND_SPEED` (a slow foliage sway); only the deterministic per-index phase
 *  generator (`windPhase`, the same "hash11" trick `windPatch.ts`'s foliage
 *  sway uses) is reused here, not the sway rate itself. */
const SPARKLE_RATE = 6;
/** Idol emissive keyframes: buried rest → finale peak → settled afterglow. */
export const IDOL_EMISSIVE_REST = 1.1;
export const IDOL_EMISSIVE_PEAK = 2.5;
export const IDOL_EMISSIVE_AFTER = 1.4;
/** Fraction of the finale spent climbing to the peak; the rest eases down. */
export const PEAK_AT = 0.35;
/** Mote opacity fade-in/out windows at the finale's edges (seconds). */
const FADE_IN = 0.5;
const FADE_OUT = 0.8;
const MAX_OPACITY = 0.9;

/** The finale window — the quest store satisfies it. */
export interface FinaleSource {
  getSnapshot(): { finaleActive: boolean };
}

/** Pure glow curve over finale progress `p` ∈ [0,1]: rest → peak → afterglow. */
export function idolEmissiveAt(p: number): number {
  const t = Math.min(1, Math.max(0, p));
  if (t <= PEAK_AT) {
    return IDOL_EMISSIVE_REST + (IDOL_EMISSIVE_PEAK - IDOL_EMISSIVE_REST) * (t / PEAK_AT);
  }
  return (
    IDOL_EMISSIVE_PEAK + (IDOL_EMISSIVE_AFTER - IDOL_EMISSIVE_PEAK) * ((t - PEAK_AT) / (1 - PEAK_AT))
  );
}

export class TreasureBurstSystem implements System {
  readonly id = "fx-treasure-burst";

  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;
  private readonly points: THREE.Points;
  private readonly positions: Float32Array;
  /** Per-mote sparkle multiplier (visual-overhaul slice 7) — a vertex-colour
   *  attribute three's PointsMaterial multiplies against `material.color`
   *  (`vertexColors: true`), the same mechanism the terrain's splat macro
   *  tint rides for free. */
  private readonly colors: Float32Array;
  /** Each mote's fixed sparkle phase, hashed once at construction from its
   *  index via `windSway.ts`'s `windPhase` — deterministic, no per-frame cost. */
  private readonly sparklePhases: Float32Array;

  private wasActive = false;
  /** Latched at finale start, so the setting can't half-toggle mid-spectacle. */
  private reduced = false;
  private elapsed = 0;

  constructor(
    scene: THREE.Scene,
    private readonly quest: FinaleSource,
    /** World position of the dig point (spiral base). */
    private readonly at: { x: number; y: number; z: number },
    private readonly reducedMotion?: ReducedMotionSource,
    /** Drives the idol material's emissiveIntensity (buildTreasure's hook). */
    private readonly setIdolEmissive?: (intensity: number) => void,
    /** The finale's length — QuestSystem's TUNE.finaleSeconds, injected so the
     *  two clocks can never drift apart silently. */
    private readonly finaleSeconds: number = 4.5,
  ) {
    this.positions = new Float32Array(MOTE_COUNT * 3);
    this.colors = new Float32Array(MOTE_COUNT * 3).fill(1);
    this.sparklePhases = new Float32Array(MOTE_COUNT);
    for (let i = 0; i < MOTE_COUNT; i++) this.sparklePhases[i] = windPhase(i, 0);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.material = new THREE.PointsMaterial({
      color: MOTE_COLOR,
      size: 0.55,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      vertexColors: true,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = "treasure-burst";
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
  }

  update(ctx: FrameContext): void {
    const active = this.quest.getSnapshot().finaleActive;
    if (active && !this.wasActive) this.begin();
    else if (!active && this.wasActive) this.end();
    this.wasActive = active;

    if (active && !this.reduced) this.animate(ctx.dt);
  }

  private begin(): void {
    this.elapsed = 0;
    this.reduced = this.reducedMotion?.getSnapshot().reducedMotion ?? false;
    if (this.reduced) {
      // The gated form: no motion, one static glow for the whole finale.
      this.setIdolEmissive?.(IDOL_EMISSIVE_PEAK);
      return;
    }
    this.layout();
    this.points.visible = true;
  }

  private end(): void {
    this.points.visible = false;
    this.material.opacity = 0;
    this.setIdolEmissive?.(IDOL_EMISSIVE_AFTER);
  }

  private animate(dt: number): void {
    this.elapsed += dt;
    this.layout();

    // Fade in at the start, out toward the panel handover.
    const tail = Math.max(0, this.finaleSeconds - this.elapsed);
    this.material.opacity =
      MAX_OPACITY * Math.min(1, this.elapsed / FADE_IN, tail / FADE_OUT);

    this.setIdolEmissive?.(idolEmissiveAt(this.elapsed / this.finaleSeconds));
  }

  /** Position every mote on the rising spiral for the current clock, and
   *  twinkle its sparkle colour (visual-overhaul slice 7). Each mote owns a
   *  fixed angular seed, height offset and sparkle phase, so both are a
   *  smooth function of (index, elapsed) — no per-mote state, deterministic. */
  private layout(): void {
    for (let i = 0; i < MOTE_COUNT; i++) {
      const f = i / MOTE_COUNT;
      const h = (f * SPIRAL_HEIGHT + this.elapsed * RISE_SPEED) % SPIRAL_HEIGHT;
      const angle = f * Math.PI * 8 + this.elapsed * SPIN_SPEED;
      // Taper toward the top: a column of sparks, not a cylinder.
      const r = SPIRAL_RADIUS * (0.35 + 0.65 * (1 - h / SPIRAL_HEIGHT));
      const o = i * 3;
      this.positions[o] = this.at.x + Math.cos(angle) * r;
      this.positions[o + 1] = this.at.y + h;
      this.positions[o + 2] = this.at.z + Math.sin(angle) * r;

      const twinkle =
        SPARKLE_MID + SPARKLE_AMPLITUDE * Math.sin(this.elapsed * SPARKLE_RATE + this.sparklePhases[i]);
      this.colors[o] = this.colors[o + 1] = this.colors[o + 2] = twinkle;
    }
    (this.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }

  /** The whole-screen "golden sweep" signal (visual-overhaul slice 7) — 0
   *  outside the finale, ramping 0→1→0 across it via the SAME fade envelope
   *  the mote spiral's own opacity already tracks (in over `FADE_IN`, out
   *  over `FADE_OUT`), so `createCompositor.ts`'s bloom/vignette/god-rays
   *  sweep breathes in lockstep with the motes, with no separate clock kept
   *  in the engine layer. Reduced motion: stays 0 throughout (the
   *  `animate()`/`layout()` path that drives `opacity` never runs), so the
   *  screen sweep is suppressed along with every other finale animation. */
  getFinaleGlow(): number {
    return this.material.opacity / MAX_OPACITY;
  }

  describe(): Record<string, unknown> {
    return { active: this.wasActive, reducedMotion: this.reduced };
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
