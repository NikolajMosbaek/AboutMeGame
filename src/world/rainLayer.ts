// Rain streak layer (W1 slice 3, #227) — ONE camera-following `Points` cloud
// whose fall is advanced on the CPU (a fixed array walk, no allocation) and
// whose opacity rides the live weather envelope. Gated by the `rainDetail`
// tier knob (low ships "none": dimming + audio still deliver weather there —
// the low-tier floor is "never slower than today") and suppressed entirely
// under reduced motion. Zero asset bytes; +1 draw call on the tiers that run
// it.

import * as THREE from "three";
import type { FrameContext, System } from "../engine/types.ts";
import { hash2 } from "../wildlife/geometry.ts";

export const RAIN_POINTS = 700;
/** The streak cylinder around the camera (world units). */
export const RAIN_RADIUS = 18;
export const RAIN_HEIGHT = 16;
/** Fall speed range (m/s), hashed per point so sheets don't read as one grid. */
const FALL_MIN = 9;
const FALL_MAX = 13;
/** Full-intensity opacity — streaks read without whiting the scene out. */
const RAIN_MAX_OPACITY = 0.5;

/** The live weather read — `World.weather` satisfies it. */
export interface RainWeatherSource {
  snapshot(): { rain01: number };
}

export interface ReducedMotionSource {
  getSnapshot(): { reducedMotion: boolean };
}

/** Deterministic per-point fall speed (m/s). */
export function fallSpeed(index: number): number {
  return FALL_MIN + hash2(index * 3.3, 7.7) * (FALL_MAX - FALL_MIN);
}

/** Wrap a fallen y back into the cylinder: drops re-enter at the top. */
export function wrapY(y: number): number {
  return y < 0 ? y + RAIN_HEIGHT : y;
}

export class RainSystem implements System {
  readonly id = "rain";

  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.PointsMaterial;
  readonly points: THREE.Points;
  private readonly positions: Float32Array;

  constructor(
    scene: THREE.Scene,
    private readonly weather: RainWeatherSource,
    private readonly reducedMotion?: ReducedMotionSource,
  ) {
    this.positions = new Float32Array(RAIN_POINTS * 3);
    for (let i = 0; i < RAIN_POINTS; i++) {
      const a = hash2(i * 1.7, 3.1) * Math.PI * 2;
      const r = Math.sqrt(hash2(i * 2.9, 5.3)) * RAIN_RADIUS; // area-uniform
      this.positions[i * 3] = Math.cos(a) * r;
      this.positions[i * 3 + 1] = hash2(i * 4.1, 9.7) * RAIN_HEIGHT;
      this.positions[i * 3 + 2] = Math.sin(a) * r;
    }
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.PointsMaterial({
      color: 0xb8c8d4, // pale rain-grey
      size: 0.07,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = "rain-layer";
    this.points.visible = false;
    // The cloud follows the camera — its local bounds never match its
    // world-relevant position, so culling is meaningless here.
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(ctx: FrameContext): void {
    const rain01 = this.weather.snapshot().rain01;
    const still = this.reducedMotion?.getSnapshot().reducedMotion ?? false;
    const active = rain01 > 0 && !still;
    this.points.visible = active;
    if (!active) return;

    this.material.opacity = rain01 * RAIN_MAX_OPACITY;

    // Follow the camera on x/z; the cylinder floor rides ~2 m below the eye
    // so streaks surround the player, not just hang overhead.
    const cam = ctx.camera.position;
    this.points.position.set(cam.x, cam.y - 2, cam.z);

    // Advance the fall on the CPU: fixed-array walk, zero allocation.
    for (let i = 0; i < RAIN_POINTS; i++) {
      const yi = i * 3 + 1;
      this.positions[yi] = wrapY(this.positions[yi] - fallSpeed(i) * ctx.dt);
    }
    this.geometry.getAttribute("position").needsUpdate = true;
  }

  describe(): Record<string, unknown> {
    return { raining: this.points.visible };
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
