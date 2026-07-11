// Discovery burst geometry (#53) — the pure, renderer-agnostic core of the
// reveal particle pop, split out so its allocation, layout and lifecycle are
// unit-testable without WebGL. `DiscoveryBurstSystem` owns the scene wiring and
// the store subscription; this owns the single pooled `THREE.Points` cloud and
// the per-particle animation maths.
//
// One fixed-size pool of points is reused for every burst (a single draw call,
// regardless of how many landmarks are found), so the effect costs nothing while
// idle and never allocates mid-game — it stays well inside the perf budget.

import * as THREE from "three";
import { POINT_SPRITE_ALPHA_TEST, makeSoftCircleSprite } from "./pointSprite.ts";

/** Particles in the pool. One draw call total; small enough to stay cheap. */
export const BURST_PARTICLES = 40;
/** Seconds a burst lives before it fades out and the pool goes idle. */
export const BURST_DURATION = 0.9;

/**
 * A reusable particle cloud for the discovery pop. `trigger(at, color)` seeds the
 * particles around a world point with outward velocities and starts the clock;
 * `update(dt)` advances them and fades the cloud, parking it (invisible) when the
 * burst ends. Geometry + material are owned here and freed by `dispose`.
 */
export class DiscoveryBurst {
  readonly points: THREE.Points;

  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;
  /** Soft-round sprite (`pointSprite.ts`) — without it this fountain
   *  rasterizes as literal hard squares. */
  private readonly sprite: THREE.CanvasTexture | null;
  private age = BURST_DURATION; // start "finished" ⇒ idle/invisible

  constructor() {
    this.positions = new Float32Array(BURST_PARTICLES * 3);
    this.velocities = new Float32Array(BURST_PARTICLES * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.sprite = makeSoftCircleSprite();
    this.material = new THREE.PointsMaterial({
      size: 1.6,
      map: this.sprite,
      alphaTest: POINT_SPRITE_ALPHA_TEST,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = "discovery-burst";
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  /** True while a burst is animating (so the system can skip idle work). */
  get active(): boolean {
    return this.age < BURST_DURATION;
  }

  /** Seed the cloud at `at` in the landmark's signature `color` and play it. */
  trigger(at: THREE.Vector3, color: number): void {
    this.material.color.setHex(color);
    for (let i = 0; i < BURST_PARTICLES; i++) {
      const o = i * 3;
      this.positions[o] = at.x;
      this.positions[o + 1] = at.y;
      this.positions[o + 2] = at.z;
      // Random outward velocity, biased upward so the pop reads as a fountain.
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.5; // upper hemisphere
      const speed = 6 + Math.random() * 10;
      this.velocities[o] = Math.cos(theta) * Math.sin(phi) * speed;
      this.velocities[o + 1] = Math.cos(phi) * speed + 4;
      this.velocities[o + 2] = Math.sin(theta) * Math.sin(phi) * speed;
    }
    this.age = 0;
    this.points.visible = true;
    (this.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Advance the active burst; parks the cloud when it finishes. No-op if idle. */
  update(dt: number): void {
    if (!this.active) return;
    this.age += dt;
    if (this.age >= BURST_DURATION) {
      this.material.opacity = 0;
      this.points.visible = false;
      return;
    }
    const t = this.age / BURST_DURATION;
    // Ease out: a quick fade with gentle gravity so the fountain settles.
    this.material.opacity = (1 - t) * 0.9;
    for (let i = 0; i < BURST_PARTICLES; i++) {
      const o = i * 3;
      this.velocities[o + 1] -= 14 * dt; // gravity
      this.positions[o] += this.velocities[o] * dt;
      this.positions[o + 1] += this.velocities[o + 1] * dt;
      this.positions[o + 2] += this.velocities[o + 2] * dt;
    }
    (this.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.sprite?.dispose();
  }
}
