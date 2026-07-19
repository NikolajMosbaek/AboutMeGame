import * as THREE from "three";
import { WORLD } from "./worldConfig.ts";
import { FOAM_DEPTH_END, FOAM_DEPTH_START } from "./waterSurface.ts";
import {
  FOAM_COLOR_LINEAR,
  WATER_DEEP_DETAIL_LINEAR,
  WATER_DEEP_LINEAR,
  WATER_SHALLOW_DETAIL_LINEAR,
  WATER_SHALLOW_LINEAR,
} from "./waterUniforms.ts";
import { makeWaterPatch } from "./waterPatch.ts";
import {
  GROUND_TEXTURE_EXTENT,
  createGroundHeightTexture,
  type GroundHeightTexture,
} from "./groundHeightTexture.ts";
import {
  FLOW_TEXTURE_EXTENT,
  buildRiverFlowTexture,
  type RiverFlowTexture,
} from "./riverFlowTexture.ts";
import { loadTexture } from "../engine/assets.ts";

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

/** Injectable ripple-normal-map texture loader (visual-overhaul slice 4) —
 *  defaults to the cached, `assetUrl`-resolving `loadTexture`
 *  (`src/engine/assets.ts`). Matches its signature exactly (mirrors
 *  `terrain.ts`'s `TerrainTextureLoader`) so tests can substitute a stub that
 *  never touches the network/jsdom `Image` loading path. */
export type WaterTextureLoader = (path: string) => Promise<THREE.Texture>;

const RIPPLE_NORMAL_PATH = "assets/textures/water/ripple-normal.webp";

/** Base-tier roughness (byte-identical to the pre-slice-4 water — the low
 *  tier, and the detail tier's own first paint before its ripple texture
 *  attaches, both use this). */
export const WATER_ROUGHNESS_BASE = 0.25;
/** Detail-tier roughness (visual-overhaul slice 4): lower than the base value
 *  so the sky IBL + ripple-normal detail (slice 2/4) produce a lively sun
 *  glitter path at noon without white-out, and long soft reflections at dusk —
 *  tuned by eye against real screenshots (see the slice's run-log entry). Only
 *  ever applied when `detail` is on; the low tier keeps {@link WATER_ROUGHNESS_BASE}. */
export const WATER_ROUGHNESS_DETAIL = 0.28; // jungle-water fix: less mirror-like than 0.12, so grazing angles don't glare to a white sheet — a jungle river isn't a mirror
/** Detail-tier environment-reflection strength (jungle-water fix, 2026-07-19).
 *  The glossy detail water reflected the FULL sky-dome IBL (`envMapIntensity`
 *  defaults to 1.0), which at grazing angles washed the river toward the sky's
 *  tone. Dimming the water's OWN env reflection to 0.35 (a per-material
 *  scalar, so terrain/flora IBL is untouched), alongside the higher
 *  {@link WATER_ROUGHNESS_DETAIL} and the deepened detail palette
 *  (`waterSurface.ts`) + raised absorption, lets the dark jungle-river tone
 *  read while the shallow lagoon stays tropical. The low tier keeps the full
 *  1.0 (its rougher water already blurs the sky, and low ships byte-identical
 *  water). */
export const WATER_ENV_INTENSITY_DETAIL = 0.35;

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
  /** Resolves once the async ripple-normal-map load has settled (attached on
   *  success, logged-and-skipped on failure) — never rejects (mirrors
   *  `Terrain.texturesReady`'s idiom). `Promise.resolve()` immediately when
   *  `detail` is off (low tier, or detail requested without its `displacement`/
   *  `heightAt` prerequisites) — no fetch is ever made in that case. */
  texturesReady: Promise<void>;
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
 * `detail` (visual-overhaul slice 4, defaults false) is the third seam —
 * gated by `quality.waterDetail === "full"` (off on low, on medium/high) —
 * AND requires BOTH `hasFoam` and `displacement` (see `wantDetail` below);
 * when all three hold, a ripple-normal-map texture loads ASYNCHRONOUSLY
 * (mirroring `Terrain.texturesReady`): the water renders the base slice-2/3
 * look the instant this function returns, then upgrades in place — ripple
 * sparkle + depth-based colour absorption + raggedized foam edges + a lower,
 * livelier-glint roughness — once the texture attaches
 * ({@link Boundaries.texturesReady}). Off (low), the water is byte-identical
 * to before this slice: no texture fetch, no shader change beyond what
 * `displacement`/foam already did.
 *
 * EITHER way the water stays exactly one geometry / one mesh / ONE draw call at
 * `seaLevel - 0.05`, the triangle count is fixed at mount and far under the 500k
 * budget, and the bounds maths is unchanged.
 *
 * `anisotropy` (defaults 8, the high-tier value) sets the ripple-normal
 * texture's `tex.anisotropy` once it attaches — the water is viewed at grazing
 * angles almost the entire session (swimming, the follow camera skimming the
 * shore), the worst case for the aniso=1 default (shimmer/blur), so this
 * mirrors `terrain.ts`'s `quality.textureAnisotropy` exactly (same shared
 * quality knob, not a per-feature duplicate). Only reached when `detail` is on.
 */
export function buildBoundaries(
  heightAt?: (x: number, z: number) => number,
  displacement = true,
  detail = false,
  anisotropy = 8,
  loadWaterTexture: WaterTextureLoader = loadTexture,
): Boundaries {
  const group = new THREE.Group();
  group.name = "boundaries";

  // Subdivide only when the swell is compiled — a flat quad has no interior
  // vertices to displace, so visibility needs the grid; low keeps the 1×1 quad.
  const segs = displacement ? WATER_SEGMENTS : 1;
  const waterGeo = new THREE.PlaneGeometry(WORLD.size * 3, WORLD.size * 3, segs, segs);
  waterGeo.rotateX(-Math.PI / 2);

  // Detail (visual-overhaul slice 4: ripple normal maps + depth absorption +
  // foam breakup) needs BOTH the baked ground-height depth (hasFoam) and the
  // live uTime the ripple scroll reuses (displacement) — AND them defensively,
  // same discipline as `makeWaterPatch`'s own gate, so an invalid combination
  // degrades to the base look instead of ever requesting a texture it has no
  // shader slot for.
  const hasFoam = heightAt !== undefined;
  const wantDetail = detail && hasFoam && displacement;
  const waterMat = new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0.82,
    // Roughness is a plain material scalar (not shader-compiled), so it is
    // safe to set eagerly by `wantDetail` even before the async ripple
    // texture attaches below — no shader recompile, no visual pop risk beyond
    // a barely-perceptible glossiness step once loaded.
    roughness: wantDetail ? WATER_ROUGHNESS_DETAIL : WATER_ROUGHNESS_BASE,
    metalness: 0.1,
    // Dim the sky-dome reflection on the detail tier ONLY (see the constant):
    // the glare, not the diffuse tone, was what read as a white river sheet.
    envMapIntensity: wantDetail ? WATER_ENV_INTENSITY_DETAIL : 1.0,
    // Swimming (#184) puts the camera under the plane: without the back
    // faces the surface would vanish overhead. Cost: the water's fragments
    // shade from below too — one 64×64 plane, a few extra ms of fill only
    // while the surface is actually on screen from beneath; no extra draw
    // call (three renders both sides in the same pass).
    side: THREE.DoubleSide,
  });

  // Bake the ground-height lookup texture only when `heightAt` is injected; the
  // foam variant samples it, the no-foam variant references nothing.
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
  // The detail-tier ripple scroll (visual-overhaul slice 4) reuses this EXACT
  // object once its texture attaches below — no second clock, so the
  // WaterSystem's reduced-motion hold already covers the ripple scroll too.
  let waterUniforms: WaterUniforms | undefined;
  if (displacement) {
    const uTime = { value: 0 };
    uniforms.uTime = uTime;
    waterUniforms = { uTime };
  }

  // Synchronous first paint — foam + optional displacement, EXACTLY the
  // slice-2/3 look (never `detail` yet): mirrors `Terrain`'s texturesReady
  // idiom, rendering correctly the instant `buildBoundaries` returns and
  // upgrading in place once the async ripple-normal texture attaches below.
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

  let disposed = false;
  // Populated by `attachWaterDetail` the moment it attaches — same
  // explicit-texture-dispose convention `terrain.ts`/`props.ts` follow.
  const attachedTextures: THREE.Texture[] = [];
  // The baked river-flow field (living-water epic) — a synchronous 128² bake,
  // built only for the detail tier that samples it.
  const riverFlow: RiverFlowTexture | null = wantDetail ? buildRiverFlowTexture() : null;
  const texturesReady = wantDetail
    ? attachWaterDetail(
        waterMat,
        uniforms,
        hasFoam,
        displacement,
        anisotropy,
        loadWaterTexture,
        () => disposed,
        attachedTextures,
        riverFlow!,
      )
    : Promise.resolve();

  return {
    group,
    isInBounds,
    clampToBounds,
    waterUniforms,
    texturesReady,
    dispose() {
      disposed = true;
      waterGeo.dispose();
      waterMat.dispose();
      groundTex?.dispose();
      riverFlow?.dispose();
      for (const tex of attachedTextures) tex.dispose();
    },
  };
}

/**
 * Load the ripple-normal texture and attach the detail water patch in ONE
 * atomic step (mirrors `terrain.ts`'s `attachTerrainTextures`): builds the
 * detail uniform bag (the caller's base uniforms — including the identity-
 * stable `uTime` the live `WaterSystem` advances — PLUS the ripple sampler and
 * the detail palette), rewires `mat.onBeforeCompile`/`customProgramCacheKey`
 * from `makeWaterPatch({ ..., detail: true })`, and flips `mat.needsUpdate`.
 * Never rejects: a failed load is logged and the base (slice-2/3) look simply
 * never upgrades.
 *
 * `isDisposed` guards the unmount race: if `Boundaries.dispose()` ran while
 * the load was in flight, the just-uploaded texture is disposed instead of
 * attached to a dead material.
 */
function attachWaterDetail(
  mat: THREE.MeshStandardMaterial,
  baseUniforms: Record<string, { value: unknown }>,
  hasFoam: boolean,
  displacement: boolean,
  anisotropy: number,
  loadWaterTexture: WaterTextureLoader,
  isDisposed: () => boolean,
  outAttachedTextures: THREE.Texture[],
  riverFlow: RiverFlowTexture,
): Promise<void> {
  return loadWaterTexture(RIPPLE_NORMAL_PATH)
    .then((tex) => {
      if (isDisposed()) {
        tex.dispose();
        return;
      }

      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      // Grazing-angle viewing (swimming, the shoreline skim) is the worst case
      // for the aniso=1 default — mirrors terrain.ts's `quality.textureAnisotropy`
      // wiring (terrain.ts:286,292) so water gets the same filtering floor.
      tex.anisotropy = anisotropy;
      // Normal-map data is NOT perceptual colour — never sRGB-decode it
      // (mirrors terrain.ts's normal-map override of loadTexture's default).
      tex.colorSpace = THREE.NoColorSpace;

      const uniforms: Record<string, { value: unknown }> = {
        ...baseUniforms,
        uWaterNormal: { value: tex },
        uWaterShallowDetail: { value: new THREE.Vector3(...WATER_SHALLOW_DETAIL_LINEAR) },
        uWaterDeepDetail: { value: new THREE.Vector3(...WATER_DEEP_DETAIL_LINEAR) },
        // The baked river-flow field (living-water epic): the stream reads
        // as a stream — drifting streak lanes inside the channel.
        uRiverFlow: { value: riverFlow.texture },
        uFlowExtent: { value: FLOW_TEXTURE_EXTENT },
      };
      const patch = makeWaterPatch({ hasFoam, uniforms, displacement, detail: true });
      mat.onBeforeCompile = patch.onBeforeCompile;
      mat.customProgramCacheKey = patch.customProgramCacheKey;
      mat.needsUpdate = true;
      outAttachedTextures.push(tex);
    })
    .catch((err: unknown) => {
      console.error("water ripple-normal texture failed to load — keeping the base water look:", err);
    });
}
