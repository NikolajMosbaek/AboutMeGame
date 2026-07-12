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
 *
 * Objects slice 1 ("make the objects look like what they really are" —
 * "the idol deserves special care") upgrades both procedurally: no CC0 model
 * fits the game's MacGuffin (it needs an exact, hand-tuned envelope to sit
 * inside the chest and carry the emissive-eyes/glow contract), and an
 * open-lid chest with a real hinge isn't something the CC0 kits' authored
 * "closed" pose can give without fragile per-part re-export engineering — see
 * this slice's run log for the full trade record. `setIdolEmissive`'s
 * contract stays byte-compatible: it still drives exactly ONE shared
 * `idolMat.emissiveIntensity`, just across more (all-idol) parts than before.
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

  // Chest: box + tilted-open lid, half out of the broken soil, now with
  // corner straps + a latch (both `trim`) for an iron-bound-coffer read
  // instead of a bare box.
  const base = new THREE.Mesh(track(new THREE.BoxGeometry(1.2, 0.7, 0.8)), wood);
  base.position.y = 0.3;
  const lid = new THREE.Mesh(track(new THREE.BoxGeometry(1.2, 0.18, 0.8)), wood);
  lid.position.set(-0.15, 0.78, 0);
  lid.rotation.z = 0.9; // thrown open
  const band = new THREE.Mesh(track(new THREE.BoxGeometry(1.26, 0.12, 0.2)), trim);
  band.position.y = 0.42;
  const strapGeo = track(new THREE.BoxGeometry(0.1, 0.72, 0.06));
  const strapL = new THREE.Mesh(strapGeo, trim);
  strapL.position.set(-0.48, 0.3, 0.41);
  const strapR = new THREE.Mesh(strapGeo, trim);
  strapR.position.set(0.48, 0.3, 0.41);
  const latch = new THREE.Mesh(track(new THREE.BoxGeometry(0.14, 0.1, 0.05)), trim);
  latch.position.set(0, 0.5, 0.42);

  // The idol standing in the chest: a real carved-statue silhouette — a
  // stepped plinth base, a tapered robed body with crossed-arm blocks, a
  // shoulder collar, and a crowned head — rather than the previous plain
  // 3-primitive stack (cylinder/cylinder/dodecahedron). Same overall envelope
  // (footprint radius ~0.22, height ~0.7) so it still sits snugly inside the
  // chest at the same local offset.
  const idol = new THREE.Group();
  const idolBase = new THREE.Mesh(track(new THREE.CylinderGeometry(0.18, 0.22, 0.09, 8)), idolMat);
  const idolRiser = new THREE.Mesh(track(new THREE.CylinderGeometry(0.14, 0.17, 0.05, 8)), idolMat);
  idolRiser.position.y = 0.07;
  const idolBody = new THREE.Mesh(track(new THREE.CylinderGeometry(0.1, 0.15, 0.3, 6)), idolMat);
  idolBody.position.y = 0.245;
  const armGeo = track(new THREE.BoxGeometry(0.05, 0.14, 0.07));
  const idolArmL = new THREE.Mesh(armGeo, idolMat);
  idolArmL.position.set(-0.1, 0.28, 0.05);
  idolArmL.rotation.z = 0.3;
  const idolArmR = new THREE.Mesh(armGeo, idolMat);
  idolArmR.position.set(0.1, 0.28, 0.05);
  idolArmR.rotation.z = -0.3;
  const idolCollar = new THREE.Mesh(track(new THREE.CylinderGeometry(0.105, 0.09, 0.045, 8)), idolMat);
  idolCollar.position.y = 0.4175;
  const idolHead = new THREE.Mesh(track(new THREE.DodecahedronGeometry(0.1)), idolMat);
  idolHead.position.y = 0.5;
  const idolCrown = new THREE.Mesh(track(new THREE.ConeGeometry(0.06, 0.09, 5)), idolMat);
  idolCrown.position.y = 0.615;
  idol.add(idolBase, idolRiser, idolBody, idolArmL, idolArmR, idolCollar, idolHead, idolCrown);
  idol.position.set(0.1, 0.62, 0);

  for (const m of [base, lid, band, strapL, strapR, latch]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  for (const m of idol.children) {
    (m as THREE.Mesh).castShadow = true;
    (m as THREE.Mesh).receiveShadow = true;
  }
  group.add(base, lid, band, strapL, strapR, latch, idol);
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
