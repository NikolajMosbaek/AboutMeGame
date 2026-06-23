import * as THREE from "three";
import { bakeGroundHeight } from "./bakeGroundHeight.ts";
import { WORLD } from "./worldConfig.ts";

// THREE.DataTexture factory for the water `onBeforeCompile` foam band (G1 slice
// 2). The water plane has no per-fragment ground data and GLSL cannot call
// `terrain.heightAt`, so we bake `heightAt` ONCE over the island XZ extent (the
// pure `bakeGroundHeight`) and upload that grid as a single-channel R / Float32
// `DataTexture` the fragment samples to recover ground height. This module is
// the thin THREE upload wrapper around the pure bake — the GLSL transcription
// and the uniform wiring live in the boundaries patch.
//
// The DataTexture is tiny (128*128 floats ~= 64 KB VRAM) and adds ZERO download
// / bundle bytes (it is computed at build time from `heightAt`, not loaded), so
// it costs no draw calls and no triangles — see docs/perf-budget.md.

/** Texture resolution per side; matches the `bakeGroundHeight` grid. */
export const GROUND_TEXTURE_RES = 128;
/** Half-extent the grid spans on X and Z: the full island XZ extent, so the
 *  irregular coastline lands inside the texture rather than at its clamped
 *  edge. */
export const GROUND_TEXTURE_EXTENT = WORLD.islandRadius;

/** A built ground-height lookup texture and its disposer. */
export interface GroundHeightTexture {
  /** Single-channel R / Float32 DataTexture of baked ground heights. */
  texture: THREE.DataTexture;
  /** Release the GPU texture; call from the owner's `dispose()`. */
  dispose(): void;
}

/**
 * Bake `heightAt` over the island XZ extent and upload it as a single-channel
 * R / Float32 `DataTexture`, created ONCE.
 *
 * Sampling is `NearestFilter` + `ClampToEdgeWrapping` with no mipmaps — the
 * exact GPU sampler the CPU read-back `sampleBaked` mirrors, so a fragment
 * lookup at normalized UV recovers the same ground height the unit tests assert.
 * Heights stay SIGNED `Float32` (the masked rim sinks below sea level) so the
 * foam depth `seaLevel - groundHeight` is faithful in deep water. The texture is
 * built once at mount; `dispose()` releases it alongside the water geometry and
 * material.
 */
export function createGroundHeightTexture(
  heightAt: (x: number, z: number) => number,
): GroundHeightTexture {
  const baked = bakeGroundHeight(heightAt, GROUND_TEXTURE_EXTENT, GROUND_TEXTURE_RES);
  const texture = new THREE.DataTexture(
    // `bakeGroundHeight` allocates its own `ArrayBuffer`-backed Float32Array, so
    // this is sound at runtime; the cast only bridges the `@types/three`
    // `BufferSource` param vs TS's `ArrayBufferLike`-generic typed arrays.
    baked.data as unknown as BufferSource,
    GROUND_TEXTURE_RES,
    GROUND_TEXTURE_RES,
    THREE.RedFormat,
    THREE.FloatType,
  );
  texture.name = "groundHeight";
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  // Data textures hold linear values (signed heights, not colour) — no sRGB
  // decode. Flag it for upload on the first render.
  texture.needsUpdate = true;

  return {
    texture,
    dispose() {
      texture.dispose();
    },
  };
}
