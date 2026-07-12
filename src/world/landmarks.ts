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
  /** The two shared per-site materials (stone + accent) — exposed so
   *  `landmarksUpgrade.ts` (Objects slice 1) can build a REPLACEMENT site
   *  group that reuses the SAME material instances (never a second material
   *  context, keeping the "2 shared materials across the whole site set"
   *  contract `landmarks.test.ts` pins) when it swaps in the CC0 camp/canoe/
   *  ruin models on medium/high. */
  materials: { stone: THREE.MeshStandardMaterial; accent: THREE.MeshStandardMaterial };
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
 *
 * Objects slice 1 ("make the objects look like what they really are") adds a
 * SECOND, optional path through the SAME `buildSite` function
 * (`modelGeometry`): on medium/high, `landmarksUpgrade.ts` calls `buildSite`
 * again with a loaded CC0-model geometry map and swaps the resulting group in
 * for the plain-procedural one, at the SAME site anchor. Branching inside one
 * function (rather than a second copy of the geometry code) is what keeps the
 * always-procedural pieces — the ruin's gaze rig, the fig/overhang/remains
 * story pieces no CC0 model fits — a single source of truth no upgrade path
 * can drift from.
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
    materials: { stone, accent },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/**
 * Stamp a uniform per-vertex `color` on a geometry and convert it to
 * non-indexed so every merge source shares `{position,normal,color}` and
 * `mergeGeometries` returns non-null. No `mergeVertices` — flat shading wants
 * hard normals. Drops `uv` (three's built-in primitives carry one, but
 * nothing here ever samples a texture, `vertexColors: true` with no `map`) so
 * this geometry's attribute SET matches a loaded CC0 object-model geometry's
 * exactly (`floraGlb.ts`'s parser only ever produces position/normal/color) —
 * `mergeGeometries` requires an EXACT attribute-set match across every source
 * or it fails (returns `null`, logging a console error, no throw), which
 * would otherwise silently drop a whole site's stone mesh the moment
 * `buildSite`'s model branch mixes procedural "keep" pieces (the ruin's gaze
 * rig, remains' cairn/pack/bones) with model geometry in the SAME merge. The
 * geometry is mutated in place and returned.
 */
function prep(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const flat = geo.index ? geo.toNonIndexed() : geo;
  if (flat !== geo) geo.dispose();
  flat.deleteAttribute("uv");
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

/** Dequantize `position`/`normal`/`color` into plain, non-normalized
 *  `Float32Array` attributes (`BufferAttribute.getComponent` already applies
 *  the normalized-integer decode for a `normalized: true` source, so this is
 *  a correct read-back, not a re-interpretation). `floraGlb.ts`'s parser
 *  hands back `KHR_mesh_quantization`'s packed Int16/Uint8 attributes
 *  (`normalized: true`) — TWO real bugs otherwise follow from feeding that
 *  straight into `buildSite`'s model branch: (1) `place()`'s
 *  `geo.applyMatrix4()` writes back through `BufferAttribute.setX/Y/Z`, which
 *  RE-QUANTIZES any value it writes into a still-`normalized: true` int16
 *  store — exactly the silent two's-complement overflow/corruption
 *  `floraGlb.ts`'s own header doc warns about for the pipeline's node-
 *  transform step, here triggered by a placement transform instead; (2)
 *  `mergeGeometries` requires an IDENTICAL typed-array class across every
 *  merge source per attribute — mixing a model's `Int16Array`/`Uint8Array`
 *  with a procedural piece's `Float32Array` (the ruin's gaze rig, remains'
 *  cairn/pack/bones) fails outright (confirmed via a real console error,
 *  `mergeAttributes` refusing the mismatched array types), silently dropping
 *  the whole site's stone mesh. Dequantizing up front — a few hundred
 *  vertices, once per swap, not a per-frame cost — fixes both. */
function dequantize(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "color"] as const) {
    const attr = geo.getAttribute(name);
    if (!attr) continue;
    const itemSize = attr.itemSize;
    const arr = new Float32Array(attr.count * itemSize);
    for (let i = 0; i < attr.count; i++) {
      for (let c = 0; c < itemSize; c++) arr[i * itemSize + c] = attr.getComponent(i, c);
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, itemSize, false));
  }
  return out;
}

/** Look up a CC0 object-model geometry by name and CLONE + dequantize it
 *  before baking a per-placement transform (`place()` mutates in place, and
 *  some archetypes — the ruin's two wall segments — place the SAME named
 *  model more than once). Also converts to non-indexed, matching `prep()`'s
 *  own conversion: `mergeGeometries` requires every source to agree on
 *  indexed-ness too, or it fails outright (silently dropping the whole site's
 *  stone mesh). Throws if the name is missing: `landmarksUpgrade.ts` only
 *  ever calls `buildSite` with a map it already confirmed holds every name
 *  that archetype's placements reference, so a miss here is a real
 *  programming error, not a runtime possibility worth swallowing silently. */
function modelGeo(models: Map<string, THREE.BufferGeometry>, name: string): THREE.BufferGeometry {
  const src = models.get(name);
  if (!src) throw new Error(`landmarks: no loaded model geometry named "${name}"`);
  const cloned = src.clone();
  const flat = cloned.index ? cloned.toNonIndexed() : cloned;
  if (flat !== cloned) cloned.dispose();
  const plain = dequantize(flat);
  flat.dispose();
  return plain;
}

/**
 * The ruin's statue-gaze rig + narrative soil pits — geometry that MUST stay
 * procedural even after the medium/high model upgrade replaces the ruin's
 * leaning-wall/rubble primitives with real worked-stone CC0 models (no CC0
 * model fits a fallen idol's carved head, and the head's local +Z facing is
 * the ONE piece of world truth clue 5 depends on — `buildLandmarks` rotates
 * the whole site so that gaze points at the fig). Exported so `buildSite`'s
 * two paths (plain procedural / model-upgraded) share ONE definition — the
 * upgrade path can never drift from the gaze convention's exact geometry.
 * The head gets a small brow-ridge block for a more deliberate, carved
 * silhouette (Objects slice 1) — everything else is unchanged from the
 * pre-slice geometry.
 */
export function ruinGazeRig(): { stone: THREE.BufferGeometry[]; accent: THREE.BufferGeometry[] } {
  return {
    stone: [
      place(prep(new THREE.DodecahedronGeometry(1.35), STONE), 0.4, 1.0, 0.8, 0.35, 0, 1.25, 1.1),
      // Brow ridge: a small angled slab over the eye-line, giving the fallen
      // head a carved brow instead of a bare faceted boulder.
      place(prep(new THREE.BoxGeometry(0.62, 0.22, 0.3), STONE), 0.4, 1.42, 1.55, 0.25, 0, 0),
      place(prep(new THREE.ConeGeometry(0.32, 0.7, 4), STONE), 0.4, 1.05, 2.0, Math.PI / 2, 0, 0),
      ...([[-2.2, 1.8], [0.6, 2.6], [2.8, 1.2]] as const).map(([px, pz]) =>
        place(prep(new THREE.CylinderGeometry(0.9, 0.9, 0.1, 10), SOIL), px, 0.02, pz),
      ),
    ],
    accent: [
      place(prep(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 8), EYE), -0.05, 1.55, 1.85, Math.PI / 2),
      place(prep(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 8), EYE), 0.85, 1.55, 1.85, Math.PI / 2),
    ],
  };
}

/**
 * Build one site's local-space structure: ≤1 stone mesh + ≤1 accent mesh (the
 * plain-procedural path, `modelGeometry` omitted — used by `buildLandmarks`
 * on every tier and is what `landmarks.test.ts` pins). When `modelGeometry`
 * IS given (Objects slice 1's medium/high upgrade, `landmarksUpgrade.ts`),
 * camp/canoe/ruin substitute real CC0 models for the primitives a model can
 * actually stand in for; remains ADDS the lost expedition's dropped tools
 * alongside its still-procedural cairn/pack/bones; overhang/figtree have no
 * CC0 model to substitute and are unconditionally upgraded procedurally
 * instead (applies on every tier, at zero extra cost).
 */
export function buildSite(
  archetype: SiteArchetype,
  stone: THREE.Material,
  accent: THREE.Material,
  disposables: Array<{ dispose(): void }>,
  modelGeometry?: Map<string, THREE.BufferGeometry>,
): THREE.Group {
  const g = new THREE.Group();
  const s: THREE.BufferGeometry[] = []; // stone-material set
  const a: THREE.BufferGeometry[] = []; // accent-material set

  switch (archetype) {
    case "camp": {
      // Pyramid tent, cold fire ring with crossed charred logs, stacked supply
      // crates, and the torn journal page (accent) pinned on the top crate —
      // or, on medium/high, a real CC0 tent/campfire/crate/barrel/bedroll set
      // (Objects slice 1) at the same footprint.
      if (modelGeometry) {
        s.push(place(modelGeo(modelGeometry, "tent"), 0, 0, 0, 0, Math.PI / 4));
        s.push(place(modelGeo(modelGeometry, "campfire"), 3.2, 0, 1.6, 0, 0.4));
        s.push(place(modelGeo(modelGeometry, "crate"), -2.4, 0, 1.8, 0, 0.4));
        s.push(place(modelGeo(modelGeometry, "crate-open"), -2.1, 0.9, 1.6, 0, 0.9));
        s.push(place(modelGeo(modelGeometry, "barrel"), -1.1, 0, 2.7, 0, 1.2));
        s.push(place(modelGeo(modelGeometry, "bedroll"), 0.8, 0, -1.6, 0, 1.6));
      } else {
        s.push(place(prep(new THREE.ConeGeometry(2.1, 2.3, 4), CANVAS), 0, 1.15, 0, 0, Math.PI / 4));
        for (let i = 0; i < 6; i++) {
          const t = (i / 6) * Math.PI * 2;
          s.push(place(prep(new THREE.DodecahedronGeometry(0.28), STONE), Math.cos(t) * 1.1 + 3.2, 0.18, Math.sin(t) * 1.1 + 1.6));
        }
        s.push(place(prep(new THREE.CylinderGeometry(0.09, 0.11, 1.3, 5), CHARCOAL), 3.2, 0.28, 1.6, 0, 0, Math.PI / 2.2));
        s.push(place(prep(new THREE.CylinderGeometry(0.09, 0.11, 1.2, 5), CHARCOAL), 3.1, 0.24, 1.7, Math.PI / 2.3, 0.6, 0));
        s.push(place(prep(new THREE.BoxGeometry(0.9, 0.9, 0.9), WOOD), -2.4, 0.45, 1.8, 0, 0.4));
        s.push(place(prep(new THREE.BoxGeometry(0.8, 0.8, 0.8), WOOD), -2.1, 1.3, 1.6, 0, 0.9));
      }
      a.push(place(prep(new THREE.BoxGeometry(0.4, 0.03, 0.55), PAGE), -2.1, 1.72, 1.6, 0, 0.7));
      break;
    }
    case "canoe": {
      // Snapped hull in two pieces, half beached, plus the carved paddle
      // leaning on the bow (the blade note is the accent) — or, on medium/
      // high, a real CC0 rowboat hull (already carrying its own paddles).
      if (modelGeometry) {
        s.push(place(modelGeo(modelGeometry, "canoe-hull"), 0, 0, 0, 0.08, 0.3, 0));
      } else {
        s.push(place(prep(new THREE.CylinderGeometry(0.85, 0.85, 3.4, 6), WOOD), 0, 0.35, 0, 0, 0.3, Math.PI / 2));
        s.push(place(prep(new THREE.CylinderGeometry(0.8, 0.8, 1.8, 6), WOOD), 2.6, 0.28, 0.9, 0.15, 1.1, Math.PI / 2));
        s.push(place(prep(new THREE.BoxGeometry(0.08, 1.5, 0.14), WOOD), -1.4, 0.75, 1.2, 0.5, 0, 0.4));
      }
      a.push(place(prep(new THREE.BoxGeometry(0.02, 0.55, 0.3), PAGE), -1.15, 1.05, 1.45, 0.5, 0, 0.4));
      break;
    }
    case "overhang": {
      // Two rock masses carrying a slab brow over a sheltered back wall; the
      // carvings are a strip of glyph discs (accent) at reading height. Each
      // pillar is a 2-lobe boulder cluster (a chunkier, less-spherical
      // silhouette than a single dodecahedron) and a thin backing slab sits
      // directly behind the glyphs so they read as carvings ON a wall, not
      // discs floating in space (Objects slice 1 procedural upgrade — no CC0
      // model fits a carved rock shelf, so the primitives themselves improve,
      // unconditionally, on every tier).
      s.push(place(prep(new THREE.DodecahedronGeometry(1.7), MOSSY), -2.2, 1.5, 0, 0.3, 0.5, 0, 1.15));
      s.push(place(prep(new THREE.DodecahedronGeometry(1.1), MOSSY), -3.1, 0.9, 1.0, 0.6, 1.4, 0, 1.0));
      s.push(place(prep(new THREE.DodecahedronGeometry(1.5), MOSSY), 2.3, 1.3, 0.2, 0.7, 1.3));
      s.push(place(prep(new THREE.DodecahedronGeometry(0.95), MOSSY), 3.2, 0.8, -0.6, 0.4, 2.0, 0, 1.0));
      s.push(place(prep(new THREE.BoxGeometry(6.4, 1.1, 4.2), STONE), 0, 3.3, -0.3, 0.08, 0, -0.06));
      s.push(place(prep(new THREE.DodecahedronGeometry(2.2), STONE), 0, 1.6, -2.2, 0.2, 0.9, 0, 1.2));
      s.push(place(prep(new THREE.BoxGeometry(3.4, 1.6, 0.25), STONE), -0.15, 1.5, -0.92, 0, 0, 0.02));
      for (let i = 0; i < 5; i++) {
        a.push(place(prep(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 8), EYE), -1.2 + i * 0.6, 1.5 + (i % 2) * 0.35, -0.75, Math.PI / 2));
      }
      break;
    }
    case "remains": {
      // The cairn built to be found, the rotted pack, scattered bones, and the
      // oilcloth-wrapped map corner (accent) at the cairn's foot — ALWAYS
      // procedural (no CC0 "rotted expedition pack" model fits). On medium/
      // high, the lost expedition's dropped tools (Objects slice 1: real CC0
      // axe/shovel models) lie in the grass alongside them.
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
      if (modelGeometry) {
        s.push(place(modelGeo(modelGeometry, "tool-axe"), 1.7, 0, 0.5, 0, 0.6, -0.3));
        s.push(place(modelGeo(modelGeometry, "tool-shovel"), -0.9, 0, 1.3, 0, 1.1, -0.2));
      }
      a.push(place(prep(new THREE.BoxGeometry(0.45, 0.04, 0.35), PAGE), 0.8, 0.12, 0.9, 0, 0.4));
      break;
    }
    case "ruin": {
      // A broken wall in three leaning segments, rubble, R.'s abandoned pits,
      // and the fallen statue head — or, on medium/high, real CC0 worked-stone
      // wall/column/rubble models in place of the leaning boxes/dodecahedra
      // (Objects slice 1). The gaze rig + soil pits (`ruinGazeRig`) stay
      // procedural on EVERY tier regardless — see that function's own doc.
      if (modelGeometry) {
        s.push(place(modelGeo(modelGeometry, "ruin-wall"), -3.4, 0, -1.5, 0, 0.15, 0));
        s.push(place(modelGeo(modelGeometry, "ruin-wall-damaged"), -0.4, 0, -1.9, 0, 0.05, 0));
        s.push(place(modelGeo(modelGeometry, "ruin-wall"), 2.6, 0, -1.6, 0, -0.1, 0, 1.15));
        s.push(place(modelGeo(modelGeometry, "ruin-column"), 1.2, 0, -0.8, 0, 2.2, 0));
        s.push(place(modelGeo(modelGeometry, "ruin-debris"), -1.8, 0, -0.6, 0, 0.7, 0));
      } else {
        s.push(place(prep(new THREE.BoxGeometry(3.2, 2.6, 0.8), RUIN), -3.4, 1.3, -1.5, 0, 0.15, 0.05));
        s.push(place(prep(new THREE.BoxGeometry(2.2, 1.7, 0.8), RUIN), -0.4, 0.85, -1.9, 0, 0.05, -0.08));
        s.push(place(prep(new THREE.BoxGeometry(1.6, 3.1, 0.8), RUIN), 2.6, 1.55, -1.6, 0, -0.1, 0.12));
        s.push(place(prep(new THREE.DodecahedronGeometry(0.5), RUIN), 1.2, 0.3, -0.8, 0, 2.2));
        s.push(place(prep(new THREE.DodecahedronGeometry(0.35), RUIN), -1.8, 0.22, -0.6, 0, 0.7));
      }
      const rig = ruinGazeRig();
      s.push(...rig.stone);
      a.push(...rig.accent);
      break;
    }
    case "figtree": {
      // The ancient strangler fig: tapered trunk, six buttress roots, a wide
      // triple-blob canopy, the loose-soil dig patch and the dropped shovel
      // (accent blade). ALWAYS procedural (no CC0 model fits a strangler fig's
      // buttress-root silhouette). Objects slice 1 deepens the roots and
      // splits the canopy into more, smaller-radius blobs for a less
      // spherical, more deliberately layered crown — unconditional, applies on
      // every tier at the same triangle order of magnitude.
      s.push(place(prep(new THREE.CylinderGeometry(1.2, 2.3, 11, 7), FIG_BARK), 0, 5.5, 0));
      for (let i = 0; i < 6; i++) {
        const t = (i / 6) * Math.PI * 2 + 0.35;
        s.push(
          place(prep(new THREE.BoxGeometry(0.55, 2.8, 2.9), FIG_BARK), Math.cos(t) * 2.3, 1.05, Math.sin(t) * 2.3, 0.4, -t + Math.PI / 2, 0),
        );
      }
      s.push(place(prep(new THREE.DodecahedronGeometry(4.2), FIG_LEAF), 0, 12.6, 0, 0, 0, 0, 1.1));
      s.push(place(prep(new THREE.DodecahedronGeometry(3.2), FIG_LEAF), 3.4, 11.0, 1.8, 0, 1.2));
      s.push(place(prep(new THREE.DodecahedronGeometry(2.9), FIG_LEAF), -3.2, 11.3, -1.4, 0, 2.1));
      s.push(place(prep(new THREE.DodecahedronGeometry(2.3), FIG_LEAF), 0.8, 13.6, -2.6, 0, 0.6));
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
