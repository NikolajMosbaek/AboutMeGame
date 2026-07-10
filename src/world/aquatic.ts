// Aquatic life (#184): instanced kelp/eelgrass beds and lily pads in the
// lagoon — set dressing for the new swimmable water, following the props.ts
// idiom exactly (flat-shaded, vertex-coloured, deterministic seeded placement,
// InstancedMesh throughout). TWO draw calls total (kelp cross-planes, lily
// discs), well inside the ≤3 budget for this slice. The kelp sways gently via
// a System gated by the live reduced-motion signal — the same discipline as
// the water swell — and holds its exact pose when the player asks for less
// motion. Everything is disposed with the world.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { FrameContext, System } from "../engine/types.ts";
import type { ReducedMotionSource } from "./buildWorld.ts";
import type { Terrain } from "./terrain.ts";
import { makeNoise2D } from "./noise.ts";
import { LAGOON, WORLD } from "./worldConfig.ts";

export const KELP_COUNT = 120;
export const LILY_COUNT = 30;
/** Kelp roots only in real water: deeper than this, inside the lagoon zone. */
export const KELP_MIN_DEPTH = 1.0;
/** Lily pads live on the lagoon's edge band. */
export const LILY_MIN_DEPTH = 0.3;
export const LILY_MAX_DEPTH = 1.0;

const KELP_GREEN = 0x2f7758;
const LILY_GREEN = 0x3e7d3f;
/** Sway amplitudes (radians) and rates (per second) — gentle, current-like. */
const SWAY_X = 0.05;
const SWAY_Z = 0.08;
const SWAY_RATE_X = 0.7;
const SWAY_RATE_Z = 0.9;

export interface Aquatic {
  group: THREE.Group;
  /** Build the kelp sway System (register after construction; `motion` is the
   *  live reduced-motion gate, read every frame like the water swell's). */
  sway(motion?: ReducedMotionSource): System;
  dispose(): void;
}

interface Strand {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  /** Per-strand sway phase so the bed ripples, never marches in step. */
  phase: number;
}

export function buildAquatic(terrain: Terrain): Aquatic {
  const group = new THREE.Group();
  group.name = "aquatic";
  const rng = makeNoise2D(WORLD.seed ^ 0x5ea11fe);
  const depthAt = (x: number, z: number) => WORLD.seaLevel - terrain.heightAt(x, z);
  const lagoonReach = LAGOON.radius + LAGOON.shoreRamp;

  // ---- kelp: cross-plane strands rooted on the bed, deep lagoon only ----
  // Unit height — per-instance scale stretches each strand to its water depth.
  const kelpGeo = stampColor(makeCross(0.5, 1), KELP_GREEN);
  const kelpMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.85,
    side: THREE.DoubleSide, // thin planes, seen from any angle underwater
  });
  const kelp = new THREE.InstancedMesh(kelpGeo, kelpMat, KELP_COUNT);
  kelp.name = "aquatic-kelp";
  kelp.castShadow = false;
  kelp.receiveShadow = false; // fully underwater — the surface owns the light

  const strands: Strand[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const tint = new THREE.Color();

  // Seeded disc sampling over the lagoon zone (sqrt keeps it area-uniform);
  // the depth rule owns the truth, sampling only aims the candidates.
  for (let i = 0; strands.length < KELP_COUNT && i < KELP_COUNT * 30; i++) {
    const r = Math.sqrt(rng.value(i, 1)) * lagoonReach;
    const theta = rng.value(i, 2) * Math.PI * 2;
    const x = LAGOON.x + Math.cos(theta) * r;
    const z = LAGOON.z + Math.sin(theta) * r;
    const depth = depthAt(x, z);
    if (depth < KELP_MIN_DEPTH + 0.05) continue;
    const y = terrain.heightAt(x, z);
    strands.push({
      x,
      y,
      z,
      sx: 0.8 + rng.value(i, 3) * 0.5,
      // Reach for the light but never poke through the surface.
      sy: Math.min(depth - 0.4, 0.9 + rng.value(i, 4) * 1.3),
      phase: rng.value(i, 5) * Math.PI * 2,
    });
  }
  for (let i = 0; i < strands.length; i++) {
    const s = strands[i];
    pos.set(s.x, s.y, s.z);
    sc.set(s.sx, s.sy, s.sx);
    m.compose(pos, q.identity(), sc);
    kelp.setMatrixAt(i, m);
    // Subtle per-strand shade variation so the bed reads as growth, not tiles.
    kelp.setColorAt(i, tint.setHex(0xffffff).offsetHSL(0, 0, (rng.value(i, 6) - 0.5) * 0.16));
  }
  kelp.count = strands.length;
  kelp.instanceMatrix.needsUpdate = true;
  if (kelp.instanceColor) kelp.instanceColor.needsUpdate = true;

  // ---- lily pads: flat discs riding the surface at the lagoon edge ----
  const lilyGeo = stampColor(new THREE.CircleGeometry(0.55, 7).rotateX(-Math.PI / 2), LILY_GREEN);
  const lilyMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.9,
    side: THREE.DoubleSide, // visible from below while swimming under them
  });
  const lily = new THREE.InstancedMesh(lilyGeo, lilyMat, LILY_COUNT);
  lily.name = "aquatic-lily";
  lily.castShadow = false;
  lily.receiveShadow = true;

  let lilies = 0;
  for (let i = 0; lilies < LILY_COUNT && i < LILY_COUNT * 80; i++) {
    const ch = i + 50000; // decorrelate from the kelp sequence
    // Edge annulus only — the band where the shore ramp holds pad depth.
    const r = LAGOON.radius * 0.5 + rng.value(ch, 1) * (lagoonReach - LAGOON.radius * 0.5);
    const theta = rng.value(ch, 2) * Math.PI * 2;
    const x = LAGOON.x + Math.cos(theta) * r;
    const z = LAGOON.z + Math.sin(theta) * r;
    const depth = depthAt(x, z);
    if (depth < LILY_MIN_DEPTH + 0.02 || depth > LILY_MAX_DEPTH - 0.02) continue;
    const s = 0.7 + rng.value(ch, 3) * 0.6;
    pos.set(x, WORLD.seaLevel + 0.02, z);
    sc.set(s, 1, s);
    e.set(0, rng.value(ch, 4) * Math.PI * 2, 0);
    m.compose(pos, q.setFromEuler(e), sc);
    lily.setMatrixAt(lilies, m);
    lily.setColorAt(lilies, tint.setHex(0xffffff).offsetHSL(0, 0, (rng.value(ch, 5) - 0.5) * 0.12));
    lilies++;
  }
  lily.count = lilies;
  lily.instanceMatrix.needsUpdate = true;
  if (lily.instanceColor) lily.instanceColor.needsUpdate = true;

  group.add(kelp, lily);

  return {
    group,
    sway: (motion?: ReducedMotionSource) => new AquaticSwaySystem(kelp, strands, motion),
    dispose() {
      kelp.dispose();
      lily.dispose();
      kelpGeo.dispose();
      lilyGeo.dispose();
      kelpMat.dispose();
      lilyMat.dispose();
    },
  };
}

/**
 * The kelp sway: a slow two-axis lean per strand, phase-offset so the bed
 * ripples. The clock is system-owned and only advances while motion is
 * allowed (the WaterSystem discipline) — under reduced motion the matrices
 * simply keep their last pose, no writes at all. 120 matrix composes per
 * frame; no allocation in the loop.
 */
class AquaticSwaySystem implements System {
  readonly id = "aquatic-sway";

  private t = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly pos = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();

  constructor(
    private readonly mesh: THREE.InstancedMesh,
    private readonly strands: Strand[],
    private readonly motion?: ReducedMotionSource,
  ) {}

  update(ctx: FrameContext): void {
    if (this.motion?.getSnapshot().reducedMotion ?? false) return; // hold still
    this.t += ctx.dt;
    for (let i = 0; i < this.strands.length; i++) {
      const s = this.strands[i];
      this.e.set(
        Math.sin(this.t * SWAY_RATE_X + s.phase) * SWAY_X,
        0,
        Math.sin(this.t * SWAY_RATE_Z + s.phase * 1.3) * SWAY_Z,
      );
      this.pos.set(s.x, s.y, s.z);
      this.sc.set(s.sx, s.sy, s.sx);
      this.m.compose(this.pos, this.q.setFromEuler(this.e), this.sc);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Two crossed vertical planes (the props.ts foliage "X"), base at the local
 *  origin, reaching up to `height`. */
function makeCross(width: number, height: number): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(width, height);
  a.translate(0, height / 2, 0);
  const b = a.clone();
  b.rotateY(Math.PI / 2);
  const merged = mergeGeometries([a, b], false);
  a.dispose();
  b.dispose();
  if (!merged) throw new Error("aquatic: failed to merge kelp geometry");
  return merged;
}

/** Stamp a uniform per-vertex colour (the props/landmarks idiom): non-indexed
 *  first so flat shading keeps hard facets. Mutates and returns the geometry. */
function stampColor(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  if (flat !== geo) geo.dispose();
  const n = flat.getAttribute("position").count;
  const c = new THREE.Color(color);
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return flat;
}
