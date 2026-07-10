import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeNoise2D } from "../world/noise.ts";
import { WORLD, RIVER, SPAWN, POI_ANCHORS } from "../world/worldConfig.ts";
import { distToRiver, type Terrain } from "../world/terrain.ts";
import type { FruitPlant } from "./ForageSystem.ts";
import type { FruitKind } from "./forageStore.ts";

export interface Forage {
  group: THREE.Group;
  plants: FruitPlant[];
  /** Show/hide a plant's fruit (ForageSystem calls this on pick/regrow). */
  setRipe(index: number, ripe: boolean): void;
  dispose(): void;
}

/** Placement budgets at density 1 (scaled like props). */
const BUDGET: Record<FruitKind, number> = { berries: 26, banana: 34, mango: 24 };

// Palette (vertex colours over shared flat-shaded materials).
const BUSH = 0x2f5428;
const BANANA_LEAF = 0x3f7a2e;
const MANGO_LEAF = 0x35602a;
const TRUNK = 0x6b543a;
const BERRY = 0xc0392b;
const BANANA_FRUIT = 0xe8c94e;
const MANGO_FRUIT = 0xe0803a;

/**
 * Food plants (pivot slice E): berry bushes on the highland, banana plants on
 * the valley floor, mango trees on the mid slopes — each an instanced plant
 * mesh plus an instanced fruit mesh whose per-instance scale flips with
 * ripeness (picked plants stand bare until the regrow clock refruits them).
 * Six draw calls total. Placement is the world's seeded rejection-sampling
 * idiom: elevation-banded, never in the river channel or camp clearing, clear
 * of sites (but close enough that foraging routes brush past danger later).
 * The system logic never touches THREE — it drives ripeness through `setRipe`.
 */
export function buildForage(terrain: Terrain, density = 1): Forage {
  const group = new THREE.Group();
  group.name = "forage";
  const disposables: Array<{ dispose(): void }> = [];
  const plants: FruitPlant[] = [];

  const rng = makeNoise2D(WORLD.seed ^ 0x5f10d1);
  const value = (i: number, ch: number) => rng.fbm(i * 12.9898 + ch * 78.233, ch * 37.719 - i, 1);

  const plantMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
  const fruitMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.55 });
  disposables.push(plantMat, fruitMat);

  // ---- geometry per kind (local space, merged) ----
  const kinds: Array<{
    kind: FruitKind;
    band: [number, number];
    plantGeo: THREE.BufferGeometry;
    fruitGeo: THREE.BufferGeometry;
    fruitY: number;
  }> = [
    {
      kind: "berries",
      band: [12, 24],
      plantGeo: bushGeo(),
      fruitGeo: berryClusterGeo(),
      fruitY: 0.75,
    },
    {
      kind: "banana",
      band: [1.0, 9],
      plantGeo: bananaGeo(),
      fruitGeo: bananaClusterGeo(),
      fruitY: 1.7,
    },
    {
      kind: "mango",
      band: [1.5, 12],
      plantGeo: mangoGeo(),
      fruitGeo: mangoClusterGeo(),
      fruitY: 2.3,
    },
  ];

  const anchorsClear = (x: number, z: number) =>
    POI_ANCHORS.every((a) => Math.hypot(x - a.x, z - a.z) > 8) &&
    Math.hypot(x - SPAWN.x, z - SPAWN.z) > WORLD.campClearRadius + 3;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  const fruitMeshes: THREE.InstancedMesh[] = [];
  const fruitScale: number[] = []; // remembered per plant for regrow restore
  let plantIndexBase = 0;

  for (let k = 0; k < kinds.length; k++) {
    const spec = kinds[k];
    const budget = Math.max(1, Math.round(BUDGET[spec.kind] * density));
    disposables.push(spec.plantGeo, spec.fruitGeo);

    const plantMesh = new THREE.InstancedMesh(spec.plantGeo, plantMat, budget);
    const fruitMesh = new THREE.InstancedMesh(spec.fruitGeo, fruitMat, budget);
    plantMesh.name = `forage-${spec.kind}`;
    fruitMesh.name = `forage-${spec.kind}-fruit`;
    plantMesh.castShadow = true;
    plantMesh.receiveShadow = true;
    fruitMesh.receiveShadow = true;

    let placedCount = 0;
    for (let i = 0; placedCount < budget && i < budget * 220; i++) {
      const ch = k * 100000 + i;
      const x = (value(ch, 0) * 2 - 1) * (WORLD.boundaryRadius - 6);
      const z = (value(ch, 1) * 2 - 1) * (WORLD.boundaryRadius - 6);
      if (Math.hypot(x, z) > WORLD.boundaryRadius - 6) continue;
      const y = terrain.heightAt(x, z);
      if (y < spec.band[0] || y > spec.band[1]) continue;
      if (distToRiver(x, z) < RIVER.bankHalfWidth + 1) continue;
      if (!anchorsClear(x, z)) continue;

      const s = 0.8 + value(ch, 2) * 0.5;
      q.setFromAxisAngle(UP, value(ch, 3) * Math.PI * 2);
      pos.set(x, y, z);
      sc.set(s, s, s);
      m.compose(pos, q, sc);
      plantMesh.setMatrixAt(placedCount, m);
      pos.y = y + spec.fruitY * s;
      m.compose(pos, q, sc);
      fruitMesh.setMatrixAt(placedCount, m);

      plants.push({ kind: spec.kind, x, z, ripe: true, regrowIn: 0 });
      fruitScale.push(s);
      placedCount++;
    }
    plantMesh.count = placedCount;
    fruitMesh.count = placedCount;
    plantMesh.instanceMatrix.needsUpdate = true;
    fruitMesh.instanceMatrix.needsUpdate = true;
    group.add(plantMesh, fruitMesh);
    fruitMeshes.push(fruitMesh);
    plantIndexBase += placedCount;
  }
  void plantIndexBase;

  // Map a flat plant index back to (mesh, local index) for setRipe.
  const meshFor = (index: number): { mesh: THREE.InstancedMesh; local: number } => {
    let base = 0;
    for (const fm of fruitMeshes) {
      if (index < base + fm.count) return { mesh: fm, local: index - base };
      base += fm.count;
    }
    throw new Error(`forage index out of range: ${index}`);
  };

  const tmp = new THREE.Matrix4();
  const p2 = new THREE.Vector3();
  const q2 = new THREE.Quaternion();
  const s2 = new THREE.Vector3();

  return {
    group,
    plants,
    setRipe(index, ripe) {
      const { mesh, local } = meshFor(index);
      mesh.getMatrixAt(local, tmp);
      tmp.decompose(p2, q2, s2);
      const base = fruitScale[index];
      const target = ripe ? base : 0.0001; // scale-0 hides without a count churn
      s2.set(target, target, target);
      tmp.compose(p2, q2, s2);
      mesh.setMatrixAt(local, tmp);
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

// ---- local-space plant geometry (merged, vertex-coloured) ----

function stamp(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  if (flat !== geo) geo.dispose();
  const n = flat.getAttribute("position").count;
  const c = new THREE.Color(hex);
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return flat;
}

function at(geo: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rz = 0): THREE.BufferGeometry {
  geo.rotateZ(rz);
  geo.rotateY(ry);
  geo.translate(x, y, z);
  return geo;
}

function mergeOwn(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("forage merge failed");
  return merged;
}

function bushGeo(): THREE.BufferGeometry {
  return mergeOwn([
    at(stamp(new THREE.DodecahedronGeometry(0.55), BUSH), 0, 0.45, 0),
    at(stamp(new THREE.DodecahedronGeometry(0.4), BUSH), 0.4, 0.35, 0.15, 0.8),
    at(stamp(new THREE.DodecahedronGeometry(0.35), BUSH), -0.35, 0.3, -0.1, 2.1),
  ]);
}

function berryClusterGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const t = (i / 5) * Math.PI * 2;
    parts.push(at(stamp(new THREE.DodecahedronGeometry(0.07), BERRY), Math.cos(t) * 0.3, (i % 2) * 0.12, Math.sin(t) * 0.3));
  }
  return mergeOwn(parts);
}

function bananaGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    at(stamp(new THREE.CylinderGeometry(0.09, 0.13, 1.6, 5), TRUNK), 0, 0.8, 0),
  ];
  for (let i = 0; i < 5; i++) {
    const t = (i / 5) * Math.PI * 2;
    const leaf = stamp(new THREE.PlaneGeometry(0.5, 1.7), BANANA_LEAF);
    leaf.rotateX(Math.PI / 2.6); // arc upward-outward
    parts.push(at(leaf, Math.cos(t) * 0.5, 1.75, Math.sin(t) * 0.5, -t + Math.PI / 2));
  }
  return mergeOwn(parts);
}

function bananaClusterGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const g = stamp(new THREE.CylinderGeometry(0.05, 0.07, 0.34, 5), BANANA_FRUIT);
    parts.push(at(g, 0.12 * (i - 1.5), -0.1 * (i % 2), 0.12, 0, 0.5));
  }
  return mergeOwn(parts);
}

function mangoGeo(): THREE.BufferGeometry {
  return mergeOwn([
    at(stamp(new THREE.CylinderGeometry(0.12, 0.18, 1.9, 5), TRUNK), 0, 0.95, 0),
    at(stamp(new THREE.DodecahedronGeometry(0.95), MANGO_LEAF), 0, 2.35, 0),
    at(stamp(new THREE.DodecahedronGeometry(0.6), MANGO_LEAF), 0.55, 2.0, 0.3, 1.2),
  ]);
}

function mangoClusterGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const t = (i / 3) * Math.PI * 2 + 0.4;
    parts.push(at(stamp(new THREE.SphereGeometry(0.11, 6, 5), MANGO_FRUIT), Math.cos(t) * 0.5, -0.35 * (i % 2) - 0.1, Math.sin(t) * 0.5));
  }
  return mergeOwn(parts);
}
