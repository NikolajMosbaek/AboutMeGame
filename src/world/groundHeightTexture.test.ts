import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { bakeGroundHeight, sampleBaked } from "./bakeGroundHeight.ts";
import {
  GROUND_TEXTURE_EXTENT,
  GROUND_TEXTURE_RES,
  createGroundHeightTexture,
} from "./groundHeightTexture.ts";
import { WORLD } from "./worldConfig.ts";

// T3 — the DataTexture factory for the water `onBeforeCompile` foam band (G1
// slice 2). The pure CPU bake (`bakeGroundHeight`) is proven elsewhere; this
// file proves the THREE upload object: a single-channel R / Float32 DataTexture
// at the agreed resolution and extent, with the nearest + edge-clamp sampler the
// CPU read-back (`sampleBaked`) mirrors, created once and disposable. The
// DataTexture is a CPU-side object — no WebGL context is needed to build it — so
// this runs headless under jsdom like the rest of the world suite.

describe("createGroundHeightTexture (R-channel ground-height DataTexture)", () => {
  // `heightAt(x,z) = x`: value independent of z, so the texture must vary only
  // across columns and match `bakeGroundHeight`'s grid exactly.
  const heightAtX = (x: number, _z: number) => x;

  it("yields a 128x128 single-channel R / Float32 DataTexture", () => {
    const { texture } = createGroundHeightTexture(heightAtX);
    expect(texture).toBeInstanceOf(THREE.DataTexture);
    expect(texture.image.width).toBe(GROUND_TEXTURE_RES);
    expect(texture.image.height).toBe(GROUND_TEXTURE_RES);
    expect(GROUND_TEXTURE_RES).toBe(128);
    expect(texture.format).toBe(THREE.RedFormat);
    expect(texture.type).toBe(THREE.FloatType);
    // One float per texel, R-channel only. `image.data` is typed nullable
    // (three widened `DataTextureImageData` generically); we always construct
    // it with real data, so the non-null assertion is safe here.
    expect(texture.image.data).toBeInstanceOf(Float32Array);
    expect(texture.image.data!.length).toBe(GROUND_TEXTURE_RES * GROUND_TEXTURE_RES);
  });

  it("samples over WORLD.islandRadius extent and the foam reaches into open water", () => {
    // The grid must span the island XZ extent so the irregular coastline (where
    // groundHeight crosses sea level) lands inside the texture, not at its edge.
    expect(GROUND_TEXTURE_EXTENT).toBe(WORLD.islandRadius);
  });

  it("uses the nearest + edge-clamp sampler the CPU read-back mirrors", () => {
    const { texture } = createGroundHeightTexture(heightAtX);
    // ClampToEdge (no wrap) + Nearest match `sampleBaked`'s edge-clamp/round.
    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(texture.magFilter).toBe(THREE.NearestFilter);
    expect(texture.minFilter).toBe(THREE.NearestFilter);
    // No mipmaps for a single-channel data lookup.
    expect(texture.generateMipmaps).toBe(false);
    // Flagged for upload on first render: `needsUpdate` is a write-only setter
    // that bumps `version`, so the observable signal is version > 0.
    expect(texture.version).toBeGreaterThan(0);
  });

  it("holds exactly the bakeGroundHeight grid (read back via sampleBaked at sampled cells)", () => {
    const { texture } = createGroundHeightTexture(heightAtX);
    const baked = bakeGroundHeight(heightAtX, GROUND_TEXTURE_EXTENT, GROUND_TEXTURE_RES);
    // `@types/three` types `image.data` as Uint8Array; ours is the Float32
    // buffer we uploaded, so narrow through `unknown`.
    const data = texture.image.data as unknown as Float32Array;
    // The texture data is the baked grid verbatim (corners + a mid cell).
    expect(data[0]).toBe(baked.data[0]);
    expect(data[GROUND_TEXTURE_RES - 1]).toBe(baked.data[GROUND_TEXTURE_RES - 1]);
    expect(data[data.length - 1]).toBe(baked.data[baked.data.length - 1]);
    // A UV read of the texture data matches the CPU read-back of the bake.
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [0.5, 0.5],
      [1, 1],
    ] as const) {
      const fromTexture = sampleBaked({ data, res: GROUND_TEXTURE_RES, extent: GROUND_TEXTURE_EXTENT }, u, v);
      expect(fromTexture).toBe(sampleBaked(baked, u, v));
    }
  });

  it("dispose() releases the texture (fires its dispose event once)", () => {
    const { texture, dispose } = createGroundHeightTexture(heightAtX);
    let disposals = 0;
    texture.addEventListener("dispose", () => {
      disposals++;
    });
    dispose();
    expect(disposals).toBe(1);
  });
});
