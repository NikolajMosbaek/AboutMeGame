import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { POI_ANCHORS, type LandmarkArchetype } from "./worldConfig.ts";
import type { Terrain } from "./terrain.ts";

export interface PlacedLandmark {
  poiId: string;
  label: string;
  /** World position of the landmark's base (on the terrain). */
  position: THREE.Vector3;
  /** The group containing the structure + beacon (named `landmark:<poiId>`). */
  object: THREE.Object3D;
  color: number;
}

export interface Landmarks {
  group: THREE.Group;
  placed: PlacedLandmark[];
  dispose(): void;
}

/** Neutral stone tint stamped on every stone-set source vertex. */
const STONE_BASE = 0xb9b2a6;

/**
 * Place the 13 landmarks (#20). Each anchor gets a distinct procedural structure
 * (its `archetype`) plus a tall, glowing sky-beacon in its signature colour, so
 * every point of interest reads as a navigation target from across the island —
 * that's what "guides exploration" means here. Each landmark group is named
 * `landmark:<poiId>` and recorded in `placed`, so Epic 4 attaches reveal
 * triggers and Epic 5 draws nav hints to the same positions. No content text
 * lives here — only the world geometry.
 *
 * G4 — each archetype's richer sub-primitives are baked into local-space
 * geometry and merged per-landmark into ONE stone mesh + ONE accent mesh via
 * `mergeGeometries`, both drawn with TWO shared materials (stone + emissive
 * accent, `vertexColors:true`). The signature hue rides a per-vertex `color`
 * attribute, so the one shared accent material glows in each landmark's
 * signature colour and catches the G2 bloom — no per-landmark material
 * explosion. The beacon (all 13) and the tower lamp stay discrete, named,
 * un-merged meshes: BeaconPulseSystem, both bloom invariants and the discovery
 * anchor depend on those exactly.
 */
export function buildLandmarks(terrain: Terrain): Landmarks {
  const group = new THREE.Group();
  group.name = "landmarks";
  const disposables: Array<{ dispose(): void }> = [];
  const placed: PlacedLandmark[] = [];

  // Two shared materials, created once per call (DI seam, not module-level
  // singletons) — a rebuild after dispose() gets fresh materials. The accent
  // material is emissive white modulated by the per-vertex signature colour, so
  // it glows in each landmark's hue from one instance; tuned just under the
  // tower lamp so the lamp stays the brightest source.
  const stone = new THREE.MeshStandardMaterial({
    flatShading: true,
    roughness: 0.7,
    vertexColors: true,
  });
  const accent = new THREE.MeshStandardMaterial({
    flatShading: true,
    roughness: 0.5,
    vertexColors: true,
    emissive: 0xffffff,
    emissiveIntensity: 1.0,
  });
  disposables.push(stone, accent);

  for (const anchor of POI_ANCHORS) {
    const y = Math.max(terrain.heightAt(anchor.x, anchor.z), 0.2);
    const position = new THREE.Vector3(anchor.x, y, anchor.z);

    const landmark = new THREE.Group();
    landmark.name = `landmark:${anchor.poiId}`;
    landmark.position.copy(position);

    const structure = buildArchetype(
      anchor.archetype,
      anchor.color,
      stone,
      accent,
      disposables,
    );
    landmark.add(structure);
    landmark.add(buildBeacon(anchor.color, disposables));

    group.add(landmark);
    placed.push({
      poiId: anchor.poiId,
      label: anchor.label,
      position,
      object: landmark,
      color: anchor.color,
    });
  }

  return {
    group,
    placed,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/**
 * A tall translucent glowing column rising from the landmark into the sky.
 *
 * The beacon is the chief bloom source for the medium/high compositor path
 * (`createCompositor.ts`): RenderPass writes linear, UnrealBloomPass adds in
 * linear HDR, OutputPass tone-maps once. To clear the tuned-high bloom
 * threshold while ordinary lit stone, sky and water do not, the additive
 * colour is pushed into HDR (>1.0) by scaling the signature hue, and the
 * opacity is raised so the additive contribution is bright at the core. The
 * additive / `depthWrite:false` / transparent invariants are preserved so it
 * stays a non-occluding overlay — guarded by landmarks.test.ts.
 */
function buildBeacon(color: number, disposables: Array<{ dispose(): void }>): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(0.6, 1.6, 60, 8, 1, true);
  // HDR-scale the signature hue past 1.0 so the additive core reads as a true
  // light source that clears the high bloom threshold; preserves the colour.
  const hdr = new THREE.Color(color).multiplyScalar(2.4);
  const mat = new THREE.MeshBasicMaterial({
    color: hdr,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  disposables.push(geo, mat);
  const beacon = new THREE.Mesh(geo, mat);
  beacon.position.y = 30;
  beacon.name = "beacon";
  return beacon;
}

/**
 * Stamp a uniform per-vertex `color` on a geometry and convert it to
 * non-indexed so every merge source shares `{position,normal,uv,color}` and
 * `mergeGeometries` returns non-null. No `mergeVertices` — flat shading wants
 * hard normals. The geometry is mutated in place and returned.
 */
function prep(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
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

/**
 * Collect a landmark's local-space sub-primitives, split into a stone set and
 * an accent set, then merge each set into a single mesh. Transforms are baked
 * into each source geometry BEFORE merge (`mergeGeometries` ignores Object3D
 * transforms), so nothing collapses to the origin. Source geometries are
 * consumed by the merge (copied into a new buffer) and disposed immediately;
 * only the two merged geometries are tracked for disposal.
 */
function mergeSet(
  sources: THREE.BufferGeometry[],
  material: THREE.Material,
  disposables: Array<{ dispose(): void }>,
): THREE.Mesh | null {
  if (sources.length === 0) return null;
  const merged = mergeGeometries(sources, false);
  for (const s of sources) s.dispose();
  if (!merged) return null;
  disposables.push(merged);
  const m = new THREE.Mesh(merged, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Build the distinct base structure for an archetype, centred at local origin. */
function buildArchetype(
  archetype: LandmarkArchetype,
  color: number,
  stone: THREE.Material,
  accent: THREE.Material,
  d: Array<{ dispose(): void }>,
): THREE.Group {
  const g = new THREE.Group();
  // Local-space sub-primitives split by material; each transform is baked into
  // the geometry below, then merged into one stone mesh + one accent mesh.
  const stoneSrc: THREE.BufferGeometry[] = [];
  const accentSrc: THREE.BufferGeometry[] = [];

  const box = (
    w: number,
    h: number,
    dep: number,
    x: number,
    y: number,
    z: number,
    accentFace: boolean,
  ) => {
    const geo = new THREE.BoxGeometry(w, h, dep);
    geo.translate(x, y, z);
    (accentFace ? accentSrc : stoneSrc).push(
      prep(geo, accentFace ? color : STONE_BASE),
    );
  };

  switch (archetype) {
    case "gate": {
      box(2, 9, 2, -4, 4.5, 0, false);
      box(2, 9, 2, 4, 4.5, 0, false);
      box(12, 2, 2.4, 0, 10, 0, true);
      break;
    }
    case "monolith": {
      box(3, 12, 1.4, 0, 6, 0, false);
      box(4, 1, 2.4, 0, 12.5, 0, true);
      break;
    }
    case "tower": {
      const shaft = new THREE.CylinderGeometry(2.4, 3.4, 14, 10);
      shaft.translate(0, 7, 0);
      stoneSrc.push(prep(shaft, STONE_BASE));
      // The lamp stays a discrete, named, un-merged emissive mesh — the second
      // genuine bloom source. Its emissive carries the signature colour and is
      // pushed past 1.0 so its post-tonemap luminance clears the tuned-high
      // bloom threshold; guarded by landmarks.test.ts. The tower's accent role
      // IS this lamp, so the archetype needs no separate merged accent mesh.
      const lampGeo = new THREE.IcosahedronGeometry(2.2, 0);
      const lampMat = new THREE.MeshStandardMaterial({
        color,
        flatShading: true,
        roughness: 0.5,
        metalness: 0.1,
        emissive: new THREE.Color(color),
        emissiveIntensity: 1.6,
      });
      d.push(lampGeo, lampMat);
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.castShadow = true;
      lamp.receiveShadow = true;
      lamp.position.y = 15;
      lamp.name = "lamp";
      g.add(lamp);
      break;
    }
    case "foundry": {
      box(10, 7, 8, 0, 3.5, 0, false);
      const chimney = new THREE.CylinderGeometry(1.2, 1.6, 12, 8);
      chimney.translate(3.5, 6, -2.5);
      accentSrc.push(prep(chimney, color));
      break;
    }
    case "dam": {
      box(22, 11, 3, 0, 5.5, 0, false);
      box(4, 8, 3.6, 0, 4, 0, true);
      break;
    }
    case "station": {
      box(12, 1.2, 7, 0, 0.6, 0, false);
      box(13, 0.6, 8, 0, 6, 0, true);
      for (const px of [-5, 5]) {
        for (const pz of [-3, 3]) {
          box(0.6, 5, 0.6, px, 3, pz, false);
        }
      }
      break;
    }
    case "ring": {
      const count = 8;
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        box(1.4, 6, 1.4, Math.cos(a) * 6, 3, Math.sin(a) * 6, i % 2 !== 0);
      }
      break;
    }
    case "mirror": {
      box(14, 10, 1, 0, 5, 0, false);
      // The reflective face folds into the accent vertex-colour path: a bright
      // cool signature accent on the shared emissive accent material replaces
      // the deleted bespoke metalness glass plate (owner's call — the flat
      // low-poly look does not need literal metalness).
      box(12, 8, 0.4, 0, 5, 0.6, true);
      break;
    }
  }

  const stoneMesh = mergeSet(stoneSrc, stone, d);
  if (stoneMesh) g.add(stoneMesh);
  const accentMesh = mergeSet(accentSrc, accent, d);
  if (accentMesh) g.add(accentMesh);
  return g;
}
