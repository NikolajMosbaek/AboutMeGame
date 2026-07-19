import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeNoise2D } from "./noise.ts";
import { LAGOON, POI_ANCHORS, RIVER, SPAWN, WORLD } from "./worldConfig.ts";
import { distToRiver, type Terrain } from "./terrain.ts";
import type { GroundPoint } from "./groundingShadows.ts";

export interface Props {
  group: THREE.Group;
  /** One grounding point per SOLID placed instance (canopy trees, palms,
   *  rocks — not the tiny understory plants), for the low tier's blob
   *  grounding shadows (G5 #160). Positions/scales mirror the instance
   *  matrices exactly — collected at placement, never recomputed. */
  groundPoints: GroundPoint[];
  /** One crown disc per placed canopy tree (crown radius scaled to the
   *  instance) — `canopyShade.ts` bakes the under-canopy ground darkening
   *  from these. Palms deliberately excluded: the shore stays open. */
  canopyCrowns: Array<{ x: number; z: number; r: number }>;
  dispose(): void;
}

// Instance budgets at density 1 (see docs/design/2026-07-08-the-lost-idol-design.md).
// `density` (0..1, from the quality scaler #47/#48) scales every count down
// together, so the low tier stays inside the mobile triangle budget while the
// jungle still reads as dense on high. Six `InstancedMesh` draw calls total —
// well under the ≤150 draw-call / frame budget — regardless of instance count.
//
// Jungle-density epic (2026-07-19, user finding "it feels like an island with
// some trees on"): full-density counts raised so the valley canopy closes and
// the floor crowds, with ~a third of the understory as eye-height tall ferns
// that break sightlines. Counts are sized against the 500k-triangle budget
// WITH the chunked frustum culling `floraUpgrade.ts` builds (worst-case
// panorama ≈ budget; a typical in-jungle frame pays far less — the numbers
// are in docs/perf-budget.md). The LOW tier's absolute load is held at the
// pre-epic floor by the matching `propDensity` drop in `src/perf/quality.ts`
// (0.4 → 0.2, pinned by quality.test.ts) AND by `fullFoliage=false` (low
// keeps the original crown scales and no tall ferns — its fill cost is
// unchanged, not just its instance count).
export const CANOPY_TREE_COUNT = 680;
export const PALM_COUNT = 72;
export const UNDERSTORY_COUNT = 2200;
export const ROCK_COUNT = 160;

/** Share of understory placements that come up as eye-height tall ferns, and
 *  their scale band (vs the regular 0.7–1.3 shrubs). Enclosure — the "I'm IN
 *  a jungle" read — comes from foliage at eye level, not knee level. Only
 *  with `fullFoliage` (medium/high, `quality.floraDetail === "full"`). */
export const TALL_FERN_SHARE = 0.32;
const TALL_FERN_SCALE_MIN = 1.9;
const TALL_FERN_SCALE_SPAN = 0.9;
/** Tall ferns only stand on near-flat ground — their ~1.5 u footprint floats
 *  visibly on the downhill side of anything steeper (review finding). Checked
 *  four-way (unlike the shared one-sided `gentleSlope`): a downhill drop on
 *  the unsampled side is exactly where a big fern's base shows air. */
const TALL_FERN_MAX_DROP = 1.0;

const POI_CLEARANCE = 10; // keep vegetation from crowding the expedition sites

// Palette — flat-shaded, vertex-coloured (docs/art-direction.md); no terrain
// textures on trunks/fronds/rocks, only the foliage cross-planes carry a
// procedural leaf texture (never a downloaded asset).
const WOOD_CANOPY = 0x5c4430;
const WOOD_PALM = 0x6b4a2f;
const FROND_GREEN = 0x4a7d3f;
const ROCK_MOSSY = 0x7c8272;
const FALLBACK_CANOPY_GREEN = 0x3f6f3a;
const FALLBACK_FERN_GREEN = 0x3a6b34;

const CANOPY_TRUNK_HEIGHT = 6.2;
const CANOPY_CROSS_WIDTH = 4.4;
const CANOPY_CROSS_HEIGHT = 3.6;
const UNDERSTORY_CROSS_WIDTH = 1.1;
const UNDERSTORY_CROSS_HEIGHT = 1.2;

const UP = new THREE.Vector3(0, 1, 0);

/** Grounding-disc radii per unit of instance scale (G5 #160) — sized to the
 *  visual footprint at the ground: a trunk flare, a palm base, a boulder. */
const CANOPY_GROUND_RADIUS = 1.4;
const PALM_GROUND_RADIUS = 1.1;
const ROCK_GROUND_RADIUS = 1.2;

/**
 * Jungle set dressing (pivot slice C, "The Lost Idol"). Replaces the old
 * conifer/rock scatter with layered vegetation banded by elevation
 * (`terrain.heightAt`): shore palms, dense valley-floor canopy trees +
 * understory, sparser highland trees + rocks, and mossy boulders throughout.
 *
 * Everything is an `InstancedMesh` — SIX draw calls total (canopy trunk,
 * canopy foliage cross, palm trunk, palm frond crown, understory cross,
 * rocks) however many thousand instances they hold — so the layer count and
 * density scale for free against the draw-call budget. Canopy/foliage crosses
 * are two crossed STATIC planes (an "X", not a camera-facing billboard, which
 * would fight the animated day-cycle sun) on a lit material with a
 * `THREE.CanvasTexture` leaf pattern generated at runtime — no downloaded
 * assets — and `alphaTest` cutout (never `transparent: true`, which would
 * fight depth sorting at this instance count). Trunks/fronds/rocks are plain
 * flat-shaded, vertex-coloured low-poly geometry (the `landmarks.ts` "stamp a
 * colour, then merge" idiom), so they read as solid jungle matter rather than
 * foliage cutouts.
 *
 * Placement is deterministic seeded rejection sampling (same hash-RNG idiom
 * as the old scatter): inside the boundary, never underwater, never inside
 * the river channel or within 10 units of a site / the camp clearing, and
 * (for the tree layers) never on a steep slope. Canopy trees and rocks each
 * get a small second pass biased to the highland band so the high country
 * reads sparser and rockier without a second draw call. Understory gets an
 * extra river-fringe pass — a dedicated corridor just outside the channel —
 * for a lush riverbank without weakening the "never in the channel" rule.
 *
 * `document`/canvas is unavailable in the headless test environment (jsdom
 * has no 2D canvas backend), so texture generation is guarded and falls back
 * to an untextured, plainly-coloured cross-plane — the world still builds and
 * tests never need a real canvas context.
 */
/**
 * @param fullFoliage The jungle-density look: enlarged valley crowns and the
 * eye-height tall-fern share. `buildWorld` maps it from
 * `quality.floraDetail === "full"` (medium/high) so the LOW tier keeps the
 * original crown scales and understory silhouette — identical fill cost.
 */
export function buildProps(terrain: Terrain, density = 1, fullFoliage = true): Props {
  const group = new THREE.Group();
  group.name = "props";
  const groundPoints: GroundPoint[] = [];
  const canopyCrowns: Array<{ x: number; z: number; r: number }> = [];
  const rng = makeNoise2D(WORLD.seed ^ 0x9e3779b9);

  const d = Math.max(0, Math.min(1, density));
  const canopyBudget = Math.max(1, Math.round(CANOPY_TREE_COUNT * d));
  const palmBudget = Math.max(1, Math.round(PALM_COUNT * d));
  const understoryBudget = Math.max(1, Math.round(UNDERSTORY_COUNT * d));
  const rockBudget = Math.max(1, Math.round(ROCK_COUNT * d));

  // Pseudo-random sample in [-half, half], decorrelated per index/channel —
  // the same hash-RNG idiom the old scatter used. Each layer offsets its
  // index range (+40000, +80000, …) so layers don't read the same sequence.
  const half = WORLD.size / 2;
  const sample = (i: number, ch: number) =>
    (rng.value(i * 12.9898 + ch * 78.233, i * 39.425 + ch * 27.16) * 2 - 1) * half;

  const withinWorld = (x: number, z: number) => Math.hypot(x, z) <= WORLD.boundaryRadius - 4;
  // Per-category clearances (jungle-feel round 2): the shared 18 u camp /
  // 10 u POI ring left a ~1,000 m² bare LAWN at spawn — the first thing every
  // player sees. Trees keep the camp's sky opening; brush and grass crowd
  // right up to the clearing's edge.
  const clearOfSites = (x: number, z: number, poiClear = POI_CLEARANCE, campClear = 4) => {
    for (const a of POI_ANCHORS) {
      if (Math.hypot(x - a.x, z - a.z) < poiClear) return false;
    }
    return Math.hypot(x - SPAWN.x, z - SPAWN.z) >= WORLD.campClearRadius + campClear;
  };
  // Absolute camp rings (world units from SPAWN) — named so a future
  // campClearRadius retune can't silently shift them (review nit).
  const UNDERSTORY_CAMP_RING = 9;
  const ROCK_CAMP_RING = 12;
  /** Understory hugs the clearings: 7 u off POIs, 9 u off the camp centre
   *  (inside the 14 u cleared ring — brush at the edge of camp is the look). */
  const clearForUnderstory = (x: number, z: number) =>
    clearOfSites(x, z, 7, UNDERSTORY_CAMP_RING - WORLD.campClearRadius);
  /** Rocks split the difference (12 u camp ring). */
  const clearForRocks = (x: number, z: number) =>
    clearOfSites(x, z, POI_CLEARANCE, ROCK_CAMP_RING - WORLD.campClearRadius);
  const gentleSlope = (x: number, z: number, y: number, maxSlope = 3) => {
    const e = 1.5;
    const slope =
      Math.abs(terrain.heightAt(x + e, z) - y) + Math.abs(terrain.heightAt(x, z + e) - y);
    return slope <= maxSlope;
  };
  const inRiverChannel = (x: number, z: number) => distToRiver(x, z) < RIVER.bankHalfWidth + 1;
  /** Four-way local relief check for the eye-height tall ferns. */
  const flatGround = (x: number, z: number, y: number, e = 1.5) =>
    Math.abs(terrain.heightAt(x + e, z) - y) <= TALL_FERN_MAX_DROP &&
    Math.abs(terrain.heightAt(x - e, z) - y) <= TALL_FERN_MAX_DROP &&
    Math.abs(terrain.heightAt(x, z + e) - y) <= TALL_FERN_MAX_DROP &&
    Math.abs(terrain.heightAt(x, z - e) - y) <= TALL_FERN_MAX_DROP;

  // A point in the river-fringe corridor (bankHalfWidth+1 .. +6): a jittered
  // offset perpendicular to a random river segment, so the understory reads
  // as a lush ribbon along the banks without ever landing in the channel.
  const riverFringePoint = (ch: number): { x: number; z: number } => {
    const pts = RIVER.points;
    const segCount = pts.length - 1;
    const segIdx = Math.min(segCount - 1, Math.floor(rng.value(ch, 101) * segCount));
    const a = pts[segIdx];
    const b = pts[segIdx + 1];
    const t = rng.value(ch, 102);
    const px = a.x + (b.x - a.x) * t;
    const pz = a.z + (b.z - a.z) * t;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    const side = rng.value(ch, 103) < 0.5 ? -1 : 1;
    const dist = RIVER.bankHalfWidth + 1 + rng.value(ch, 104) * 5;
    return { x: px + nx * dist * side, z: pz + nz * dist * side };
  };

  // ---- geometry & materials ----
  const canopyTrunkGeo = stampColor(
    new THREE.CylinderGeometry(0.34, 0.52, CANOPY_TRUNK_HEIGHT, 6).translate(0, CANOPY_TRUNK_HEIGHT / 2, 0),
    WOOD_CANOPY,
  );
  const canopyTrunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });

  const canopyCrossGeo = makeCrossGeometry(CANOPY_CROSS_WIDTH, CANOPY_CROSS_HEIGHT);
  const canopyTexture = makeLeafTexture(31, 7, [9, 17], 100);
  const canopyCrossMat = buildFoliageMaterial(canopyTexture, FALLBACK_CANOPY_GREEN);

  const palm = buildPalmTrunk();
  const palmTrunkGeo = palm.geometry;
  const palmTrunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
  const palmFrondGeo = buildPalmFrondCrown(palm.topAngle);
  const palmFrondMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });

  const understoryGeo = makeCrossGeometry(UNDERSTORY_CROSS_WIDTH, UNDERSTORY_CROSS_HEIGHT);
  const understoryTexture = makeLeafTexture(53, 14, [3, 8], 95);
  const understoryMat = buildFoliageMaterial(understoryTexture, FALLBACK_FERN_GREEN);

  const rockGeo = stampColor(new THREE.DodecahedronGeometry(1, 0).translate(0, 0.3, 0), ROCK_MOSSY);
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });

  const canopyTrunks = new THREE.InstancedMesh(canopyTrunkGeo, canopyTrunkMat, canopyBudget);
  const canopyCross = new THREE.InstancedMesh(canopyCrossGeo, canopyCrossMat, canopyBudget);
  const palmTrunks = new THREE.InstancedMesh(palmTrunkGeo, palmTrunkMat, palmBudget);
  const palmFronds = new THREE.InstancedMesh(palmFrondGeo, palmFrondMat, palmBudget);
  const understory = new THREE.InstancedMesh(understoryGeo, understoryMat, understoryBudget);
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockBudget);
  canopyTrunks.name = "canopy-trunk";
  canopyCross.name = "canopy-cross";
  palmTrunks.name = "palm-trunk";
  palmFronds.name = "palm-frond";
  understory.name = "understory";
  rocks.name = "rocks";

  // Shadows: only solid trunk/rock geometry casts (#5) — the thin foliage
  // crosses and fronds would cast noisy, over-dark shadow blobs for little
  // visual gain, at real fill-rate cost on the shadow pass.
  canopyTrunks.castShadow = true;
  canopyTrunks.receiveShadow = true;
  canopyCross.castShadow = false;
  canopyCross.receiveShadow = true;
  palmTrunks.castShadow = true;
  palmTrunks.receiveShadow = true;
  palmFronds.castShadow = false;
  palmFronds.receiveShadow = true;
  understory.castShadow = false;
  understory.receiveShadow = true;
  rocks.castShadow = true;
  rocks.receiveShadow = true;

  // ---- scratch objects reused across every instance (no per-frame garbage
  // here either — this is build-time, but the discipline carries) ----
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const tint = new THREE.Color();
  const frondOffset = new THREE.Vector3();
  const rockEuler = new THREE.Euler();

  // ---- canopy trees: valley floor (dense) + a highland top-up (sparser,
  // smaller) sharing one instance-index space across the trunk + cross meshes ----
  let canopyPlaced = 0;
  const placeCanopy = (x: number, z: number, y: number, s: number, rot: number, lightness: number) => {
    q.setFromAxisAngle(UP, rot);
    pos.set(x, y, z);
    sc.set(s, s, s);
    m.compose(pos, q, sc);
    canopyTrunks.setMatrixAt(canopyPlaced, m);
    pos.set(x, y + CANOPY_TRUNK_HEIGHT * s, z);
    m.compose(pos, q, sc);
    canopyCross.setMatrixAt(canopyPlaced, m);
    canopyCross.setColorAt(canopyPlaced, tint.setHex(0xffffff).offsetHSL(0, 0, lightness));
    groundPoints.push({ x, y, z, radius: CANOPY_GROUND_RADIUS * s });
    canopyCrowns.push({ x, z, r: (CANOPY_CROSS_WIDTH / 2) * s });
    canopyPlaced++;
  };

  const canopyValleyBudget = Math.max(1, Math.round(canopyBudget * 0.82));
  for (let i = 0; canopyPlaced < canopyValleyBudget && i < CANOPY_TREE_COUNT * 10; i++) {
    const x = sample(i, 0);
    const z = sample(i, 1);
    if (!withinWorld(x, z)) continue;
    const y = terrain.heightAt(x, z);
    if (y < 1.2 || y > 12) continue;
    if (inRiverChannel(x, z)) continue;
    if (!clearOfSites(x, z)) continue;
    if (!gentleSlope(x, z, y)) continue;
    // Taller than the original 0.7–1.3 band (fullFoliage only, jungle-feel
    // round 2): the GLB canopies are 9.8 u at scale 1, so 1.05–1.75 stands
    // 10.3–17.2 u — jungle height, not orchard height — and ~8% come up as
    // EMERGENT giants (19.6–23.5 u) breaking the canopy line. Uniform scale:
    // zero triangle delta; closure grows with crown area for free. Low keeps
    // the original band — crown quads are alpha-cutout fill, the metric that
    // binds on mobile.
    const emergent = fullFoliage && rng.value(i, 13) < 0.08;
    const s = emergent
      ? 2.0 + rng.value(i, 7) * 0.4
      : fullFoliage
        ? 1.05 + rng.value(i, 7) * 0.7
        : 0.7 + rng.value(i, 7) * 0.6;
    const rot = rng.value(i, 3) * Math.PI * 2;
    placeCanopy(x, z, y, s, rot, (rng.value(i, 9) - 0.5) * 0.12);
  }
  // Highland top-up: smaller, sparser gnarled cover, tops the same budget up.
  for (let i = 0; canopyPlaced < canopyBudget && i < CANOPY_TREE_COUNT * 20; i++) {
    const ch = i + 40000;
    const x = sample(ch, 0);
    const z = sample(ch, 1);
    if (!withinWorld(x, z)) continue;
    const y = terrain.heightAt(x, z);
    if (y < 14) continue;
    if (inRiverChannel(x, z)) continue;
    if (!clearOfSites(x, z)) continue;
    if (!gentleSlope(x, z, y)) continue;
    const s = (0.7 + rng.value(ch, 7) * 0.6) * 0.6;
    const rot = rng.value(ch, 3) * Math.PI * 2;
    placeCanopy(x, z, y, s, rot, (rng.value(ch, 9) - 0.5) * 0.1 - 0.08);
  }
  canopyTrunks.count = canopyPlaced;
  canopyCross.count = canopyPlaced;
  canopyTrunks.instanceMatrix.needsUpdate = true;
  canopyCross.instanceMatrix.needsUpdate = true;
  if (canopyCross.instanceColor) canopyCross.instanceColor.needsUpdate = true;

  // ---- palms: shore band (0.7..2.5), curved trunk + frond crown sharing an
  // instance index. The crown offset is the trunk-curve's own tip (`palm.top`,
  // `palm.topAngle`), rotated by the same per-instance yaw, so the frond crown
  // always continues the trunk's lean rather than sitting dead-centre on it.
  // The shore band is a thin ribbon against the map area, so candidates are
  // drawn DIRECTLY from the two annuli where that band lives — around the
  // lagoon and along the outer coast rim — instead of rejection-sampling the
  // whole tile (which needed ~54k attempts to land 60 palms). The height-band
  // check below still owns the truth; the annuli only aim the samples. ----
  let palmPlaced = 0;
  for (let i = 0; palmPlaced < palmBudget && i < PALM_COUNT * 40; i++) {
    const ch = i + 80000;
    const theta = rng.value(ch, 0) * Math.PI * 2;
    let x: number;
    let z: number;
    if (i % 2 === 0) {
      // Lagoon shore annulus.
      const r = LAGOON.radius + rng.value(ch, 1) * LAGOON.shoreRamp;
      x = LAGOON.x + Math.cos(theta) * r;
      z = LAGOON.z + Math.sin(theta) * r;
    } else {
      // Outer coast rim, just inside the soft boundary.
      const r = WORLD.coastRadius + rng.value(ch, 1) * (WORLD.boundaryRadius - 4 - WORLD.coastRadius);
      x = Math.cos(theta) * r;
      z = Math.sin(theta) * r;
    }
    if (!withinWorld(x, z)) continue;
    const y = terrain.heightAt(x, z);
    if (y < 0.7 || y > 2.5) continue;
    if (inRiverChannel(x, z)) continue;
    if (!clearOfSites(x, z)) continue;
    if (!gentleSlope(x, z, y)) continue;
    const s = 0.7 + rng.value(ch, 7) * 0.6;
    const rot = rng.value(ch, 3) * Math.PI * 2;
    q.setFromAxisAngle(UP, rot);
    pos.set(x, y, z);
    sc.set(s, s, s);
    m.compose(pos, q, sc);
    palmTrunks.setMatrixAt(palmPlaced, m);
    frondOffset.copy(palm.top).applyQuaternion(q).multiplyScalar(s);
    pos.set(x + frondOffset.x, y + frondOffset.y, z + frondOffset.z);
    m.compose(pos, q, sc);
    palmFronds.setMatrixAt(palmPlaced, m);
    palmFronds.setColorAt(palmPlaced, tint.setHex(0xffffff).offsetHSL(0, 0, (rng.value(ch, 9) - 0.5) * 0.12));
    groundPoints.push({ x, y, z, radius: PALM_GROUND_RADIUS * s });
    palmPlaced++;
  }
  palmTrunks.count = palmPlaced;
  palmFronds.count = palmPlaced;
  palmTrunks.instanceMatrix.needsUpdate = true;
  palmFronds.instanceMatrix.needsUpdate = true;
  if (palmFronds.instanceColor) palmFronds.instanceColor.needsUpdate = true;

  // ---- understory: general scatter across the valley + a dedicated river-
  // fringe pass, so the riverbank corridor reads lush without relaxing the
  // "never inside the channel" rule anywhere else. ----
  let understoryPlaced = 0;
  const placeUnderstory = (x: number, y: number, z: number, seedIdx: number) => {
    // A deterministic share of placements comes up TALL — eye-height ferns
    // that break sightlines (the enclosure that makes it read as jungle).
    // Only on near-flat ground (a big fern's footprint floats on a slope) and
    // only with fullFoliage. Slightly darker: deep-shade foliage, it recedes.
    const tall =
      fullFoliage &&
      rng.value(seedIdx, 11) < TALL_FERN_SHARE &&
      flatGround(x, z, y);
    const s = tall
      ? TALL_FERN_SCALE_MIN + rng.value(seedIdx, 7) * TALL_FERN_SCALE_SPAN
      : 0.7 + rng.value(seedIdx, 7) * 0.6;
    const rot = rng.value(seedIdx, 3) * Math.PI * 2;
    q.setFromAxisAngle(UP, rot);
    pos.set(x, y, z);
    sc.set(s, s, s);
    m.compose(pos, q, sc);
    understory.setMatrixAt(understoryPlaced, m);
    understory.setColorAt(
      understoryPlaced,
      tint.setHex(0xffffff).offsetHSL(0, 0, (rng.value(seedIdx, 9) - 0.5) * 0.15 - (tall ? 0.05 : 0)),
    );
    understoryPlaced++;
  };
  const understoryGeneralBudget = Math.max(1, Math.round(understoryBudget * 0.65));
  for (let i = 0; understoryPlaced < understoryGeneralBudget && i < UNDERSTORY_COUNT * 6; i++) {
    const ch = i + 120000;
    const x = sample(ch, 0);
    const z = sample(ch, 1);
    if (!withinWorld(x, z)) continue;
    const y = terrain.heightAt(x, z);
    if (y < 0.8) continue;
    if (inRiverChannel(x, z)) continue;
    if (!clearForUnderstory(x, z)) continue;
    if (!gentleSlope(x, z, y, 5)) continue;
    placeUnderstory(x, y, z, ch);
  }
  for (let i = 0; understoryPlaced < understoryBudget && i < UNDERSTORY_COUNT * 8; i++) {
    const ch = i + 200000;
    const pt = riverFringePoint(ch);
    if (!withinWorld(pt.x, pt.z)) continue;
    const dr = distToRiver(pt.x, pt.z);
    if (dr < RIVER.bankHalfWidth + 1 || dr > RIVER.bankHalfWidth + 6) continue;
    const y = terrain.heightAt(pt.x, pt.z);
    if (y < 0.7) continue;
    if (!clearForUnderstory(pt.x, pt.z)) continue;
    placeUnderstory(pt.x, y, pt.z, ch);
  }
  understory.count = understoryPlaced;
  understory.instanceMatrix.needsUpdate = true;
  if (understory.instanceColor) understory.instanceColor.needsUpdate = true;

  // ---- mossy boulders: scattered throughout + a highland top-up (rockier
  // high country), no slope filter — rocks read fine bedded into a hillside. ----
  let rocksPlaced = 0;
  const placeRock = (x: number, y: number, z: number, seedIdx: number) => {
    const s = 0.6 + rng.value(seedIdx, 11) * 1.6;
    q.setFromEuler(rockEuler.set(rng.value(seedIdx, 1) * 3, rng.value(seedIdx, 2) * 6, rng.value(seedIdx, 4) * 3));
    pos.set(x, y, z);
    sc.set(s, s * 0.8, s);
    m.compose(pos, q, sc);
    rocks.setMatrixAt(rocksPlaced, m);
    groundPoints.push({ x, y, z, radius: ROCK_GROUND_RADIUS * s });
    rocksPlaced++;
  };
  const rockGeneralBudget = Math.max(1, Math.round(rockBudget * 0.7));
  for (let i = 0; rocksPlaced < rockGeneralBudget && i < ROCK_COUNT * 10; i++) {
    const ch = i + 300000;
    const x = sample(ch, 0);
    const z = sample(ch, 1);
    if (!withinWorld(x, z)) continue;
    const y = terrain.heightAt(x, z);
    if (y < 0.8) continue;
    if (inRiverChannel(x, z)) continue;
    if (!clearForRocks(x, z)) continue;
    placeRock(x, y, z, ch);
  }
  for (let i = 0; rocksPlaced < rockBudget && i < ROCK_COUNT * 20; i++) {
    const ch = i + 400000;
    const x = sample(ch, 0);
    const z = sample(ch, 1);
    if (!withinWorld(x, z)) continue;
    const y = terrain.heightAt(x, z);
    if (y < 14) continue;
    if (inRiverChannel(x, z)) continue;
    if (!clearForRocks(x, z)) continue;
    placeRock(x, y, z, ch);
  }
  rocks.count = rocksPlaced;
  rocks.instanceMatrix.needsUpdate = true;

  group.add(canopyTrunks, canopyCross, palmTrunks, palmFronds, understory, rocks);

  return {
    group,
    groundPoints,
    canopyCrowns,
    dispose() {
      for (const im of [canopyTrunks, canopyCross, palmTrunks, palmFronds, understory, rocks]) im.dispose();
      for (const geo of [canopyTrunkGeo, canopyCrossGeo, palmTrunkGeo, palmFrondGeo, understoryGeo, rockGeo]) {
        geo.dispose();
      }
      for (const mt of [canopyTrunkMat, canopyCrossMat, palmTrunkMat, palmFrondMat, understoryMat, rockMat]) {
        mt.dispose();
      }
      canopyTexture?.dispose();
      understoryTexture?.dispose();
    },
  };
}

/**
 * Stamp a uniform per-vertex `color` on a geometry (the `landmarks.ts` `prep`
 * idiom): converts to non-indexed first so flat shading keeps hard normals,
 * then fills a `color` attribute. Mutates and returns the (possibly
 * replaced) geometry.
 */
function stampColor(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
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

/** Merge, or throw — every call site here passes a fixed, non-empty source
 *  set, so a `null` result means a real geometry-construction bug. */
function mergeOrThrow(sources: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(sources, false);
  if (!merged) throw new Error("props: failed to merge geometry");
  return merged;
}

/**
 * Two crossed STATIC planes (an "X" viewed from above), base at local origin
 * extending up to `height` — a lit cross-billboard, not a camera-facing
 * sprite, so it shades correctly under the moving day-cycle sun instead of
 * always facing it.
 */
function makeCrossGeometry(width: number, height: number): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(width, height);
  a.translate(0, height / 2, 0);
  const b = a.clone();
  b.rotateY(Math.PI / 2);
  const merged = mergeOrThrow([a, b]);
  a.dispose();
  b.dispose();
  return merged;
}

interface PalmCurve {
  /** Merged, vertex-coloured curved-trunk geometry, base at local origin. */
  geometry: THREE.BufferGeometry;
  /** Local-space offset of the trunk's tip (where the frond crown attaches). */
  top: THREE.Vector3;
  /** The tip segment's tilt (radians) — the frond crown pre-tilts to match. */
  topAngle: number;
}

/**
 * A curved palm trunk: 3-4 stacked, progressively tilted cylinder segments,
 * each starting where the last one ended (bends in the local X/Y plane so a
 * later per-instance yaw can point the lean any direction). One merged,
 * vertex-coloured geometry — reused via `InstancedMesh` with varied
 * rotation/scale, never rebuilt per instance.
 */
function buildPalmTrunk(): PalmCurve {
  const segCount = 4;
  const segHeight = 1.1;
  const bendStep = 0.13;
  const cursor = new THREE.Vector3(0, 0, 0);
  let angle = 0;
  const segs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < segCount; i++) {
    const rBottom = 0.3 - i * 0.045;
    const rTop = rBottom - 0.05;
    const seg = new THREE.CylinderGeometry(Math.max(rTop, 0.06), Math.max(rBottom, 0.09), segHeight, 5);
    seg.translate(0, segHeight / 2, 0); // pivot the segment at its own base
    seg.rotateZ(angle); // tilt around that base
    seg.translate(cursor.x, cursor.y, cursor.z); // attach to the previous tip
    segs.push(seg);
    // rotateZ maps the segment's local tip (0, h, 0) to (-h·sinθ, h·cosθ, 0) —
    // the X term is NEGATIVE sine (review caught the mirror: fronds floated on
    // the wrong side of the lean on every palm).
    cursor.x -= Math.sin(angle) * segHeight;
    cursor.y += Math.cos(angle) * segHeight;
    angle += bendStep;
  }
  const merged = stampColor(mergeOrThrow(segs), WOOD_PALM);
  for (const s of segs) s.dispose();
  return { geometry: merged, top: cursor, topAngle: angle };
}

/**
 * A palm's frond crown: 5-7 flat, drooping fronds spread radially from the
 * trunk tip, pre-tilted by `topAngle` so it continues the trunk's curve. One
 * merged, vertex-coloured geometry (plain low-poly foliage, not a textured
 * cross-billboard — the fronds are already flat-shaded planes, not blobs).
 */
function buildPalmFrondCrown(topAngle: number): THREE.BufferGeometry {
  const count = 6;
  const length = 2.4;
  const width = 0.5;
  const fronds: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    const frond = new THREE.PlaneGeometry(width, length);
    frond.rotateX(Math.PI / 2); // lie flat, extend along +Z
    frond.translate(0, 0, length / 2); // base at the attach point
    frond.rotateX(-0.5); // droop the tip
    frond.rotateY(t); // spread around the trunk
    fronds.push(frond);
  }
  const merged = mergeOrThrow(fronds);
  for (const f of fronds) f.dispose();
  merged.rotateZ(topAngle);
  return stampColor(merged, FROND_GREEN);
}

/**
 * A small `CanvasTexture` of leafy alpha blobs — generated at runtime, never
 * a downloaded asset — for the foliage cross-planes' cutout. Deterministic
 * (its own small seeded RNG), so the leaf pattern is stable across builds.
 * Returns `null` when no 2D canvas context is available (jsdom in tests has
 * no canvas backend) so callers can fall back to a flat colour without ever
 * needing a real canvas.
 */
function makeLeafTexture(
  seed: number,
  blobCount: number,
  radiusRange: [number, number],
  hue: number,
): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, 64, 64);
  const blobRng = makeNoise2D(seed);
  for (let i = 0; i < blobCount; i++) {
    const bx = blobRng.value(i, 1) * 64;
    const by = blobRng.value(i, 2) * 64;
    const r = radiusRange[0] + blobRng.value(i, 3) * (radiusRange[1] - radiusRange[0]);
    const light = 32 + Math.round(blobRng.value(i, 4) * 22);
    ctx.fillStyle = `hsl(${hue}, 45%, ${light}%)`;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The foliage cross-plane material: lit (`MeshStandardMaterial`), `alphaTest`
 * cutout (never `transparent: true` — this instance count would fight depth
 * sorting), double-sided so both crossed planes read from any angle. Uses the
 * generated leaf texture when available; otherwise a plain flat colour, so
 * the headless (canvas-less) path never needs one.
 */
function buildFoliageMaterial(
  texture: THREE.CanvasTexture | null,
  fallbackColor: number,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: texture ? 0xffffff : fallbackColor,
    map: texture,
    flatShading: true,
    roughness: 0.85,
    side: THREE.DoubleSide,
    alphaTest: 0.5,
  });
}
