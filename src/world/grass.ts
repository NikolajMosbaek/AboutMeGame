import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeNoise2D } from "./noise.ts";
import { POI_ANCHORS, RIVER, SPAWN, WORLD } from "./worldConfig.ts";
import { distToRiver, type Terrain } from "./terrain.ts";
import { computeSplatWeights, slopeFromNormalY } from "./terrainSplat.ts";
import { makeWindPatch } from "./windPatch.ts";
import type { WindUniforms } from "./windSystem.ts";

// Wind-swayed grass layer (visual-overhaul slice 6, flora & fauna). Medium/high
// only (`quality.floraDetail === "full"`, wired by `floraUpgrade.ts`) — ONE
// `InstancedMesh` of small crossed, tapered blade-clusters, vertex-coloured
// (darker at the root, lighter at the tip — no texture, no `alphaTest` cutout;
// simpler than the foliage crosses' leaf-blob texture and cheap enough that a
// procedural taper reads fine at this size), seeded into open, gentle, jungle-
// floor ground so it grounds the camp/valley-floor without growing on rock,
// sand, or the riverbank cliff. Shares the SAME `windPatch.ts` sway every
// canopy/palm/understory material gets (medium/high only) via the caller-
// owned `windUniforms` handle.

// Jungle-density epic (2026-07-19): thicker floor cover. Medium/high only
// (floraDetail "full"), so the low tier never pays for a single blade.
export const GRASS_COUNT = 3000;

const BLADE_WIDTH = 0.5;
const BLADE_TIP_WIDTH = 0.12;
const BLADE_HEIGHT = 0.42;
const GRASS_WIND_STRENGTH = 0.1;

const GRASS_DARK = new THREE.Color(0x2f5d2a);
const GRASS_LIGHT = new THREE.Color(0x6ea052);

const POI_CLEARANCE = 4; // jungle-feel round 2: grass right up to the sites
/** Absolute grass ring around the camp centre (world units) — grass creeps
 *  INTO the 14 u cleared disc; the tent/fire props end by ~6 u. */
const GRASS_CAMP_RING = 7;

export interface Grass {
  group: THREE.Group;
  dispose(): void;
}

/**
 * Reuses `terrainSplat.ts`'s real splat-weight function (never a re-
 * implementation of "is this rock/sand/steep") to decide whether a ground
 * point is open jungle-floor/leaf-litter, i.e. grass-plausible. `noise` is
 * fixed at the NEUTRAL 0.5 (no mottle bias): `computeSplatWeights`'s own doc
 * establishes the mottle term only ever swaps weight BETWEEN jungleFloor and
 * leafLitter, never touching rock/sand — so a neutral noise input changes
 * nothing about the rock/sand/steep exclusion this function cares about,
 * making the reuse exact for this purpose despite not reproducing the real
 * per-point mottle sample.
 */
export function isOpenGround(terrain: Terrain, x: number, z: number): boolean {
  const e = 1.5;
  const y = terrain.heightAt(x, z);
  const dHdx = (terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z)) / (2 * e);
  const dHdz = (terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e)) / (2 * e);
  const normalY = 1 / Math.sqrt(1 + dHdx * dHdx + dHdz * dHdz);
  const slope = slopeFromNormalY(normalY);
  const weights = computeSplatWeights(y, slope, 0.5);
  return weights.jungleFloor + weights.leafLitter > 0.6;
}

export interface GrassPlacement {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
}

/**
 * Seeded rejection-sampling placement (the `props.ts` idiom, a distinct XOR'd
 * seed so this layer doesn't read the same sequence as any prop layer): inside
 * the boundary, never underwater, never in the river channel, never within
 * `POI_CLEARANCE` of a site/the camp, and only on open ground
 * ({@link isOpenGround}). Pure — same terrain + density always yields the same
 * placements, so `buildGrass` and its tests never disagree.
 */
export function grassPlacements(terrain: Terrain, density = 1): GrassPlacement[] {
  const rng = makeNoise2D(WORLD.seed ^ 0x51ed270b);
  const budget = Math.max(1, Math.round(GRASS_COUNT * Math.max(0, Math.min(1, density))));
  const half = WORLD.size / 2;
  const sample = (i: number, ch: number) =>
    (rng.value(i * 12.9898 + ch * 78.233, i * 39.425 + ch * 27.16) * 2 - 1) * half;
  const withinWorld = (x: number, z: number) => Math.hypot(x, z) <= WORLD.boundaryRadius - 4;
  const clearOfSites = (x: number, z: number) => {
    for (const a of POI_ANCHORS) {
      if (Math.hypot(x - a.x, z - a.z) < POI_CLEARANCE) return false;
    }
    return Math.hypot(x - SPAWN.x, z - SPAWN.z) >= GRASS_CAMP_RING;
  };
  // Spawn-bowl bias (jungle-feel round 2): 3,000 tufts over the whole island
  // is one per ~28 m² — invisible. Rather than add triangles, concentrate
  // roughly half the SAME budget where the player actually looks first.
  const nearSpawn = (x: number, z: number) => Math.hypot(x - SPAWN.x, z - SPAWN.z) < 60;

  const out: GrassPlacement[] = [];
  for (let i = 0; out.length < budget && i < GRASS_COUNT * 12; i++) {
    const x = sample(i, 0);
    const z = sample(i, 1);
    if (!withinWorld(x, z)) continue;
    const y = terrain.heightAt(x, z);
    if (y < 0.8) continue;
    if (distToRiver(x, z) < RIVER.bankHalfWidth + 1) continue;
    if (!clearOfSites(x, z)) continue;
    if (!isOpenGround(terrain, x, z)) continue;
    if (!nearSpawn(x, z) && rng.value(i, 11) > 0.35) continue; // bias the bowl
    const scale = 0.7 + rng.value(i, 7) * 0.7;
    const rotation = rng.value(i, 3) * Math.PI * 2;
    out.push({ x, y, z, scale, rotation });
  }
  return out;
}

/** One crossed pair of tapered blade planes (base at local origin, up to
 *  `height`), vertex-coloured dark-to-light root-to-tip. */
function makeTuftGeometry(): THREE.BufferGeometry {
  const half = BLADE_WIDTH / 2;
  const tipHalf = BLADE_TIP_WIDTH / 2;
  const positions = new Float32Array([
    -half, 0, 0, half, 0, 0, tipHalf, BLADE_HEIGHT, 0,
    -half, 0, 0, tipHalf, BLADE_HEIGHT, 0, -tipHalf, BLADE_HEIGHT, 0,
  ]);
  const plane = new THREE.BufferGeometry();
  plane.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  plane.computeVertexNormals();

  const n = plane.getAttribute("position").count;
  const colors = new Float32Array(n * 3);
  const posAttr = plane.getAttribute("position");
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const t = Math.max(0, Math.min(1, posAttr.getY(i) / BLADE_HEIGHT));
    c.copy(GRASS_DARK).lerp(GRASS_LIGHT, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  plane.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const b = plane.clone();
  b.rotateY(Math.PI / 2);
  const merged = mergeGeometries([plane, b], false);
  plane.dispose();
  b.dispose();
  if (!merged) throw new Error("grass: failed to merge tuft geometry");
  return merged;
}

/**
 * Build the grass layer: ONE `InstancedMesh` draw call at the seeded
 * placements, wind-patched with the SAME shared `windUniforms` every other
 * flora material reads (so grass sways in phase-desynced lockstep with the
 * trees, not on its own separate clock). Never casts a shadow (thin ground-
 * level foliage, the `props.ts` convention), but receives them.
 */
export function buildGrass(terrain: Terrain, density: number, windUniforms: WindUniforms): Grass {
  const group = new THREE.Group();
  group.name = "grass";

  const placements = grassPlacements(terrain, density);
  const geometry = makeTuftGeometry();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  const windPatch = makeWindPatch({
    maxHeight: BLADE_HEIGHT,
    strength: GRASS_WIND_STRENGTH,
    uniforms: { uTime: windUniforms.uTime },
  });
  material.onBeforeCompile = windPatch.onBeforeCompile;
  material.customProgramCacheKey = windPatch.customProgramCacheKey;

  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, placements.length));
  mesh.name = "grass";
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  placements.forEach((p, i) => {
    q.setFromAxisAngle(up, p.rotation);
    pos.set(p.x, p.y, p.z);
    sc.set(p.scale, p.scale, p.scale);
    m.compose(pos, q, sc);
    mesh.setMatrixAt(i, m);
  });
  mesh.count = placements.length;
  mesh.instanceMatrix.needsUpdate = true;

  group.add(mesh);

  return {
    group,
    dispose() {
      mesh.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
