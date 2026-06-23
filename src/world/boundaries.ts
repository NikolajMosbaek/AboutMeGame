import * as THREE from "three";
import { WORLD } from "./worldConfig.ts";
import { FOAM_DEPTH_END, FOAM_DEPTH_START } from "./waterSurface.ts";
import {
  FOAM_COLOR_LINEAR,
  WATER_DEEP_LINEAR,
  WATER_SHALLOW_LINEAR,
} from "./waterUniforms.ts";
import { makeWaterPatch } from "./waterPatch.ts";
import {
  GROUND_TEXTURE_EXTENT,
  createGroundHeightTexture,
  type GroundHeightTexture,
} from "./groundHeightTexture.ts";

export interface Boundaries {
  group: THREE.Group;
  /** True while (x,z) is inside the soft boundary. */
  isInBounds(x: number, z: number): boolean;
  /** Push a position back to the boundary ring if it strayed past it. Epic 3
   *  movement calls this so the player can't drive/fly off the world. */
  clampToBounds(pos: THREE.Vector3): void;
  dispose(): void;
}

/**
 * World boundaries (#21): a wide water plane the island sits in, and the
 * boundary maths that keeps the player on the map. The water is the visual
 * "you can't go further"; `clampToBounds` is the mechanism Epic 3 enforces.
 *
 * `heightAt` is an OPTIONAL dependency-injection seam (G1 slice 2, #116): when
 * supplied (by `buildWorld`, from `terrain.heightAt`) it bakes a ground-height
 * lookup `DataTexture` ONCE and the water `MeshStandardMaterial` is patched via
 * `onBeforeCompile` with the view-angle fresnel colour ramp PLUS the shoreline
 * foam band (transcribing `waterSurface.ts` line-for-line). When absent (the
 * unit tests / a preview without terrain) the no-foam variant is attached: the
 * water still renders the fresnel ramp, no sampler/uniform is referenced, and no
 * three warning is emitted. EITHER way the water stays exactly one PlaneGeometry
 * / one mesh / one draw call at `seaLevel - 0.05` — triangles ±0, no `uTime`, no
 * per-frame work — and the bounds maths is unchanged.
 */
export function buildBoundaries(
  heightAt?: (x: number, z: number) => number,
): Boundaries {
  const group = new THREE.Group();
  group.name = "boundaries";

  const waterGeo = new THREE.PlaneGeometry(WORLD.size * 3, WORLD.size * 3);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0.82,
    roughness: 0.25,
    metalness: 0.1,
  });

  // Bake the ground-height lookup texture only when `heightAt` is injected; the
  // foam variant samples it, the no-foam variant references nothing.
  const hasFoam = heightAt !== undefined;
  let groundTex: GroundHeightTexture | undefined;
  const uniforms: Record<string, { value: unknown }> = {
    // Palette is sRGB-authored in waterSurface.ts; gamma-decode to linear here
    // (the transport step) before it feeds the in-shader vec3 mix.
    uWaterShallow: { value: new THREE.Vector3(...WATER_SHALLOW_LINEAR) },
    uWaterDeep: { value: new THREE.Vector3(...WATER_DEEP_LINEAR) },
  };
  if (hasFoam) {
    groundTex = createGroundHeightTexture(heightAt);
    uniforms.uFoamColor = { value: new THREE.Vector3(...FOAM_COLOR_LINEAR) };
    // Foam edges arrive as uniforms from waterSurface.ts — never inline literals.
    uniforms.uFoamStart = { value: FOAM_DEPTH_START };
    uniforms.uFoamEnd = { value: FOAM_DEPTH_END };
    uniforms.uSeaLevel = { value: WORLD.seaLevel };
    uniforms.uGroundHeight = { value: groundTex.texture };
    uniforms.uGroundExtent = { value: GROUND_TEXTURE_EXTENT };
  }

  const patch = makeWaterPatch({ hasFoam, uniforms });
  waterMat.onBeforeCompile = patch.onBeforeCompile;
  waterMat.customProgramCacheKey = patch.customProgramCacheKey;
  // Keep the disposable texture reachable from the material for lifecycle tests
  // and so dispose() can release it without a closure-only handle.
  if (groundTex) waterMat.userData.groundHeightTexture = groundTex.texture;

  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = WORLD.seaLevel - 0.05;
  water.receiveShadow = false;
  water.name = "water";
  group.add(water);

  const r = WORLD.boundaryRadius;
  const isInBounds = (x: number, z: number) => x * x + z * z < r * r;
  const clampToBounds = (pos: THREE.Vector3) => {
    const d = Math.hypot(pos.x, pos.z);
    if (d > r) {
      const s = r / d;
      pos.x *= s;
      pos.z *= s;
    }
  };

  return {
    group,
    isInBounds,
    clampToBounds,
    dispose() {
      waterGeo.dispose();
      waterMat.dispose();
      groundTex?.dispose();
    },
  };
}
