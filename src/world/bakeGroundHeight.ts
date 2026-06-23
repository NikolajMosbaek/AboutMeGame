// Pure ground-height bake for the water `onBeforeCompile` foam band (G1 slice 2).
//
// The water is one flat plane at sea level with no per-fragment ground data, and
// GLSL cannot call `terrain.heightAt`. Re-deriving the terrain FBM in GLSL would
// duplicate terrain math (a worse single-source violation), so instead we sample
// the DI'd `heightAt` ONCE at build time over the island XZ extent into a small
// single-channel grid. The wiring slice uploads that grid as a `THREE.DataTexture`
// (R-channel, ClampToEdge, Nearest) the fragment reads to recover ground height,
// from which `depth = seaLevel - groundHeight` drives `shorelineFoam`.
//
// This module is PURE: no THREE, no DOM, allocation-bounded (one Float32Array of
// `res*res`), and deterministic. The DataTexture construction and the GLSL
// transcription live in the boundaries patch; this is just the CPU bake + the
// matching CPU read-back (`sampleBaked`) so the lookup math can be unit-tested
// against the same edge-clamp semantics the GPU sampler uses.

/**
 * A baked ground-height grid: `res*res` single-channel (R) samples laid out
 * row-major, plus the extent metadata the DataTexture builder needs.
 *
 * Heights are SIGNED world units (the masked rim sinks below sea level), so the
 * grid is `Float32`, not a normalised byte — the foam depth `seaLevel - height`
 * must stay faithful in deep water. The samples sit on a vertex grid spanning
 * `[-extent, +extent]` inclusive on both X and Z, so the four corners land
 * exactly on `±extent` and the step between adjacent cells is `2*extent/(res-1)`.
 */
export interface BakedGround {
  /** Row-major `res*res` ground heights, signed world units. */
  readonly data: Float32Array;
  /** Grid resolution per side (cells per axis). */
  readonly res: number;
  /** Half-extent: the grid spans `[-extent, +extent]` on X and Z. */
  readonly extent: number;
}

/**
 * Sample `heightAt` over the island XZ extent into a `res*res` R-channel grid.
 *
 * Pure and allocation-bounded: one `Float32Array(res*res)` is allocated and
 * filled, `heightAt` is called exactly `res*res` times, and nothing else is
 * retained. Cell `(col, row)` maps to world `(x, z)` on a vertex grid spanning
 * `[-extent, +extent]` inclusive — `x = -extent + col*step`, `z = -extent +
 * row*step`, `step = 2*extent/(res-1)` — so `data[0]` is the corner at
 * `(-extent, -extent)` and `data[res*res-1]` the corner at `(+extent, +extent)`.
 * Row index advances along +Z, matching the UV mapping in {@link sampleBaked}.
 */
export function bakeGroundHeight(
  heightAt: (x: number, z: number) => number,
  extent: number,
  res: number,
): BakedGround {
  const data = new Float32Array(res * res);
  const step = (2 * extent) / (res - 1);
  for (let row = 0; row < res; row++) {
    const z = -extent + row * step;
    const base = row * res;
    for (let col = 0; col < res; col++) {
      const x = -extent + col * step;
      data[base + col] = heightAt(x, z);
    }
  }
  return { data, res, extent };
}

/**
 * Read a baked grid at normalized UV `(u, v)` with nearest sampling and
 * edge clamp — the CPU mirror of the GPU sampler the DataTexture uses
 * (`NearestFilter` + `ClampToEdgeWrapping`).
 *
 * `u`/`v` in `[0,1]` map to columns/rows `[0, res-1]`; out-of-range UVs clamp to
 * the nearest edge cell (no wrap, no out-of-bounds read). Degenerate UVs
 * (NaN/Infinity) fold to an in-range edge via the same clamp, so the result is
 * always one of the stored finite samples. This is a CPU helper for tests, not a
 * per-frame path; the shader does the real lookup on the GPU.
 */
export function sampleBaked(baked: BakedGround, u: number, v: number): number {
  const { data, res } = baked;
  const col = clampIndex(Math.round(u * (res - 1)), res);
  const row = clampIndex(Math.round(v * (res - 1)), res);
  return data[row * res + col];
}

/**
 * Clamp `i` to a valid `[0, res-1]` grid index. NaN folds to 0 (it fails both
 * comparisons), so degenerate UVs still read a real, finite edge sample.
 */
function clampIndex(i: number, res: number): number {
  return i > res - 1 ? res - 1 : i > 0 ? i : 0;
}
