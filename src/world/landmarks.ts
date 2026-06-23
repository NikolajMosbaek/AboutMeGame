import * as THREE from "three";
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

/**
 * Place the 13 landmarks (#20). Each anchor gets a distinct procedural structure
 * (its `archetype`) plus a tall, glowing sky-beacon in its signature colour, so
 * every point of interest reads as a navigation target from across the island —
 * that's what "guides exploration" means here. Each landmark group is named
 * `landmark:<poiId>` and recorded in `placed`, so Epic 4 attaches reveal
 * triggers and Epic 5 draws nav hints to the same positions. No content text
 * lives here — only the world geometry.
 */
export function buildLandmarks(terrain: Terrain): Landmarks {
  const group = new THREE.Group();
  group.name = "landmarks";
  const disposables: Array<{ dispose(): void }> = [];
  const placed: PlacedLandmark[] = [];

  for (const anchor of POI_ANCHORS) {
    const y = Math.max(terrain.heightAt(anchor.x, anchor.z), 0.2);
    const position = new THREE.Vector3(anchor.x, y, anchor.z);

    const landmark = new THREE.Group();
    landmark.name = `landmark:${anchor.poiId}`;
    landmark.position.copy(position);

    const structure = buildArchetype(anchor.archetype, anchor.color, disposables);
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

function mat(
  color: number,
  disposables: Array<{ dispose(): void }>,
  opts: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: 0.7,
    ...opts,
  });
  disposables.push(m);
  return m;
}

function track<T extends THREE.BufferGeometry>(
  geo: T,
  disposables: Array<{ dispose(): void }>,
): T {
  disposables.push(geo);
  return geo;
}

function mesh(
  geo: THREE.BufferGeometry,
  material: THREE.Material,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Build the distinct base structure for an archetype, centred at local origin. */
function buildArchetype(
  archetype: LandmarkArchetype,
  color: number,
  d: Array<{ dispose(): void }>,
): THREE.Group {
  const g = new THREE.Group();
  const stone = mat(0xb9b2a6, d);
  const accent = mat(color, d, { roughness: 0.5, metalness: 0.1 });

  switch (archetype) {
    case "gate": {
      const pillar = track(new THREE.BoxGeometry(2, 9, 2), d);
      const left = mesh(pillar, stone);
      left.position.set(-4, 4.5, 0);
      const right = mesh(pillar, stone);
      right.position.set(4, 4.5, 0);
      const lintel = mesh(track(new THREE.BoxGeometry(12, 2, 2.4), d), accent);
      lintel.position.set(0, 10, 0);
      g.add(left, right, lintel);
      break;
    }
    case "monolith": {
      const slab = mesh(track(new THREE.BoxGeometry(3, 12, 1.4), d), stone);
      slab.position.y = 6;
      const cap = mesh(track(new THREE.BoxGeometry(4, 1, 2.4), d), accent);
      cap.position.y = 12.5;
      g.add(slab, cap);
      break;
    }
    case "tower": {
      const shaft = mesh(track(new THREE.CylinderGeometry(2.4, 3.4, 14, 10), d), stone);
      shaft.position.y = 7;
      const lamp = mesh(track(new THREE.IcosahedronGeometry(2.2, 0), d), accent);
      lamp.position.y = 15;
      (lamp.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(color);
      (lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.9;
      g.add(shaft, lamp);
      break;
    }
    case "foundry": {
      const hall = mesh(track(new THREE.BoxGeometry(10, 7, 8), d), stone);
      hall.position.y = 3.5;
      const chimney = mesh(track(new THREE.CylinderGeometry(1.2, 1.6, 12, 8), d), accent);
      chimney.position.set(3.5, 6, -2.5);
      g.add(hall, chimney);
      break;
    }
    case "dam": {
      const wall = mesh(track(new THREE.BoxGeometry(22, 11, 3), d), stone);
      wall.position.y = 5.5;
      const sluice = mesh(track(new THREE.BoxGeometry(4, 8, 3.6), d), accent);
      sluice.position.y = 4;
      g.add(wall, sluice);
      break;
    }
    case "station": {
      const platform = mesh(track(new THREE.BoxGeometry(12, 1.2, 7), d), stone);
      platform.position.y = 0.6;
      const roof = mesh(track(new THREE.BoxGeometry(13, 0.6, 8), d), accent);
      roof.position.y = 6;
      for (const px of [-5, 5]) {
        for (const pz of [-3, 3]) {
          const post = mesh(track(new THREE.BoxGeometry(0.6, 5, 0.6), d), stone);
          post.position.set(px, 3, pz);
          g.add(post);
        }
      }
      g.add(platform, roof);
      break;
    }
    case "ring": {
      const count = 8;
      const ringGeo = track(new THREE.BoxGeometry(1.4, 6, 1.4), d);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2;
        const post = mesh(ringGeo, i % 2 === 0 ? stone : accent);
        post.position.set(Math.cos(a) * 6, 3, Math.sin(a) * 6);
        g.add(post);
      }
      break;
    }
    case "mirror": {
      const frame = mesh(track(new THREE.BoxGeometry(14, 10, 1), d), stone);
      frame.position.y = 5;
      const glassMat = mat(0xdfe9ff, d, { metalness: 0.9, roughness: 0.08 });
      const glass = mesh(track(new THREE.BoxGeometry(12, 8, 0.4), d), glassMat);
      glass.position.set(0, 5, 0.6);
      g.add(frame, glass);
      break;
    }
  }
  return g;
}
