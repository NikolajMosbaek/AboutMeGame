import * as THREE from "three";
import { WORLD } from "./worldConfig.ts";

export interface Boundaries {
  group: THREE.Group;
  /** True while (x,z) is inside the soft boundary. */
  isInBounds(x: number, z: number): boolean;
  /** Push a position back to the boundary ring if it strayed past it. Epic 3
   *  movement calls this so the player can't drive/fly off the world. */
  clampToBounds(pos: THREE.Vector3): void;
  dispose(): void;
}

/**
 * World boundaries (#21): a wide water plane the island sits in, and the
 * boundary maths that keeps the player on the map. The water is the visual
 * "you can't go further"; `clampToBounds` is the mechanism Epic 3 enforces.
 */
export function buildBoundaries(): Boundaries {
  const group = new THREE.Group();
  group.name = "boundaries";

  const waterGeo = new THREE.PlaneGeometry(WORLD.size * 3, WORLD.size * 3);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x2e6f9e,
    transparent: true,
    opacity: 0.82,
    roughness: 0.25,
    metalness: 0.1,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = WORLD.seaLevel - 0.05;
  water.receiveShadow = false;
  water.name = "water";
  group.add(water);

  const r = WORLD.boundaryRadius;
  const isInBounds = (x: number, z: number) => x * x + z * z < r * r;
  const clampToBounds = (pos: THREE.Vector3) => {
    const d = Math.hypot(pos.x, pos.z);
    if (d > r) {
      const s = r / d;
      pos.x *= s;
      pos.z *= s;
    }
  };

  return {
    group,
    isInBounds,
    clampToBounds,
    dispose() {
      waterGeo.dispose();
      waterMat.dispose();
    },
  };
}
