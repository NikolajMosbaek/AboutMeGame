// Under-canopy ground shade (jungle-density epic, 2026-07-19). Being IN a
// jungle means the ground under a closed canopy reads shaded — a build-time
// darkening of the terrain's vertex colours under the canopy crowns, with a
// slight green bias (deep-leaf shade, not soot). Works on EVERY tier for free:
// the low tier's terrain look IS its vertex colours, and the medium/high
// splat patch multiplies the blended albedo by the interpolated vertex colour
// (`terrainMaterialPatch.ts` inserts before `<color_fragment>`), so the same
// bake lands under the textures too. Zero per-frame cost, zero draw calls; on
// medium/high it composes with (rather than replaces) the real-time dappled
// canopy shadows — this is the canopy's ambient occlusion, theirs is the sun.

import type * as THREE from "three";

/** Maximum darkening under full crown coverage (green channel; red drops a
 *  touch further, blue in between — see the bias vector below). */
export const SHADE_MAX = 0.24; // jungle-feel round 2: darker floor under the (now taller) canopy

/** Per-channel shade bias × coverage: red loses the most, green the least —
 *  jungle shade is green-tinged. Green's factor equals {@link SHADE_MAX}. */
const SHADE_RGB = [0.22, 0.18, 0.2] as const;

/** Coverage-grid cell size (world units) — half the terrain's own 2 u vertex
 *  spacing would be wasted; matching it keeps the grid exact per vertex. */
const CELL = 2;

export interface CanopyCrown {
  x: number;
  z: number;
  /** Crown radius (world units). */
  r: number;
}

export interface CoverageGrid {
  /** Canopy coverage 0..1 at a world point. */
  get(x: number, z: number): number;
}

/**
 * Accumulate crown coverage into a coarse grid: each crown stamps a soft
 * radial falloff (1 at centre → 0 at its radius), sums saturate at 1. O(total
 * crown area / cell²) build, O(1) lookup — never O(vertices × crowns).
 */
export function coverageGrid(crowns: readonly CanopyCrown[]): CoverageGrid {
  if (crowns.length === 0) return { get: () => 0 };
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const c of crowns) {
    minX = Math.min(minX, c.x - c.r);
    maxX = Math.max(maxX, c.x + c.r);
    minZ = Math.min(minZ, c.z - c.r);
    maxZ = Math.max(maxZ, c.z + c.r);
  }
  const w = Math.max(1, Math.ceil((maxX - minX) / CELL) + 1);
  const h = Math.max(1, Math.ceil((maxZ - minZ) / CELL) + 1);
  const grid = new Float32Array(w * h);
  for (const c of crowns) {
    const x0 = Math.max(0, Math.floor((c.x - c.r - minX) / CELL));
    const x1 = Math.min(w - 1, Math.ceil((c.x + c.r - minX) / CELL));
    const z0 = Math.max(0, Math.floor((c.z - c.r - minZ) / CELL));
    const z1 = Math.min(h - 1, Math.ceil((c.z + c.r - minZ) / CELL));
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const dx = minX + gx * CELL - c.x;
        const dz = minZ + gz * CELL - c.z;
        const d = Math.hypot(dx, dz);
        if (d >= c.r) continue;
        // Soft-top falloff: full shade under most of the crown, fading only
        // toward the rim — a lone tree still reads shaded at its trunk.
        const idx = gz * w + gx;
        grid[idx] = Math.min(1, grid[idx] + Math.min(1, 1.8 * (1 - d / c.r)));
      }
    }
  }
  const at = (gx: number, gz: number) =>
    gx < 0 || gx >= w || gz < 0 || gz >= h ? 0 : grid[gz * w + gx];
  return {
    get(x, z) {
      // Bilinear — smooth shade across the terrain's 2 u vertex spacing.
      const fx = (x - minX) / CELL;
      const fz = (z - minZ) / CELL;
      const x0 = Math.floor(fx);
      const z0 = Math.floor(fz);
      const tx = fx - x0;
      const tz = fz - z0;
      const top = at(x0, z0) * (1 - tx) + at(x0 + 1, z0) * tx;
      const bottom = at(x0, z0 + 1) * (1 - tx) + at(x0 + 1, z0 + 1) * tx;
      return top * (1 - tz) + bottom * tz;
    },
  };
}

/**
 * Darken the geometry's vertex colours under the crowns. Vertices are read in
 * the terrain's own convention: world-space x/z on the position attribute
 * (the plane lies flat at the origin). Build-time, in place, one pass.
 */
export function applyCanopyShade(
  geometry: THREE.BufferGeometry,
  crowns: readonly CanopyCrown[],
): void {
  const grid = coverageGrid(crowns);
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const col = geometry.attributes.color as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const cover = grid.get(pos.getX(i), pos.getZ(i));
    if (cover <= 0) continue;
    col.setXYZ(
      i,
      col.getX(i) * (1 - SHADE_RGB[0] * cover),
      col.getY(i) * (1 - SHADE_RGB[1] * cover),
      col.getZ(i) * (1 - SHADE_RGB[2] * cover),
    );
  }
  col.needsUpdate = true;
}

// --- Open-floor deepening (2026-07-19, darker-water PR #241 follow-up) --------
// `applyCanopyShade` above saves the ground UNDER the crowns. But the OPEN
// low-band valley floor — the river corridor and clearings with zero crown
// coverage — gets no shade term, so its bright jungle-floor vertex colour
// (`terrain.ts` `colorForHeight`'s `y < 12` band, `0x3f6b33`) renders
// full-bright and the renderer's AgX tone-mapping desaturates it toward a pale
// grey-white sheet. This is the exact complement of canopy shade: deepen the
// OPEN low-band floor toward a richer, lusher jungle green, keyed to
// `(1 − canopyCoverage)` so it fades to precisely zero where `applyCanopyShade`
// is already working — by construction it can NEVER further muddy already-
// shaded ground. Same build-time, multiply-on-(already-linear)-vertex-colour
// idiom, every tier, zero per-frame cost, zero draw calls.

/** Deepening at full openness in the core of the low band (green channel). */
export const OPEN_FLOOR_MAX = 0.28;

/** Per-channel deepening × openness × band-weight: red and blue drop more than
 *  green so the open floor reads as a richer, lusher jungle green rather than
 *  merely darker (green's factor equals {@link OPEN_FLOOR_MAX}). */
const OPEN_FLOOR_RGB = [0.4, 0.28, 0.44] as const;

/** Low elevation band the wash lives in, mirroring `terrain.ts`
 *  `colorForHeight`: above the `y < 0.7` waterline-mud band, up to the `y = 12`
 *  jungle-floor / deep-jungle boundary. Highland rock and waterline mud stay
 *  untouched. */
const BAND_LOW = 0.7;
const BAND_HIGH = 12;
/** Ramp width above the waterline mud — a gentle blend off the wet-sand band. */
const EDGE_LOW = 1.5;
/** Ramp width into the deep-jungle band. Short by design: most of the open
 *  valley floor sits at y ≈ 8–12 (a landBase-plus-relief plateau — the exact
 *  elevation of the pale wash), so the effect must stay near full strength
 *  right up to the boundary. The deepened floor lands close to the (already
 *  darker) deep-jungle colour, so the join at y = 12 reads continuous anyway. */
const EDGE_HIGH = 0.8;

function smoothstep01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * Membership weight (0..1) of world-height `y` in the low valley-floor band:
 * 0 on the waterline-mud band and the highland band, ramping smoothly in above
 * the waterline and (briefly) out toward the deep-jungle boundary. Pure — the
 * open-floor deepening scales by it so the effect is confined to the jungle
 * floor.
 */
export function lowBandWeight(y: number): number {
  if (y <= BAND_LOW || y >= BAND_HIGH) return 0;
  const up = smoothstep01((y - BAND_LOW) / EDGE_LOW);
  const down = smoothstep01((BAND_HIGH - y) / EDGE_HIGH);
  return Math.min(up, down);
}

/**
 * Deepen the OPEN low-band ground toward a lusher jungle green. For each
 * vertex the deepening is `openness × lowBandWeight`, where
 * `openness = 1 − canopyCoverage` (same `coverageGrid` as `applyCanopyShade`).
 * Fully-shaded ground (coverage → 1) is left alone; the pale open floor gets
 * the full green-biased deepening. Build-time, in place, one pass — apply
 * AFTER `applyCanopyShade` (order is immaterial: both are per-channel multiplies
 * on the linear vertex colours).
 */
export function applyOpenFloorShade(
  geometry: THREE.BufferGeometry,
  crowns: readonly CanopyCrown[],
): void {
  const grid = coverageGrid(crowns);
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const col = geometry.attributes.color as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const band = lowBandWeight(pos.getY(i));
    if (band <= 0) continue;
    const open = 1 - grid.get(pos.getX(i), pos.getZ(i));
    const k = open * band;
    if (k <= 0) continue;
    col.setXYZ(
      i,
      col.getX(i) * (1 - OPEN_FLOOR_RGB[0] * k),
      col.getY(i) * (1 - OPEN_FLOOR_RGB[1] * k),
      col.getZ(i) * (1 - OPEN_FLOOR_RGB[2] * k),
    );
  }
  col.needsUpdate = true;
}
