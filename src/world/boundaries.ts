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

/**
 * Fixed, measured subdivision count per side of the animated water plane (G1
 * slice 3). A `PlaneGeometry(size*3, size*3, N, N)` has `(N+1)²` vertices and
 * `N·N·2` triangles — at 64 that is 4225 verts / 8192 tris, well under 2% of the
 * 500k-tri/frame budget (`docs/perf-budget.md`). A flat 1×1 quad has no interior
 * vertices to displace, so the swell needs interior subdivision to be visible;
 * this is a PERF knob (measured against the ≥30 fps mobile floor), not art taste.
 * Only paid when `displacement` is on (medium/high); low keeps the 1×1 quad.
 */
export const WATER_SEGMENTS = 64;

/** The live `{value}` uniform objects the `WaterSystem` advances by reference
 *  (G1 slice 3). The SAME objects merged into the water material in
 *  `onBeforeCompile`, so mutating `uTime.value` here updates the running shader
 *  with no scene traversal and no post-compile staleness. */
export interface WaterUniforms {
  uTime: { value: number };
}

export interface Boundaries {
  group: THREE.Group;
  /** True while (x,z) is inside the soft boundary. */
  isInBounds(x: number, z: number): boolean;
  /** Push a position back to the boundary ring if it strayed past it. Epic 3
   *  movement calls this so the player can't drive/fly off the world. */
  clampToBounds(pos: THREE.Vector3): void;
  /** The live water uniforms the `WaterSystem` advances, present ONLY when
   *  `displacement` is on (medium/high). Undefined on the low tier / the static
   *  preview, where the water is the slice-2 surface with no `uTime`. */
  waterUniforms?: WaterUniforms;
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
 * three warning is emitted.
 *
 * `displacement` (G1 slice 3, defaults true) is the second seam — gated by
 * `quality.waterDisplacement` (off on low, on medium/high). When ON, the plane
 * is subdivided to {@link WATER_SEGMENTS}×{@link WATER_SEGMENTS} (a flat quad has
 * no interior vertices to displace) and the water patch compiles the two-sine
 * vertex swell driven by a live `uTime` uniform; the live `{value}` object is
 * exposed on the returned handle as {@link Boundaries.waterUniforms} so the
 * `WaterSystem` can advance it BY REFERENCE — no scene traversal, no post-compile
 * staleness. When OFF (low) the geometry stays the static slice-2 1×1 quad, no
 * `uTime` is compiled, and no per-frame work is owed — so low pays ZERO extra
 * vertex cost.
 *
 * EITHER way the water stays exactly one geometry / one mesh / ONE draw call at
 * `seaLevel - 0.05`, the triangle count is fixed at mount and far under the 500k
 * budget, and the bounds maths is unchanged.
 */
export function buildBoundaries(
  heightAt?: (x: number, z: number) => number,
  displacement = true,
): Boundaries {
  const group = new THREE.Group();
  group.name = "boundaries";

  // Subdivide only when the swell is compiled — a flat quad has no interior
  // vertices to displace, so visibility needs the grid; low keeps the 1×1 quad.
  const segs = displacement ? WATER_SEGMENTS : 1;
  const waterGeo = new THREE.PlaneGeometry(WORLD.size * 3, WORLD.size * 3, segs, segs);
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

  // The live time uniform — created ONLY when the swell is compiled. It is the
  // SAME `{value}` object merged into the program by `onBeforeCompile`, so the
  // `WaterSystem` advances the running shader by mutating it (no scene hunt).
  let waterUniforms: WaterUniforms | undefined;
  if (displacement) {
    const uTime = { value: 0 };
    uniforms.uTime = uTime;
    waterUniforms = { uTime };
  }

  const patch = makeWaterPatch({ hasFoam, uniforms, displacement });
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
    waterUniforms,
    dispose() {
      waterGeo.dispose();
      waterMat.dispose();
      groundTex?.dispose();
    },
  };
}
