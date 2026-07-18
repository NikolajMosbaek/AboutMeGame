// Drifting clouds (visual-overhaul slice 5, item 3 — medium/high only). A
// handful of soft, camera-facing billboard "puffs" high above the island,
// baked from a small procedural canvas texture (the `props.ts` `makeLeafTexture`
// idiom — no downloaded asset), drifting slowly with wrap-around and tinted by
// the day-cycle palette (bright at noon, warming toward ember as the sun gets
// low). ONE `InstancedMesh` draw call regardless of count.
//
// Placement/drift/wrap/tint math is pure and headless-testable here; the GPU
// wiring (`CloudSystem`) below just billboards + repositions the (small)
// instance count each frame — mirrors `aquatic.ts`/`wildlife/fliers.ts`'s
// "pure math + thin System, one file" shape.

import * as THREE from "three";
import type { FrameContext, System } from "../engine/types.ts";
import type { ReducedMotionSource } from "./buildWorld.ts";
import { lowSunFactor } from "./skyAtmosphere.ts";
import { WORLD } from "./worldConfig.ts";

export const CLOUD_COUNT = 7; // within the design's 5-9 range
/** World-Y the cloud layer sits at — well above props/landmarks, comfortably
 *  below the sky dome's radius (`WORLD.size * 1.2`). */
export const CLOUD_HEIGHT = 130;
/** Half-extent of the square domain clouds drift across and wrap within —
 *  generous enough that a cloud is visible from anywhere on the island. */
export const CLOUD_DOMAIN_HALF_EXTENT = WORLD.size * 0.65;
export const CLOUD_DRIFT_SPEED_MIN = 1.1;
export const CLOUD_DRIFT_SPEED_MAX = 2.4;
export const CLOUD_SCALE_MIN = 46;
export const CLOUD_SCALE_MAX = 88;

/** One cloud's fixed placement — everything EXCEPT the drifted X position,
 *  which {@link cloudDriftPosition} recomputes every frame from `elapsed`. */
export interface CloudPlacement {
  /** Base X before drift (the phase offset so clouds don't move in lockstep). */
  baseX: number;
  z: number;
  scale: number;
  driftSpeed: number;
}

function hash(i: number, seed: number): number {
  let h = Math.imul(i | 0, 374761393) + Math.imul(seed | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/**
 * Deterministically place `count` clouds across the drift domain — a fixed
 * default seed so the sky is byte-identical every load. `z` is spread across
 * the full domain too (not just `x`) so clouds read as scattered, not a
 * single marching row.
 */
export function makeCloudPlacements(count: number = CLOUD_COUNT, seed = 0xc10cd): CloudPlacement[] {
  const clouds: CloudPlacement[] = [];
  const span = CLOUD_DOMAIN_HALF_EXTENT * 2;
  for (let i = 0; i < count; i++) {
    clouds.push({
      baseX: hash(i, seed) * span - CLOUD_DOMAIN_HALF_EXTENT,
      z: hash(i, seed + 1) * span - CLOUD_DOMAIN_HALF_EXTENT,
      scale: CLOUD_SCALE_MIN + hash(i, seed + 2) * (CLOUD_SCALE_MAX - CLOUD_SCALE_MIN),
      driftSpeed: CLOUD_DRIFT_SPEED_MIN + hash(i, seed + 3) * (CLOUD_DRIFT_SPEED_MAX - CLOUD_DRIFT_SPEED_MIN),
    });
  }
  return clouds;
}

/** Euclidean wrap of `value` into `[-halfExtent, halfExtent)` — a signed
 *  modulo so drift crossing either edge reappears cleanly on the other. */
function wrapSigned(value: number, halfExtent: number): number {
  const span = halfExtent * 2;
  const shifted = value + halfExtent;
  const wrapped = shifted - Math.floor(shifted / span) * span;
  return wrapped - halfExtent;
}

/**
 * The cloud's drifted X position after `elapsedSeconds` of allowed motion —
 * wraps within `[-halfExtent, halfExtent)` so a cloud that drifts off one edge
 * of the domain reappears at the other, never popping or reversing.
 */
export function cloudDriftPosition(
  baseX: number,
  driftSpeed: number,
  elapsedSeconds: number,
  halfExtent: number = CLOUD_DOMAIN_HALF_EXTENT,
): number {
  return wrapSigned(baseX + driftSpeed * elapsedSeconds, halfExtent);
}

/** A plain sRGB-0..1 RGB tuple — matches `dayCycle.ts`'s `DayPalette` colour
 *  shape without importing it (this module stays a duck-typed consumer of
 *  the day-cycle seams, like `envBakeScheduler.ts`). */
export interface CloudTint {
  r: number;
  g: number;
  b: number;
}

/** Bright, near-white day tint — the puffs' colour at a high, noon-strength sun. */
const CLOUD_BRIGHT: CloudTint = { r: 0.95, g: 0.94, b: 0.9 };
/** How much darker the puffs read at this world's lowest-sun keyframes (there
 *  is no true night — `dayCycle.ts`'s no-night floor — so this reads as a
 *  dim, silhouette-leaning tint at dawn/dusk, never a black cutout). */
const CLOUD_MAX_DARKEN = 0.5;

/**
 * Cloud tint for sun-direction Y `sunDirY` (`= sin(elevation)`) and the
 * current sun colour: bright near-white at a high sun, blending toward the
 * warm `sunColor` (ember) and darkening slightly as the sun gets low — using
 * the SAME {@link lowSunFactor} the sky dome's own limb-glow warmth reads
 * from, so the clouds agree with the dome rather than inventing a second
 * "how low is the sun" curve.
 */
export function cloudTint(
  sunDirY: number,
  sunColor: readonly [number, number, number],
): CloudTint {
  const low = lowSunFactor(sunDirY);
  const warm: CloudTint = {
    r: CLOUD_BRIGHT.r + (sunColor[0] - CLOUD_BRIGHT.r) * low,
    g: CLOUD_BRIGHT.g + (sunColor[1] - CLOUD_BRIGHT.g) * low,
    b: CLOUD_BRIGHT.b + (sunColor[2] - CLOUD_BRIGHT.b) * low,
  };
  const darken = 1 - CLOUD_MAX_DARKEN * low * low * low;
  return { r: warm.r * darken, g: warm.g * darken, b: warm.b * darken };
}

/** Bake a small soft-puff canvas texture — 2-3 overlapping radial-gradient
 *  blobs (the `props.ts` `makeLeafTexture` idiom: procedural, seeded, no
 *  downloaded asset). Returns `null` under environments with no real 2D
 *  canvas context (jsdom in tests) — callers degrade to a flat tinted quad,
 *  same fallback shape as `props.ts`'s foliage materials. */
export function makeCloudPuffTexture(seed = 91): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, size, size);

  const blobs = [
    { cx: 0.4, cy: 0.55, r: 0.34 },
    { cx: 0.62, cy: 0.45, r: 0.3 },
    { cx: 0.5, cy: 0.62, r: 0.28 },
  ];
  for (let i = 0; i < blobs.length; i++) {
    const b = blobs[i];
    const jitter = (hash(i, seed) - 0.5) * 0.08;
    const cx = (b.cx + jitter) * size;
    const cy = (b.cy + jitter) * size;
    const r = b.r * size;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    gradient.addColorStop(0, "rgba(255,255,255,0.9)");
    gradient.addColorStop(0.6, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** The day-cycle accessor this System reads — `DayCycleSystem` satisfies it
 *  (`World.dayCycle` plus `getSunDirection`, all already-exposed seams). */
export interface CloudPaletteSource {
  getSunDirection(): THREE.Vector3;
  getPalette(): { sunColor: readonly [number, number, number] };
}

/**
 * The cloud layer: ONE `InstancedMesh` draw call for `CLOUD_COUNT` soft
 * billboard quads. Each frame recomputes the (small, ~7-instance) drift
 * position and re-orients every quad to face the camera by copying its
 * quaternion directly (a full-billboard sprite, cheap at this instance
 * count — no per-instance trig needed beyond the drift wrap). Reduced
 * motion holds drift still (no accumulator advance); the tint still tracks
 * the live palette either way, matching `StarfieldSystem`'s split.
 */
export class CloudSystem implements System {
  readonly id = "clouds";

  private readonly mesh: THREE.InstancedMesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly texture: THREE.CanvasTexture | null;
  private readonly placements: CloudPlacement[];
  private elapsed = 0;

  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();
  private readonly tint = new THREE.Color();
  private weatherDark = 0;

  constructor(
    scene: THREE.Scene,
    private readonly dayCycle: CloudPaletteSource,
    private readonly reducedMotion?: ReducedMotionSource,
  ) {
    this.placements = makeCloudPlacements();
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.texture = makeCloudPuffTexture();
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      color: this.texture ? 0xffffff : 0xdadad2,
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.placements.length);
    this.mesh.name = "clouds";
    this.mesh.frustumCulled = false; // scattered across a huge domain; cheap at 7 instances
    scene.add(this.mesh);

    // No real camera exists yet at construction — an identity-facing pose is
    // fine for the instant before the first `update` (which always runs
    // before the first real render), so this is never visibly wrong.
    this.reposition(0, IDENTITY_QUATERNION);
  }

  update(ctx: FrameContext): void {
    const still = this.reducedMotion?.getSnapshot().reducedMotion ?? false;
    if (!still) this.elapsed += ctx.dt;
    this.reposition(this.elapsed, ctx.camera.quaternion);

    const sunDirY = this.dayCycle.getSunDirection().y;
    const { sunColor } = this.dayCycle.getPalette();
    const t = cloudTint(sunDirY, sunColor);
    // Weather darkening (W1 #226): a shower drags the whole layer toward
    // storm-grey — applied on top of the day tint, so dawn/dusk warmth still
    // reads through a light shower.
    const dark = 1 - 0.55 * this.weatherDark;
    this.tint.setRGB(t.r * dark, t.g * dark, t.b * dark);
    for (let i = 0; i < this.placements.length; i++) this.mesh.setColorAt(i, this.tint);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Storm darkening 0..1 — `WeatherSystem` drives this each frame. Darkening
   *  only: the material's base opacity is already 1 (translucency lives in
   *  the puff texture's alpha), so there is no opacity headroom to raise. */
  setWeatherDark(dark01: number): void {
    this.weatherDark = Math.min(1, Math.max(0, dark01));
  }

  /** Rebuild every instance matrix: drifted position (wrapping) + a full
   *  camera-facing billboard rotation (`quaternion` copied straight onto each
   *  quad — cheap and exact at this ~7-instance count), sized to the cloud's
   *  own scale. */
  private reposition(elapsed: number, quaternion: THREE.Quaternion): void {
    for (let i = 0; i < this.placements.length; i++) {
      const c = this.placements[i];
      const x = cloudDriftPosition(c.baseX, c.driftSpeed, elapsed);
      this.pos.set(x, CLOUD_HEIGHT, c.z);
      this.sc.set(c.scale, c.scale * 0.6, 1);
      this.m.compose(this.pos, quaternion, this.sc);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.texture?.dispose();
  }
}

const IDENTITY_QUATERNION = new THREE.Quaternion();
