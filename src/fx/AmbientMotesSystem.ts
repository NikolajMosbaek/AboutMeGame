// Ambient jungle motes — the GPU wiring half (visual-overhaul slice 7,
// polish). Owns two pooled `THREE.Points` clouds (dust/pollen + falling
// leaves — 2 draw calls total, the design's own ceiling), built once from the
// pure seeds in `ambientMotes.ts` and rewritten every frame like
// `DiscoveryBurst`/`TreasureBurstSystem` already do — no vertex shader, so
// `THREE.PointsMaterial`'s built-in `sizeAttenuation` comes for free.
//
// Reduced motion (#49): positions are computed ONCE at construction (t=0) and
// never rewritten again — a static suspended field, the `discoveryBurst.ts`
// precedent extended to "hold forever" rather than "never plays".

import * as THREE from "three";
import type { FrameContext, System } from "../engine/types.ts";
import type { ReducedMotionSource } from "../world/buildWorld.ts";
import {
  AMBIENT_CENTERS,
  AMBIENT_LEAF_COUNT,
  AMBIENT_MOTE_COUNT,
  AMBIENT_WRAP_PERIOD,
  LEAF_COLOR_A,
  LEAF_COLOR_B,
  LEAF_OPACITY,
  LEAF_SIZE,
  MOTE_COLOR,
  MOTE_OPACITY,
  MOTE_SIZE,
  buildLeafSeeds,
  buildMoteSeeds,
  leafPosition,
  motePosition,
  type HeightAt,
  type LeafSeed,
  type MoteSeed,
} from "./ambientMotes.ts";

export class AmbientMotesSystem implements System {
  readonly id = "fx-ambient-motes";

  private readonly moteSeeds: MoteSeed[];
  private readonly leafSeeds: LeafSeed[];
  private readonly moteGroundY: number[];

  private readonly motePositions: Float32Array;
  private readonly moteGeometry: THREE.BufferGeometry;
  private readonly moteMaterial: THREE.PointsMaterial;
  private readonly motePoints: THREE.Points;

  private readonly leafPositions: Float32Array;
  private readonly leafColors: Float32Array;
  private readonly leafGeometry: THREE.BufferGeometry;
  private readonly leafMaterial: THREE.PointsMaterial;
  private readonly leafPoints: THREE.Points;

  private t = 0;

  constructor(
    scene: THREE.Scene,
    heightAt: HeightAt,
    private readonly reducedMotion?: ReducedMotionSource,
  ) {
    this.moteSeeds = buildMoteSeeds(AMBIENT_MOTE_COUNT, AMBIENT_CENTERS, heightAt);
    this.leafSeeds = buildLeafSeeds(AMBIENT_LEAF_COUNT, AMBIENT_CENTERS);
    // Leaves fall relative to the ground directly below their own seed XZ —
    // sampled once (ground doesn't move), unlike motes whose baseY already
    // bakes the offset in.
    this.moteGroundY = this.leafSeeds.map((s) => heightAt(s.baseX, s.baseZ));

    this.motePositions = new Float32Array(AMBIENT_MOTE_COUNT * 3);
    this.moteGeometry = new THREE.BufferGeometry();
    this.moteGeometry.setAttribute("position", new THREE.BufferAttribute(this.motePositions, 3));
    this.moteMaterial = new THREE.PointsMaterial({
      color: MOTE_COLOR,
      size: MOTE_SIZE,
      transparent: true,
      opacity: MOTE_OPACITY,
      depthWrite: false,
      sizeAttenuation: true,
      // Deliberately NOT additive (see ambientMotes.ts's MOTE_COLOR doc) — the
      // motes must stay well below the compositor's bloom threshold.
    });
    this.motePoints = new THREE.Points(this.moteGeometry, this.moteMaterial);
    this.motePoints.name = "ambient-motes";
    this.motePoints.frustumCulled = false;
    scene.add(this.motePoints);

    this.leafPositions = new Float32Array(AMBIENT_LEAF_COUNT * 3);
    this.leafColors = new Float32Array(AMBIENT_LEAF_COUNT * 3);
    const colorA = new THREE.Color(LEAF_COLOR_A);
    const colorB = new THREE.Color(LEAF_COLOR_B);
    for (let i = 0; i < AMBIENT_LEAF_COUNT; i++) {
      const c = i % 2 === 0 ? colorA : colorB;
      this.leafColors[i * 3] = c.r;
      this.leafColors[i * 3 + 1] = c.g;
      this.leafColors[i * 3 + 2] = c.b;
    }
    this.leafGeometry = new THREE.BufferGeometry();
    this.leafGeometry.setAttribute("position", new THREE.BufferAttribute(this.leafPositions, 3));
    this.leafGeometry.setAttribute("color", new THREE.BufferAttribute(this.leafColors, 3));
    this.leafMaterial = new THREE.PointsMaterial({
      size: LEAF_SIZE,
      transparent: true,
      opacity: LEAF_OPACITY,
      depthWrite: false,
      sizeAttenuation: true,
      vertexColors: true,
    });
    this.leafPoints = new THREE.Points(this.leafGeometry, this.leafMaterial);
    this.leafPoints.name = "ambient-leaves";
    this.leafPoints.frustumCulled = false;
    scene.add(this.leafPoints);

    this.layout(0);
  }

  update(ctx: FrameContext): void {
    const still = this.reducedMotion?.getSnapshot().reducedMotion ?? false;
    if (still) return; // static suspended field — computed once, in the constructor.

    this.t = THREE.MathUtils.euclideanModulo(this.t + ctx.dt, AMBIENT_WRAP_PERIOD);
    this.layout(this.t);
  }

  private layout(t: number): void {
    for (let i = 0; i < this.moteSeeds.length; i++) {
      const p = motePosition(this.moteSeeds[i], t);
      const o = i * 3;
      this.motePositions[o] = p.x;
      this.motePositions[o + 1] = p.y;
      this.motePositions[o + 2] = p.z;
    }
    (this.moteGeometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;

    for (let i = 0; i < this.leafSeeds.length; i++) {
      const p = leafPosition(this.leafSeeds[i], t, this.moteGroundY[i]);
      const o = i * 3;
      this.leafPositions[o] = p.x;
      this.leafPositions[o + 1] = p.y;
      this.leafPositions[o + 2] = p.z;
    }
    (this.leafGeometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.motePoints.removeFromParent();
    this.moteGeometry.dispose();
    this.moteMaterial.dispose();
    this.leafPoints.removeFromParent();
    this.leafGeometry.dispose();
    this.leafMaterial.dispose();
  }
}
