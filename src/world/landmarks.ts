import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { POI_ANCHORS, type SiteArchetype } from "./worldConfig.ts";
import type { Terrain } from "./terrain.ts";

export interface PlacedLandmark {
  poiId: string;
  label: string;
  /** World position of the site's base (on the terrain). */
  position: THREE.Vector3;
  /** The group containing the structure (named `landmark:<poiId>`). */
  object: THREE.Object3D;
  color: number;
}

export interface Landmarks {
  group: THREE.Group;
  placed: PlacedLandmark[];
  dispose(): void;
}

// Site palette — muted, weathered, jungle-appropriate. Colours ride per-vertex
// `color` attributes over two shared materials (stone + accent), the same
// merged-geometry idiom the old landmarks used, so a whole site stays ≤2 draws.
const WOOD = 0x6e4f2f;
const CANVAS = 0xc4b48a;
const STONE = 0x8d8778;
const MOSSY = 0x6f7a5a;
const BONE = 0xd8d1bf;
const RUIN = 0x99917d;
const SOIL = 0x46341f;
const CHARCOAL = 0x2b2b2b;
const FIG_BARK = 0x5d4a33;
const FIG_LEAF = 0x2e4f26;
const PAGE = 0xfaf6ea;
const EYE = 0xd8c07a;

/**
 * Place the 6 expedition sites (pivot slice C — replaces the 13 sci-fi
 * landmarks and their sky-beacons). Each anchor gets a hand-shaped, grounded
 * prop cluster (its `archetype`): the camp you wake at, the wrecked canoe, the
 * carved overhang, the lost expedition's last camp, the fallen ruin, and the
 * ancient fig over the dig site. No beacons — the clue TEXTS navigate (read
 * the world, follow the compass), which is the game. Each site group is named
 * `landmark:<poiId>` and recorded in `placed`, so the quest attaches triggers
 * and the journal/nav read the same positions. No content text lives here.
 *
 * One characterful detail the clue chain depends on: the ruin's fallen statue
 * head is rotated so its gaze line points at the ancient fig — clue 5 tells the
 * player to sight along the eyes, and the world honours it.
 *
 * Geometry discipline: every sub-primitive bakes its transform, then merges
 * into ONE stone-material mesh + ONE accent mesh per site (`mergeGeometries`),
 * with the palette in per-vertex colour. The accent material glows faintly
 * (journal page, carvings, the statue's eyes) so the interactable focus of
 * each site reads at dusk without breaking realism.
 */
export function buildLandmarks(terrain: Terrain): Landmarks {
  const group = new THREE.Group();
  group.name = "landmarks";
  const disposables: Array<{ dispose(): void }> = [];
  const placed: PlacedLandmark[] = [];

  const stone = new THREE.MeshStandardMaterial({
    flatShading: true,
    roughness: 0.85,
    vertexColors: true,
  });
  // The accents are the scene's genuine bloom sources now that the beacons and
  // tower lamp are gone: at intensity 1.0 the pale page/eye hues clear the
  // compositor's 0.85 threshold as faint, focused glints on each site's
  // interactable focus (dusk fireflies join them in the wildlife slice).
  const accent = new THREE.MeshStandardMaterial({
    flatShading: true,
    roughness: 0.55,
    vertexColors: true,
    emissive: 0xffffff,
    emissiveIntensity: 1.0,
  });
  disposables.push(stone, accent);

  const fig = POI_ANCHORS.find((a) => a.archetype === "figtree");

  for (const anchor of POI_ANCHORS) {
    const y = Math.max(terrain.heightAt(anchor.x, anchor.z), 0.2);
    const position = new THREE.Vector3(anchor.x, y, anchor.z);

    const site = new THREE.Group();
    site.name = `landmark:${anchor.poiId}`;
    site.position.copy(position);

    site.add(buildSite(anchor.archetype, stone, accent, disposables));

    // The statue's gaze: rotate the ruin so the fallen head looks at the fig.
    if (anchor.archetype === "ruin" && fig) {
      site.rotation.y = Math.atan2(fig.x - anchor.x, fig.z - anchor.z);
    } else {
      // Deterministic per-site yaw for variety (golden-angle hash of order).
      site.rotation.y = (anchor.order * 2.399963) % (Math.PI * 2);
    }

    group.add(site);
    placed.push({
      poiId: anchor.poiId,
      label: anchor.label,
      position,
      object: site,
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

/** Merge a set of prepped local-space geometries into one mesh (or null). */
function mergeSet(
  sources: THREE.BufferGeometry[],
  material: THREE.Material,
  disposables: Array<{ dispose(): void }>,
): THREE.Mesh | null {
  if (sources.length === 0) return null;
  const merged = mergeGeometries(sources, false);
  for (const src of sources) src.dispose();
  if (!merged) return null;
  disposables.push(merged);
  const m = new THREE.Mesh(merged, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Bake a transform into a geometry (mergeGeometries ignores Object3D). */
function place(
  geo: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  s = 1,
): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(s, s, s),
  );
  geo.applyMatrix4(m);
  return geo;
}

/** Build one site's local-space structure: ≤1 stone mesh + ≤1 accent mesh. */
function buildSite(
  archetype: SiteArchetype,
  stone: THREE.Material,
  accent: THREE.Material,
  disposables: Array<{ dispose(): void }>,
): THREE.Group {
  const g = new THREE.Group();
  const s: THREE.BufferGeometry[] = []; // stone-material set
  const a: THREE.BufferGeometry[] = []; // accent-material set

  switch (archetype) {
    case "camp": {
      // Pyramid tent, cold fire ring with crossed charred logs, stacked supply
      // crates, and the torn journal page (accent) pinned on the top crate.
      s.push(place(prep(new THREE.ConeGeometry(2.1, 2.3, 4), CANVAS), 0, 1.15, 0, 0, Math.PI / 4));
      for (let i = 0; i < 6; i++) {
        const t = (i / 6) * Math.PI * 2;
        s.push(place(prep(new THREE.DodecahedronGeometry(0.28), STONE), Math.cos(t) * 1.1 + 3.2, 0.18, Math.sin(t) * 1.1 + 1.6));
      }
      s.push(place(prep(new THREE.CylinderGeometry(0.09, 0.11, 1.3, 5), CHARCOAL), 3.2, 0.28, 1.6, 0, 0, Math.PI / 2.2));
      s.push(place(prep(new THREE.CylinderGeometry(0.09, 0.11, 1.2, 5), CHARCOAL), 3.1, 0.24, 1.7, Math.PI / 2.3, 0.6, 0));
      s.push(place(prep(new THREE.BoxGeometry(0.9, 0.9, 0.9), WOOD), -2.4, 0.45, 1.8, 0, 0.4));
      s.push(place(prep(new THREE.BoxGeometry(0.8, 0.8, 0.8), WOOD), -2.1, 1.3, 1.6, 0, 0.9));
      a.push(place(prep(new THREE.BoxGeometry(0.4, 0.03, 0.55), PAGE), -2.1, 1.72, 1.6, 0, 0.7));
      break;
    }
    case "canoe": {
      // Snapped hull in two pieces, half beached, plus the carved paddle
      // leaning on the bow (the blade note is the accent).
      s.push(place(prep(new THREE.CylinderGeometry(0.85, 0.85, 3.4, 6), WOOD), 0, 0.35, 0, 0, 0.3, Math.PI / 2));
      s.push(place(prep(new THREE.CylinderGeometry(0.8, 0.8, 1.8, 6), WOOD), 2.6, 0.28, 0.9, 0.15, 1.1, Math.PI / 2));
      s.push(place(prep(new THREE.BoxGeometry(0.08, 1.5, 0.14), WOOD), -1.4, 0.75, 1.2, 0.5, 0, 0.4));
      a.push(place(prep(new THREE.BoxGeometry(0.02, 0.55, 0.3), PAGE), -1.15, 1.05, 1.45, 0.5, 0, 0.4));
      break;
    }
    case "overhang": {
      // Two rock masses carrying a slab brow over a sheltered back wall; the
      // carvings are a strip of glyph discs (accent) at reading height.
      s.push(place(prep(new THREE.DodecahedronGeometry(1.7), MOSSY), -2.2, 1.5, 0, 0.3, 0.5, 0, 1.15));
      s.push(place(prep(new THREE.DodecahedronGeometry(1.5), MOSSY), 2.3, 1.3, 0.2, 0.7, 1.3));
      s.push(place(prep(new THREE.BoxGeometry(6.4, 1.1, 4.2), STONE), 0, 3.3, -0.3, 0.08, 0, -0.06));
      s.push(place(prep(new THREE.DodecahedronGeometry(2.2), STONE), 0, 1.6, -2.2, 0.2, 0.9, 0, 1.2));
      for (let i = 0; i < 5; i++) {
        a.push(place(prep(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 8), EYE), -1.2 + i * 0.6, 1.5 + (i % 2) * 0.35, -0.75, Math.PI / 2));
      }
      break;
    }
    case "remains": {
      // The cairn built to be found, the rotted pack, scattered bones, and the
      // oilcloth-wrapped map corner (accent) at the cairn's foot.
      const sizes = [0.9, 0.72, 0.56, 0.4, 0.26];
      let h = 0;
      for (let i = 0; i < sizes.length; i++) {
        h += sizes[i] * 0.85;
        s.push(place(prep(new THREE.DodecahedronGeometry(sizes[i]), MOSSY), 0, h, 0, 0.2 * i, i * 1.1));
      }
      s.push(place(prep(new THREE.BoxGeometry(0.9, 1.1, 0.5), WOOD), 1.6, 0.5, 0.4, 0.15, 0.5, -0.35));
      s.push(place(prep(new THREE.CylinderGeometry(0.05, 0.06, 0.9, 5), BONE), -1.2, 0.1, 1.0, 0, 0, Math.PI / 2.1));
      s.push(place(prep(new THREE.CylinderGeometry(0.05, 0.06, 0.7, 5), BONE), -1.5, 0.09, 0.5, 0, 1.1, Math.PI / 1.9));
      s.push(place(prep(new THREE.DodecahedronGeometry(0.22), BONE), -1.9, 0.16, 0.9));
      a.push(place(prep(new THREE.BoxGeometry(0.45, 0.04, 0.35), PAGE), 0.8, 0.12, 0.9, 0, 0.4));
      break;
    }
    case "ruin": {
      // A broken wall in three leaning segments, rubble, R.'s abandoned pits,
      // and the fallen statue head. The head gazes along local +Z; the parent
      // group's rotation aims that gaze at the fig (see buildLandmarks).
      s.push(place(prep(new THREE.BoxGeometry(3.2, 2.6, 0.8), RUIN), -3.4, 1.3, -1.5, 0, 0.15, 0.05));
      s.push(place(prep(new THREE.BoxGeometry(2.2, 1.7, 0.8), RUIN), -0.4, 0.85, -1.9, 0, 0.05, -0.08));
      s.push(place(prep(new THREE.BoxGeometry(1.6, 3.1, 0.8), RUIN), 2.6, 1.55, -1.6, 0, -0.1, 0.12));
      s.push(place(prep(new THREE.DodecahedronGeometry(0.5), RUIN), 1.2, 0.3, -0.8, 0, 2.2));
      s.push(place(prep(new THREE.DodecahedronGeometry(0.35), RUIN), -1.8, 0.22, -0.6, 0, 0.7));
      for (const [px, pz] of [[-2.2, 1.8], [0.6, 2.6], [2.8, 1.2]] as const) {
        s.push(place(prep(new THREE.CylinderGeometry(0.9, 0.9, 0.1, 10), SOIL), px, 0.02, pz));
      }
      s.push(place(prep(new THREE.DodecahedronGeometry(1.35), STONE), 0.4, 1.0, 0.8, 0.35, 0, 1.25, 1.1));
      s.push(place(prep(new THREE.ConeGeometry(0.32, 0.7, 4), STONE), 0.4, 1.05, 2.0, Math.PI / 2, 0, 0));
      a.push(place(prep(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 8), EYE), -0.05, 1.55, 1.85, Math.PI / 2));
      a.push(place(prep(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 8), EYE), 0.85, 1.55, 1.85, Math.PI / 2));
      break;
    }
    case "figtree": {
      // The ancient strangler fig: tapered trunk, six buttress roots, a wide
      // triple-blob canopy, the loose-soil dig patch and the dropped shovel
      // (accent blade). The dig interaction (quest slice) anchors at the patch.
      s.push(place(prep(new THREE.CylinderGeometry(1.2, 2.3, 11, 7), FIG_BARK), 0, 5.5, 0));
      for (let i = 0; i < 6; i++) {
        const t = (i / 6) * Math.PI * 2 + 0.35;
        s.push(
          place(prep(new THREE.BoxGeometry(0.55, 2.6, 2.6), FIG_BARK), Math.cos(t) * 2.2, 1.0, Math.sin(t) * 2.2, 0.35, -t + Math.PI / 2, 0),
        );
      }
      s.push(place(prep(new THREE.DodecahedronGeometry(4.6), FIG_LEAF), 0, 12.4, 0, 0, 0, 0, 1.15));
      s.push(place(prep(new THREE.DodecahedronGeometry(3.6), FIG_LEAF), 3.4, 10.8, 1.8, 0, 1.2));
      s.push(place(prep(new THREE.DodecahedronGeometry(3.2), FIG_LEAF), -3.2, 11.2, -1.4, 0, 2.1));
      s.push(place(prep(new THREE.CylinderGeometry(1.5, 1.7, 0.18, 12), SOIL), 2.9, 0.06, 2.9));
      s.push(place(prep(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 5), WOOD), 4.0, 0.5, 3.4, 0, 0, 1.0));
      a.push(place(prep(new THREE.BoxGeometry(0.3, 0.04, 0.42), STONE), 4.55, 0.14, 3.75, 0, 0.5));
      break;
    }
    default: {
      const _exhaustive: never = archetype;
      return _exhaustive;
    }
  }

  const stoneSet = mergeSet(s, stone, disposables);
  const accentSet = mergeSet(a, accent, disposables);
  if (stoneSet) g.add(stoneSet);
  if (accentSet) g.add(accentSet);
  return g;
}
