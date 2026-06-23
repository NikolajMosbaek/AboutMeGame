import { describe, expect, it } from "vitest";
import { bakeGroundHeight, sampleBaked } from "./bakeGroundHeight.ts";

// T2 — the pure ground-height bake helper for the water `onBeforeCompile` foam
// band (G1 slice 2). The water plane has no per-fragment ground data and GLSL
// cannot call `terrain.heightAt`, so we bake `heightAt` ONCE over the island XZ
// extent into a small single-channel grid that the fragment samples as a
// `DataTexture`. This file proves the pure CPU bake; the DataTexture wiring and
// the GLSL transcription are exercised elsewhere. The helper is pure — no THREE,
// no DOM, allocation-bounded (one typed array of res*res floats).

describe("bakeGroundHeight (pure ground-height grid bake)", () => {
  // `heightAt(x,z) = x`: a stub whose value is independent of z, so the baked
  // grid must vary ONLY across columns and be exactly the world-x of each cell.
  const heightAtX = (x: number, _z: number) => x;
  const EXTENT = 200; // island half-extent (matches WORLD.islandRadius scale)
  const RES = 128;

  it("returns a res*res single-channel Float32 grid with extent metadata", () => {
    const baked = bakeGroundHeight(heightAtX, EXTENT, RES);
    expect(baked.res).toBe(RES);
    expect(baked.extent).toBe(EXTENT);
    expect(baked.data).toBeInstanceOf(Float32Array);
    expect(baked.data.length).toBe(RES * RES);
  });

  it("is monotonic non-decreasing across columns (heightAt = x)", () => {
    const baked = bakeGroundHeight(heightAtX, EXTENT, RES);
    // Walk one row left→right; world-x increases with the column index, so the
    // baked value must increase too (and be identical down any column, since
    // heightAt ignores z).
    for (let row = 0; row < RES; row++) {
      for (let col = 1; col < RES; col++) {
        const prev = baked.data[row * RES + (col - 1)];
        const cur = baked.data[row * RES + col];
        expect(cur).toBeGreaterThan(prev);
      }
    }
    // Identical down each column (z-independent stub).
    for (let col = 0; col < RES; col++) {
      for (let row = 1; row < RES; row++) {
        expect(baked.data[row * RES + col]).toBe(baked.data[col]);
      }
    }
  });

  it("samples world-x exactly at the cell world positions (corners + a mid cell)", () => {
    const baked = bakeGroundHeight(heightAtX, EXTENT, RES);
    // Cells sit on a vertex grid spanning [-extent, +extent] inclusive, so the
    // step between adjacent columns is 2*extent/(res-1).
    const step = (2 * EXTENT) / (RES - 1);
    const worldX = (col: number) => -EXTENT + col * step;
    // Corners: first and last column map exactly to ∓extent.
    expect(baked.data[0]).toBe(-EXTENT);
    expect(baked.data[RES - 1]).toBe(EXTENT);
    expect(baked.data[(RES - 1) * RES]).toBe(-EXTENT); // bottom-left corner
    expect(baked.data[RES * RES - 1]).toBe(EXTENT); // bottom-right corner
    // A mid column equals heightAt at its world-x.
    const mid = RES >> 1;
    expect(baked.data[mid]).toBeCloseTo(heightAtX(worldX(mid), 0), 6);
  });

  it("includes a cell at world origin only when res is odd; with even res the centre straddles 0", () => {
    // Even res has no exact centre vertex; the two middle columns bracket 0.
    const baked = bakeGroundHeight(heightAtX, EXTENT, RES);
    const lo = baked.data[(RES >> 1) - 1];
    const hi = baked.data[RES >> 1];
    expect(lo).toBeLessThan(0);
    expect(hi).toBeGreaterThan(0);
    // An odd res lands a vertex exactly on the origin → heightAt(0,0).
    const odd = bakeGroundHeight(heightAtX, EXTENT, 129);
    const centre = odd.data[(129 >> 1) * 129 + (129 >> 1)];
    expect(centre).toBeCloseTo(heightAtX(0, 0), 6);
  });

  it("never produces NaN or non-finite values", () => {
    const baked = bakeGroundHeight(heightAtX, EXTENT, RES);
    for (let i = 0; i < baked.data.length; i++) {
      expect(Number.isFinite(baked.data[i])).toBe(true);
    }
  });
});

describe("sampleBaked (normalized-UV lookup with edge clamp)", () => {
  const heightAtX = (x: number, _z: number) => x;
  const EXTENT = 200;
  const RES = 128;
  const baked = bakeGroundHeight(heightAtX, EXTENT, RES);

  it("reads back the cell values at their UV centres", () => {
    // UV maps [0,1] onto column/row [0, res-1]; the corners are u/v ∈ {0,1}.
    expect(sampleBaked(baked, 0, 0)).toBe(baked.data[0]);
    expect(sampleBaked(baked, 1, 0)).toBe(baked.data[RES - 1]);
    expect(sampleBaked(baked, 1, 1)).toBe(baked.data[RES * RES - 1]);
  });

  it("clamps out-of-extent UVs to the nearest edge sample (no overflow)", () => {
    // u beyond [0,1] must clamp to the edge column, NOT wrap or read OOB.
    expect(sampleBaked(baked, -5, 0.5)).toBe(sampleBaked(baked, 0, 0.5));
    expect(sampleBaked(baked, 5, 0.5)).toBe(sampleBaked(baked, 1, 0.5));
    expect(sampleBaked(baked, 0.5, -5)).toBe(sampleBaked(baked, 0.5, 0));
    expect(sampleBaked(baked, 0.5, 5)).toBe(sampleBaked(baked, 0.5, 1));
    // The clamped edge value equals heightAt at the extent edge (∓extent).
    expect(sampleBaked(baked, -5, 0.5)).toBe(-EXTENT);
    expect(sampleBaked(baked, 5, 0.5)).toBe(EXTENT);
  });

  it("stays finite for degenerate UVs (NaN folds to an in-range edge read)", () => {
    expect(Number.isFinite(sampleBaked(baked, NaN, NaN))).toBe(true);
    expect(Number.isFinite(sampleBaked(baked, Infinity, -Infinity))).toBe(true);
  });
});
