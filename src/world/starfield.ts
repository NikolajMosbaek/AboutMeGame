// Starfield (visual-overhaul slice 5, item 2) — a seeded field of ~1200 points
// on the celestial sphere, fading in as the sun gets low (this day cycle's
// dawn/dusk/evening arcs — see `dayCycle.ts`'s documented no-night floor, so
// this reads as twilight stars rather than a literal midnight sky) and
// wheeling slowly around a fixed celestial pole. ONE draw call (`THREE.Points`),
// on every quality tier — it's cheap enough not to need gating.
//
// Pure placement/opacity/rotation math lives here (headless-testable, no
// three/DOM); the GPU wiring (`StarfieldSystem`) below just uploads it once
// and mutates two uniforms + a group rotation per frame — mirrors
// `aquatic.ts`/`wildlife/fliers.ts`'s "pure math + thin System, one file" shape.

import * as THREE from "three";
import type { FrameContext, System } from "../engine/types.ts";
import type { ReducedMotionSource } from "./buildWorld.ts";
import { WORLD } from "./worldConfig.ts";

export const STAR_COUNT = 1200;

/** One star's placement + per-star shader inputs, baked once at build time. */
export interface Star {
  /** Unit-sphere direction (world-space, before the field's pole rotation). */
  x: number;
  y: number;
  z: number;
  /** Base point size in pixels (before the renderer's own perspective scale). */
  size: number;
  /** Per-star twinkle phase (radians) so the field doesn't blink in lockstep. */
  phase: number;
}

/** Small deterministic seeded hash — mirrors the integer-mix idiom already
 *  used by `noise.ts`'s `makeNoise2D`, inlined here so this module stays a
 *  single small file with no shared RNG dependency. */
function hash(i: number, seed: number): number {
  let h = Math.imul(i | 0, 374761393) + Math.imul(seed | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/**
 * Deterministically place `count` stars on the unit sphere — a fixed default
 * seed so the field is byte-identical every load (mirrors `WORLD.seed`'s
 * discipline). Uses the standard uniform-sphere sampling trick (inverse
 * transform on `z`, uniform azimuth) so stars don't clump at the poles.
 */
export function makeStarField(count: number = STAR_COUNT, seed = 0x51a12): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    const z = hash(i, seed) * 2 - 1; // uniform in [-1, 1]
    const theta = hash(i, seed + 1) * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    stars.push({
      x: r * Math.cos(theta),
      y: z,
      z: r * Math.sin(theta),
      size: 1.2 + hash(i, seed + 2) * 2.2,
      phase: hash(i, seed + 3) * Math.PI * 2,
    });
  }
  return stars;
}

/** Sun elevation (radians) at/below which the field is FULLY visible — this
 *  day cycle's own dawn keyframe (`dayCycle.ts`'s `KEYFRAMES[0].sunElevation`
 *  = 0.12) never actually dips lower, so this is "as dim as this world gets". */
export const STAR_ELEVATION_FULL = 0.12;
/** Sun elevation (radians) at/above which the field is fully hidden. */
export const STAR_ELEVATION_HIDDEN = 0.22;

function clamp01(v: number): number {
  return v > 1 ? 1 : v > 0 ? v : 0;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * Star-field opacity for sun elevation `sunElevation` (radians) — 1 at/below
 * {@link STAR_ELEVATION_FULL}, 0 at/above {@link STAR_ELEVATION_HIDDEN}. This
 * day cycle never goes darker than its dawn keyframe (elevation stays
 * `>= 0.12`, `dayCycle.ts`'s documented no-night floor), so the field never
 * reaches a literal black-sky "night" — it fades in over the dawn/dusk/evening
 * arcs and disappears near noon, like twilight stars rather than midnight ones.
 */
export function starOpacity(sunElevation: number): number {
  return 1 - smoothstep(STAR_ELEVATION_FULL, STAR_ELEVATION_HIDDEN, sunElevation);
}

/** Radians/second the field wheels around the celestial pole — slow enough to
 *  read as "the sky turning", never a spin. */
export const STAR_ROTATION_RATE = 0.006;

/** The field's rotation angle (radians) after `elapsedSeconds` of allowed
 *  motion (reduced-motion holds the accumulator, so this is never evaluated
 *  past the freeze point — mirrors `AquaticSwaySystem`'s gate). */
export function starRotationAngle(elapsedSeconds: number): number {
  return elapsedSeconds * STAR_ROTATION_RATE;
}

const STAR_RADIUS = WORLD.size * 1.15; // just inside the sky dome (WORLD.size * 1.2)
/** radians/second inside the twinkle shader's own `sin()` — baked into the
 *  GLSL string below so there is one source of truth for the rate. */
const TWINKLE_RATE = 1.6;
const STAR_COLOR = 0xdfe8ff; // a cool starlight white-blue

const vertexShader = `
  attribute float aSize;
  attribute float aPhase;
  uniform float uTime;
  uniform float uOpacity;
  varying float vTwinkle;
  void main() {
    vTwinkle = uOpacity * (0.55 + 0.45 * sin(uTime * ${TWINKLE_RATE.toFixed(2)} + aPhase));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize;
  }
`;

const fragmentShader = `
  precision mediump float;
  uniform vec3 uColor;
  varying float vTwinkle;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float alpha = smoothstep(0.5, 0.0, d) * vTwinkle;
    if (alpha <= 0.003) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

/** The sun-direction accessor this System reads — `DayCycleSystem` satisfies
 *  it (`getSunDirection().y === sin(elevation)`, so no new trig/accessor is
 *  needed on that System). */
export interface SunDirectionSource {
  getSunDirection(): THREE.Vector3;
}

/**
 * The starfield: ONE `THREE.Points` draw call, built once from
 * {@link makeStarField} and driven by three cheap per-frame uniform/rotation
 * writes — no per-star CPU work after construction (the twinkle runs entirely
 * in the vertex shader from a per-star phase attribute + one shared `uTime`).
 * Registered unconditionally (every quality tier) — it is one draw call and
 * a handful of points, well inside the sky's own budget.
 */
export class StarfieldSystem implements System {
  readonly id = "starfield";

  private readonly group: THREE.Group;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly points: THREE.Points;
  private elapsed = 0;

  constructor(
    scene: THREE.Scene,
    private readonly sunSource: SunDirectionSource,
    private readonly reducedMotion?: ReducedMotionSource,
  ) {
    const stars = makeStarField();
    const positions = new Float32Array(stars.length * 3);
    const sizes = new Float32Array(stars.length);
    const phases = new Float32Array(stars.length);
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      positions[i * 3] = s.x * STAR_RADIUS;
      positions[i * 3 + 1] = s.y * STAR_RADIUS;
      positions[i * 3 + 2] = s.z * STAR_RADIUS;
      sizes[i] = s.size;
      phases[i] = s.phase;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    this.geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: 0 },
        uColor: { value: new THREE.Color(STAR_COLOR) },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = "starfield";
    // The celestial sphere is enormous and always notionally "in view" when
    // visible at all — per-frame frustum culling of its bounding sphere would
    // be pure overhead for a mesh that's either fully on or fully off.
    this.points.frustumCulled = false;

    this.group = new THREE.Group();
    this.group.name = "starfield-pole";
    this.group.add(this.points);
    scene.add(this.group);
  }

  update(ctx: FrameContext): void {
    const still = this.reducedMotion?.getSnapshot().reducedMotion ?? false;
    if (!still) {
      this.elapsed += ctx.dt;
      this.material.uniforms.uTime.value = this.elapsed;
      this.group.rotation.y = starRotationAngle(this.elapsed);
    }
    // Opacity tracks the sun LIVE every frame regardless of the motion gate —
    // under reduced motion the day cycle pins to GOLDEN_T, so this settles to
    // one constant value; under normal motion it fades in/out with the cycle.
    const sunY = THREE.MathUtils.clamp(this.sunSource.getSunDirection().y, -1, 1);
    this.material.uniforms.uOpacity.value = starOpacity(Math.asin(sunY));
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    this.geometry.dispose();
    this.material.dispose();
  }
}
