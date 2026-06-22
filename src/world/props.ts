import * as THREE from "three";
import { makeNoise2D } from "./noise.ts";
import { POI_ANCHORS, WORLD } from "./worldConfig.ts";
import type { Terrain } from "./terrain.ts";

export interface Props {
  group: THREE.Group;
  dispose(): void;
}

const TREE_COUNT = 540;
const ROCK_COUNT = 150;
const POI_CLEARANCE = 16; // keep props from crowding landmarks

/**
 * Set dressing (#22): low-poly trees and rocks scattered across the grassy band
 * of the island. Everything is an `InstancedMesh` — three draw calls total for
 * ~500 objects — so it fills the world without denting the draw-call budget.
 * Placement is deterministic (seeded), skips water/peaks/steep ground and the
 * area around each landmark, so it reads as natural cover that frames the POIs
 * rather than hiding them.
 */
export function buildProps(terrain: Terrain): Props {
  const group = new THREE.Group();
  group.name = "props";
  const rng = makeNoise2D(WORLD.seed ^ 0x9e3779b9);

  // Pseudo-random sample in [-half, half], decorrelated per index/channel.
  const half = WORLD.size / 2;
  const sample = (i: number, ch: number) =>
    (rng.value(i * 12.9898 + ch * 78.233, i * 39.425 + ch * 27.16) * 2 - 1) * half;

  const onGoodGround = (x: number, z: number): number | null => {
    if (Math.hypot(x, z) > WORLD.boundaryRadius - 6) return null;
    const y = terrain.heightAt(x, z);
    if (y < 1.2 || y > 20) return null; // skip beach/water and high rock/snow
    // slope check: reject steep ground (props would float/sink)
    const e = 1.5;
    const slope =
      Math.abs(terrain.heightAt(x + e, z) - y) +
      Math.abs(terrain.heightAt(x, z + e) - y);
    if (slope > 3) return null;
    for (const a of POI_ANCHORS) {
      if (Math.hypot(x - a.x, z - a.z) < POI_CLEARANCE) return null;
    }
    return y;
  };

  // ---- Trees: instanced trunk + instanced foliage sharing transforms ----
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 3, 5);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, flatShading: true, roughness: 1 });
  const foliageGeo = new THREE.ConeGeometry(2.2, 5, 6);
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x3f6f3a, flatShading: true, roughness: 1 });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, TREE_COUNT);
  const foliage = new THREE.InstancedMesh(foliageGeo, foliageMat, TREE_COUNT);
  trunks.castShadow = foliage.castShadow = true;
  trunks.receiveShadow = foliage.receiveShadow = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const pos = new THREE.Vector3();
  let trees = 0;
  for (let i = 0; trees < TREE_COUNT && i < TREE_COUNT * 6; i++) {
    const x = sample(i, 0);
    const z = sample(i, 1);
    const y = onGoodGround(x, z);
    if (y === null) continue;
    const s = 0.7 + rng.value(i, 7) * 0.8;
    const rot = rng.value(i, 3) * Math.PI * 2;
    q.setFromAxisAngle(UP, rot);
    pos.set(x, y + 1.5 * s, z);
    sc.set(s, s, s);
    m.compose(pos, q, sc);
    trunks.setMatrixAt(trees, m);
    pos.set(x, y + (3 + 2.5) * s, z); // foliage cone sits atop the trunk
    m.compose(pos, q, sc);
    foliage.setMatrixAt(trees, m);
    trees++;
  }
  trunks.count = trees;
  foliage.count = trees;
  trunks.instanceMatrix.needsUpdate = true;
  foliage.instanceMatrix.needsUpdate = true;
  group.add(trunks, foliage);

  // ---- Rocks: one instanced low-poly boulder ----
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8278, flatShading: true, roughness: 1 });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, ROCK_COUNT);
  rocks.castShadow = rocks.receiveShadow = true;
  let placedRocks = 0;
  for (let i = 0; placedRocks < ROCK_COUNT && i < ROCK_COUNT * 8; i++) {
    const x = sample(i + 9999, 0);
    const z = sample(i + 9999, 1);
    if (Math.hypot(x, z) > WORLD.boundaryRadius - 4) continue;
    const y = terrain.heightAt(x, z);
    if (y < 0.8) continue; // not underwater
    let nearPoi = false;
    for (const a of POI_ANCHORS) if (Math.hypot(x - a.x, z - a.z) < 10) nearPoi = true;
    if (nearPoi) continue;
    const s = 0.6 + rng.value(i, 11) * 1.6;
    q.setFromEuler(new THREE.Euler(rng.value(i, 1) * 3, rng.value(i, 2) * 6, rng.value(i, 4) * 3));
    pos.set(x, y + s * 0.3, z);
    sc.set(s, s * 0.8, s);
    m.compose(pos, q, sc);
    rocks.setMatrixAt(placedRocks, m);
    placedRocks++;
  }
  rocks.count = placedRocks;
  rocks.instanceMatrix.needsUpdate = true;
  group.add(rocks);

  return {
    group,
    dispose() {
      // InstancedMesh.dispose frees the per-instance matrix GPU buffer — needed
      // so a StrictMode/remount doesn't leak it.
      for (const im of [trunks, foliage, rocks]) im.dispose();
      for (const geo of [trunkGeo, foliageGeo, rockGeo]) geo.dispose();
      for (const mt of [trunkMat, foliageMat, rockMat]) mt.dispose();
    },
  };
}

const UP = new THREE.Vector3(0, 1, 0);
