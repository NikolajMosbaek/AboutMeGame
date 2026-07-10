// Butterflies (day) + fireflies (dusk/night) — pivot slice F, wildlife #184.
// Ambient drift near the understory, crossfading population by the day-cycle
// phase (`World.dayCycle.getPhase()` — never `./dayCycle` itself, which stays
// the single-importer of `world/dayCycleSystem.ts`, see dayCycle.test.ts's
// locked guard). Fireflies are designed bloom sources: `emissiveIntensity`
// well above 1 so they clear the compositor's 0.85 threshold
// (`engine/createCompositor.ts`) as warm points of light at dusk.
//
// Two draw calls total (one InstancedMesh each) regardless of how many of the
// up-to-90 instances are currently "alive" — the crossfade is COUNT-based
// (each mesh's `.count` scales with its population weight every frame), the
// simplest of the spec's sanctioned knobs ("scale/opacity or count").

import * as THREE from "three";
import type { FrameContext, System } from "../engine/types.ts";
import type { Terrain } from "../world/terrain.ts";
import { stampVertexColor } from "./geometry.ts";

/** The day-cycle phase accessor — `World.dayCycle` satisfies it. */
export interface DayCycleSource {
  getPhase(): number;
}

/** Hold all movement while true — the shared session pause flag satisfies it. */
export interface PauseSource {
  readonly paused: boolean;
}

export const MAX_BUTTERFLIES = 40;
export const MAX_FIREFLIES = 50;

/** `dayPalette`'s NOON keyframe fraction (`world/dayCycle.ts`'s `KEYFRAMES`
 *  table) — the fully "day" instant this module centres its day/night weight
 *  on. Authored here (not imported) so this file never becomes a second
 *  production importer of `./dayCycle`. */
const NOON_PHASE = 0.25;

/**
 * 0 (full day) .. 1 (full night) crossfade weight for a day-cycle loop
 * fraction `phase` ∈ [0,1). Cosine-shaped around the noon/evening antipodes,
 * so dawn (`phase` = 0) and dusk (`phase` = 0.5) — each exactly halfway around
 * the loop from noon — land at the 0.5 crossfade midpoint: "crossfade
 * populations around dawn/dusk," per the wildlife spec.
 */
export function nightWeight(phase: number): number {
  return (1 - Math.cos((phase - NOON_PHASE) * Math.PI * 2)) / 2;
}

/** How many of the `MAX_BUTTERFLIES` instances are visible at this phase. */
export function butterflyCount(phase: number): number {
  return Math.round(MAX_BUTTERFLIES * (1 - nightWeight(phase)));
}

/** How many of the `MAX_FIREFLIES` instances are visible at this phase. */
export function fireflyCount(phase: number): number {
  return Math.round(MAX_FIREFLIES * nightWeight(phase));
}

/** Cluster centres near the valley's vegetation, spread across the map so
 *  fliers read as scattered pockets of life rather than one swarm. Plain
 *  hand-picked points (like the birds' waypoints) — no placement rules to
 *  satisfy beyond "somewhere in the jungle." */
export const CLUSTERS: ReadonlyArray<{ x: number; z: number }> = [
  { x: 20, z: 60 },
  { x: -40, z: 40 },
  { x: -10, z: -60 },
  { x: 50, z: -80 },
  { x: 70, z: 10 },
  { x: -60, z: -60 },
];

/** Pure per-instance drift offset from its cluster centre — a small Lissajous
 *  wander, decorrelated per instance via its index. */
export function flierOffset(index: number, elapsed: number): { x: number; y: number; z: number } {
  const a = index * 12.9898;
  const b = index * 78.233;
  return {
    x: Math.sin(elapsed * 0.6 + a) * 3,
    y: 1.4 + Math.sin(elapsed * 0.9 + b) * 0.7,
    z: Math.cos(elapsed * 0.5 + b) * 3,
  };
}

const BUTTERFLY_COLOR = 0xf4a03c;
const FIREFLY_COLOR = 0xcdfa66;
/** Above the compositor's 0.85 threshold by a wide margin, at any tonemapped
 *  exposure — fireflies are a DESIGNED bloom source, not incidentally bright. */
const FIREFLY_EMISSIVE_INTENSITY = 2.5;

function buildButterflyGeometry(): THREE.BufferGeometry {
  return stampVertexColor(new THREE.PlaneGeometry(0.34, 0.22), BUTTERFLY_COLOR);
}

function buildFireflyGeometry(): THREE.BufferGeometry {
  return stampVertexColor(new THREE.PlaneGeometry(0.08, 0.08), FIREFLY_COLOR);
}

/**
 * Two draw calls (butterfly + firefly InstancedMesh), each capacity-allocated
 * at its max population and thinned live via `.count` — the wildlife budget's
 * per-creature cap. Geometry is a single quad each (2 triangles), so even at
 * full 90-instance capacity this is a couple hundred triangles.
 */
export class FliersSystem implements System {
  readonly id = "wildlife-fliers";

  private readonly group = new THREE.Group();
  private readonly butterflyGeo: THREE.BufferGeometry;
  private readonly fireflyGeo: THREE.BufferGeometry;
  private readonly butterflyMat: THREE.MeshStandardMaterial;
  private readonly fireflyMat: THREE.MeshStandardMaterial;
  private readonly butterflyMesh: THREE.InstancedMesh;
  private readonly fireflyMesh: THREE.InstancedMesh;
  private readonly clusterGroundY: number[];
  /** System-owned clock (mirrors `DayCycleSystem`/`BirdsSystem`): only
   *  advances while unpaused. */
  private elapsed = 0;

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly sc = new THREE.Vector3(1, 1, 1);
  private readonly posv = new THREE.Vector3();
  private readonly euler = new THREE.Euler();

  constructor(
    scene: THREE.Scene,
    terrain: Terrain,
    private readonly dayCycle: DayCycleSource,
    private readonly session: PauseSource,
  ) {
    this.group.name = "wildlife-fliers";

    this.butterflyGeo = buildButterflyGeometry();
    this.fireflyGeo = buildFireflyGeometry();
    this.butterflyMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.7,
      side: THREE.DoubleSide,
    });
    this.fireflyMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.7,
      side: THREE.DoubleSide,
      emissive: new THREE.Color(FIREFLY_COLOR),
      emissiveIntensity: FIREFLY_EMISSIVE_INTENSITY,
    });
    this.butterflyMesh = new THREE.InstancedMesh(this.butterflyGeo, this.butterflyMat, MAX_BUTTERFLIES);
    this.fireflyMesh = new THREE.InstancedMesh(this.fireflyGeo, this.fireflyMat, MAX_FIREFLIES);
    this.butterflyMesh.name = "wildlife-butterfly";
    this.fireflyMesh.name = "wildlife-firefly";
    this.group.add(this.butterflyMesh, this.fireflyMesh);
    scene.add(this.group);

    this.clusterGroundY = CLUSTERS.map((c) => terrain.heightAt(c.x, c.z));
  }

  update(ctx: FrameContext): void {
    if (this.session.paused) return;
    this.elapsed += ctx.dt;
    const phase = this.dayCycle.getPhase();

    this.layout(this.butterflyMesh, MAX_BUTTERFLIES);
    this.layout(this.fireflyMesh, MAX_FIREFLIES);
    this.butterflyMesh.count = butterflyCount(phase);
    this.fireflyMesh.count = fireflyCount(phase);
  }

  private layout(mesh: THREE.InstancedMesh, count: number): void {
    for (let i = 0; i < count; i++) {
      const cluster = CLUSTERS[i % CLUSTERS.length];
      const groundY = this.clusterGroundY[i % CLUSTERS.length];
      const off = flierOffset(i, this.elapsed);
      this.posv.set(cluster.x + off.x, groundY + off.y, cluster.z + off.z);
      this.euler.set(0, off.x * 0.3, 0);
      this.q.setFromEuler(this.euler);
      this.m.compose(this.posv, this.q, this.sc);
      mesh.setMatrixAt(i, this.m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  describe(): Record<string, unknown> {
    return { butterflies: this.butterflyMesh.count, fireflies: this.fireflyMesh.count };
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    this.butterflyMesh.dispose();
    this.fireflyMesh.dispose();
    this.butterflyGeo.dispose();
    this.fireflyGeo.dispose();
    this.butterflyMat.dispose();
    this.fireflyMat.dispose();
  }
}
