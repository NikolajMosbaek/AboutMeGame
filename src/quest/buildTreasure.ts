import * as THREE from "three";
import type { Landmarks } from "../world/landmarks.ts";

/** Local position of the dig patch inside the fig site (landmarks.ts places
 *  the loose-soil disc there — the treasure rises from the same spot). */
const DIG_LOCAL = new THREE.Vector3(2.9, 0, 2.9);

export interface Treasure {
  /** World XZ of the dig patch (the quest's proximity target). */
  digPoint: { x: number; z: number };
  /** Raise the chest + idol out of the ground (idempotent). */
  reveal(): void;
  /** Drive the idol's emissive intensity live — the treasure finale pulses it
   *  (1.1 → 2.5 → 1.4) so the bloom blooms at the win. */
  setIdolEmissive(intensity: number): void;
  dispose(): void;
}

/**
 * The buried treasure (pivot slice G): an opened chest with the Emerald Idol,
 * mounted as a HIDDEN child of the fig site's group — it inherits the site's
 * transform, so the dig patch's local spot is the one source of where the
 * treasure is (buildLandmarks owns the patch, this module matches it).
 * `reveal()` flips it visible when the dig completes. The idol is emissive
 * past the bloom threshold: the win glows.
 */
export function buildTreasure(landmarks: Landmarks): Treasure {
  const fig = landmarks.placed.find((p) => p.poiId === "site-ancient-fig");
  if (!fig) throw new Error("buildTreasure: no site-ancient-fig in landmarks");

  const disposables: Array<{ dispose(): void }> = [];
  const group = new THREE.Group();
  group.name = "treasure";
  group.position.copy(DIG_LOCAL);
  group.visible = false;

  const wood = new THREE.MeshStandardMaterial({ color: 0x5a4226, flatShading: true, roughness: 0.8 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x8a7440, flatShading: true, roughness: 0.5, metalness: 0.4 });
  // The idol: emissive green-gold past the 0.85 bloom threshold — the one
  // deliberate glow of the whole expedition.
  const idolMat = new THREE.MeshStandardMaterial({
    color: 0x2e8b57,
    flatShading: true,
    roughness: 0.25,
    metalness: 0.6,
    emissive: 0x9fe6b0,
    emissiveIntensity: 1.1,
  });
  disposables.push(wood, trim, idolMat);

  const track = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };

  // Chest: box + tilted-open lid, half out of the broken soil.
  const base = new THREE.Mesh(track(new THREE.BoxGeometry(1.2, 0.7, 0.8)), wood);
  base.position.y = 0.3;
  const lid = new THREE.Mesh(track(new THREE.BoxGeometry(1.2, 0.18, 0.8)), wood);
  lid.position.set(-0.15, 0.78, 0);
  lid.rotation.z = 0.9; // thrown open
  const band = new THREE.Mesh(track(new THREE.BoxGeometry(1.26, 0.12, 0.2)), trim);
  band.position.y = 0.42;
  // The idol standing in the chest: a stacked figure — base, body, head.
  const idol = new THREE.Group();
  const idolBase = new THREE.Mesh(track(new THREE.CylinderGeometry(0.16, 0.2, 0.12, 6)), idolMat);
  const idolBody = new THREE.Mesh(track(new THREE.CylinderGeometry(0.1, 0.16, 0.34, 6)), idolMat);
  idolBody.position.y = 0.22;
  const idolHead = new THREE.Mesh(track(new THREE.DodecahedronGeometry(0.13)), idolMat);
  idolHead.position.y = 0.46;
  idol.add(idolBase, idolBody, idolHead);
  idol.position.set(0.1, 0.62, 0);

  for (const m of [base, lid, band]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  group.add(base, lid, band, idol);
  fig.object.add(group);

  const worldPos = new THREE.Vector3();
  fig.object.updateMatrixWorld(true);
  worldPos.copy(DIG_LOCAL).applyMatrix4(fig.object.matrixWorld);

  return {
    digPoint: { x: worldPos.x, z: worldPos.z },
    reveal() {
      group.visible = true;
    },
    setIdolEmissive(intensity) {
      idolMat.emissiveIntensity = intensity;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
