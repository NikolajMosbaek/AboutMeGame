// Terrain texture-splat weights (visual-overhaul slice 3, PBR terrain).
//
// Pure CPU-side signal → weight math. The terrain grid is static (built once
// from `heightAt`), so the per-vertex blend between the four ground textures
// (jungle floor / leaf litter / rock / sand) is computed HERE, at mesh build
// time, from the same signals `colorForHeight` already reads (elevation bands,
// slow-noise mottling) plus slope (from the now-smooth vertex normal, which the
// old flat-shaded vertex-coloured terrain never needed). The result packs into
// a vec4 vertex attribute (`packSplatWeights`, in `SPLAT_CHANNELS` order) that
// `terrainMaterialPatch.ts`'s `onBeforeCompile` interpolates and blends 4
// albedo (+4 normal on medium/high) texture samples by in the fragment shader —
// a line-for-line GLSL transcription of this module, the same idiom as
// `waterPatch.ts`/`waterSurface.ts`.
//
// Bands mirror `colorForHeight`'s thresholds (river mud/sand < jungle floor <
// deep jungle < highland rock above the treeline) so the texture read agrees
// with the surviving vertex-colour macro tint rather than fighting it.

/** The four ground textures, in the fixed order every packed vec4/attribute/
 *  uniform array uses: r=jungleFloor, g=leafLitter, b=rock, a=sand. */
export const SPLAT_CHANNELS = ["jungleFloor", "leafLitter", "rock", "sand"] as const;
export type SplatChannel = (typeof SPLAT_CHANNELS)[number];

/** One vertex's blend fractions across the four textures. Always sums to 1
 *  (each channel a valid [0,1] weight) — the shader treats these as a
 *  normalized weighted average, not independent opacities. */
export type SplatWeights = Record<SplatChannel, number>;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Steepness in [0,1] from a (possibly denormalized/out-of-range) vertex
 *  normal's Y component: 0 for a flat, up-facing normal (`normalY = 1`), 1 for
 *  a vertical, horizon-facing one (`normalY = 0`). Clamped both ends so a
 *  slightly overshooting/undershooting normal (interpolation, float error)
 *  never produces a negative or >1 slope. */
export function slopeFromNormalY(normalY: number): number {
  return clamp01(1 - normalY);
}

// Height-band edges (world Y, matching `colorForHeight`'s thresholds so the
// texture read and the surviving vertex-colour tint agree): river mud/sand
// below ~0.7, jungle floor through the mid band, leaf litter (deep jungle)
// blending in toward 12-16, rock (highland, above the treeline) from 16-20 up.
const SAND_MAX = 0.7;
const SAND_BLEND = 3;
const LITTER_MID = 12;
const LITTER_BLEND = 4;
const ROCK_HEIGHT_START = 16;
const ROCK_HEIGHT_END = 20;

// Slope band: below SLOPE_LOW reads as flat ground (no forced rock); above
// SLOPE_HIGH is steep enough that rock takes over completely regardless of
// height (a cliff face reads as rock even mid-jungle-floor elevation).
const SLOPE_LOW = 0.35;
const SLOPE_HIGH = 0.65;

// Noise mottling strength: how much weight the slow-noise mottling can shift
// between jungleFloor and leafLitter (macro variation, breaking up a flat
// height-band read the same way `colorForHeight`'s ±8% lightness mottle does
// for the old vertex colour) — bounded so it can only ever swap weight that
// both channels actually hold (never manufactures or destroys total weight).
const MOTTLE_STRENGTH = 0.5;

/**
 * Compute the 4-channel splat blend for one vertex. Pure: same inputs, same
 * output, always summing to 1.
 *
 * @param height world Y (from `heightAt`).
 * @param slope  0 (flat) .. 1 (vertical), from {@link slopeFromNormalY}.
 * @param noise  a slow noise sample in [0,1] (same field `colorForHeight`'s
 *   mottle reads, just not yet remapped to ±).
 */
export function computeSplatWeights(height: number, slope: number, noise: number): SplatWeights {
  // 1) Height-band split (sums to 1 by construction: sand + rock + the mid
  // remainder given to jungleFloor/leafLitter).
  const sandT = 1 - smoothstep(SAND_MAX, SAND_MAX + SAND_BLEND, height);
  const rockHeightT = smoothstep(ROCK_HEIGHT_START, ROCK_HEIGHT_END, height);
  let sand = sandT * (1 - rockHeightT); // don't double-count the high-rock band as sand
  let rock = rockHeightT * (1 - sandT);
  const midRemainder = clamp01(1 - sand - rock);
  const litterT = smoothstep(LITTER_MID - LITTER_BLEND, LITTER_MID + LITTER_BLEND, height);
  let jungleFloor = midRemainder * (1 - litterT);
  let leafLitter = midRemainder * litterT;

  // 2) Slope pushes toward rock regardless of height band, stealing
  // proportionally from whatever the other three currently hold.
  const slopeRock = smoothstep(SLOPE_LOW, SLOPE_HIGH, slope);
  rock = rock + (1 - rock) * slopeRock;
  const nonRock = 1 - rock;
  const otherSum = sand + jungleFloor + leafLitter;
  if (otherSum > 1e-9) {
    const scale = nonRock / otherSum;
    sand *= scale;
    jungleFloor *= scale;
    leafLitter *= scale;
  }

  // 3) Noise mottling: shift weight between jungleFloor and leafLitter only
  // (never sand/rock), bounded so it can't push either below 0 — the swap is
  // conservative (jungleFloor+leafLitter is invariant under it).
  const mottle = (noise - 0.5) * 2 * MOTTLE_STRENGTH; // -MOTTLE_STRENGTH..+MOTTLE_STRENGTH
  const combined = jungleFloor + leafLitter;
  let swap = mottle * combined;
  let jf = jungleFloor - swap;
  let ll = leafLitter + swap;
  if (jf < 0) {
    ll += jf;
    jf = 0;
  }
  if (ll < 0) {
    jf += ll;
    ll = 0;
  }
  jungleFloor = jf;
  leafLitter = ll;

  // 4) Defensive final normalization: guarantees sum === 1 exactly (within
  // float error) even if an edge case above left a tiny residual.
  const total = sand + jungleFloor + leafLitter + rock;
  if (total > 1e-9) {
    sand /= total;
    jungleFloor /= total;
    leafLitter /= total;
    rock /= total;
  } else {
    rock = 1; // degenerate fallback (should be unreachable) — read as bare rock.
  }

  return { jungleFloor, leafLitter, rock, sand };
}

/** Pack a `SplatWeights` into the fixed `[r,g,b,a]` order every attribute /
 *  shader array uses (`SPLAT_CHANNELS`). */
export function packSplatWeights(w: SplatWeights): [number, number, number, number] {
  return [w.jungleFloor, w.leafLitter, w.rock, w.sand];
}
