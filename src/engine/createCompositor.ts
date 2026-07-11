import * as THREE from "three";
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  GodRaysEffect,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from "postprocessing";
import { N8AOPostPass } from "n8ao";
import type { QualityConfig } from "../perf/quality.ts";
import type { RenderDelegate } from "./types.ts";
import { configureCompositorColor } from "./compositorColor.ts";

/**
 * The post-processing compositor — the only place a pmndrs `postprocessing`
 * `EffectComposer` (or any of its passes/effects), or `n8ao`'s `N8AOPostPass`,
 * is constructed. Sibling to `createRenderer.ts`: like it, nothing that runs
 * under jsdom imports the WebGL-touching parts of this file, so the Vitest
 * suite stays WebGL-free — only the pure `buildEffectStack`/`buildAOPass`/
 * `buildPasses` below are exercised there (constructing an `Effect`/`Pass`
 * needs no WebGL context; only `EffectComposer.addPass`/`render`/`setSize` do,
 * once a real renderer is attached). It returns a `RenderDelegate`, the
 * minimal seam the Engine presents through (`EngineOptions.compositor`); the
 * Engine itself never sees a `postprocessing`/`n8ao` type.
 *
 * Built only on the medium/high tiers (where `quality.bloom` is true, gated in
 * `GameCanvas`) so the two genuine emissive sources — the site accents (page,
 * carvings, statue eyes) and later fireflies — visibly glow, and so N8AO's
 * ambient occlusion grounds contact shadows under trees/rocks/tent. On low,
 * nothing is constructed here at all: zero composer bytes (`n8ao` included —
 * see `vite.config.ts`'s `postfx` chunk bucket), zero post-processing fill
 * cost, and the Engine presents via the bare `renderer.render`.
 */
export type Compositor = RenderDelegate;

/**
 * Bloom look, tuned by eye against the warm palette in `scripts/verify-game.mjs`.
 * The threshold is deliberately HIGH so ordinary lit stone, the `#cfe4f2` sky
 * and water specular do NOT bloom — only the two promoted sources clear it.
 * This exact value is a load-bearing invariant: `src/world/landmarks.test.ts`,
 * `src/wildlife/fliers.ts` and `src/wildlife/jaguar.ts` all pin their emissive
 * intensities against it, so it must never move without updating those too.
 */
const BLOOM_LUMINANCE_THRESHOLD = 0.85;

/** Bloom intensity — tuned for visual parity with the three-examples-era
 *  `UnrealBloomPass(strength: 0.5, radius: 0.3)` look now that the algorithm is
 *  pmndrs's mipmap-blur bloom (a different blur/energy model, so the numbers
 *  aren't directly portable; this was tuned by eye against the same accents —
 *  the journal page, statue eyes and idol — via `npm run verify`'s screenshot). */
const BLOOM_INTENSITY = 1.4;

/**
 * Mip levels for the bloom mip-pyramid on medium vs high. `BloomEffect`'s
 * `resolution`/`resolutionScale` option (the literal analogue of the old
 * `UnrealBloomPass.setSize` half-res hack) only affects its LEGACY
 * `KawaseBlurPass` path — with `mipmapBlur: true` (the modern path this
 * compositor uses throughout) the pyramid always samples the full-resolution
 * input buffer at `MipmapBlurPass.setSize`, so `resolution.scale` is a
 * documented no-op there. `levels` is the real cost/quality knob for the
 * mipmap path: each level is one more downsample + upsample render pass, so
 * fewer levels is both cheaper AND a softer/coarser-radius glow — medium runs
 * fewer levels than the default; high keeps the library default (8).
 */
const BLOOM_LEVELS_HIGH = 8;
const BLOOM_LEVELS_MEDIUM = 6;

/** Vignette look — a subtle frame darkening, not a stylistic statement. */
const VIGNETTE_DARKNESS = 0.25;
const VIGNETTE_OFFSET = 0.3;

/** Duck-typed sun-direction accessor — `DayCycleSystem` (or any plain object
 *  with this one method) satisfies it. Declared LOCALLY rather than imported
 *  from `src/world/starfield.ts`'s identical-shaped interface, so this
 *  engine-layer file never crosses into world/gameplay code — the same
 *  layering `createRenderer.ts` already keeps (no `src/world` imports
 *  anywhere in `src/engine`). */
export interface SunDirectionSource {
  getSunDirection(): THREE.Vector3;
}

/**
 * World-unit distance the god-rays light-source mesh sits at along the sun
 * direction — far enough to read as a sky-bound source, safely inside the
 * camera's far plane (`buildWorld.ts` sets it to `WORLD.size * 2` = 1040
 * world units) with margin. Not derived from `WORLD.size` — this file stays
 * engine-only and never imports world config.
 */
const GOD_RAYS_DISTANCE = 850;
/** Tiny, cheap light-source sphere — its own render cost is negligible
 *  (8x8 segments); only its screen-space position matters to the effect. */
const GOD_RAYS_MESH_RADIUS = 6;

/**
 * How much the god-rays effect contributes (the merged pass's per-effect
 * blend opacity, 0..1) for sun-direction Y `sunDirY` (`= sin(elevation)`) —
 * 0 at a comfortably high (noon-strength) sun, rising to a modest 0.6 ceiling
 * as the sun gets low, so shafts read at dawn/dusk and are genuinely
 * invisible at noon rather than a constant wash. The SAME "how low is the
 * sun" shape `src/world/skyAtmosphere.ts`'s `lowSunFactor` already owns for
 * the dome's limb glow — duplicated here in miniature (not imported) so this
 * engine-layer file stays free of any `src/world` dependency.
 */
export function godRaysStrength(sunDirY: number): number {
  const clamped = sunDirY < -1 ? -1 : sunDirY > 1 ? 1 : sunDirY;
  const raised = clamped * 2 < 0 ? 0 : clamped * 2 > 1 ? 1 : clamped * 2;
  return 0.6 * (1 - raised);
}

/** The god-rays effect + its private light-source mesh, bundled with the one
 *  per-frame write (`update`) and its own disposal (the mesh's geometry and
 *  material are owned here, NOT by `GodRaysEffect` itself — it only reads the
 *  mesh it's given, so they need their own `dispose()`, separate from the
 *  effect's own — which the merged `EffectPass` disposes when the composer
 *  tears down). */
export interface GodRays {
  effect: GodRaysEffect;
  /** Reposition the light source along unit direction `dir` and fade the
   *  effect's contribution by how low the sun currently is — call once per
   *  frame, before compositing. */
  update(dir: THREE.Vector3): void;
  /** Disposes ONLY the externally-owned mesh resources (geometry/material) —
   *  `effect` itself is disposed by the merged `EffectPass`/`EffectComposer`
   *  teardown, never here (double-disposing the same `GodRaysEffect` is
   *  avoided by construction, not by a disposed-guard). */
  dispose(): void;
}

/**
 * Build the god-rays effect (visual-overhaul slice 5, high tier only) — a
 * small, cheap sphere standing in for the sun as pmndrs `postprocessing`'s
 * `GodRaysEffect` light source (its own internal pass tests it against the
 * main scene's depth, so it reads as occluded behind terrain/props exactly
 * like a real light shaft would). Subtle by design: `exposure`/`clampMax`
 * keep the shaft contribution soft, and the LIVE `update()` fade
 * (`godRaysStrength`) is what actually keeps it "near-invisible at noon,
 * visible at dawn/dusk" — the constructor options alone are NOT time-of-day
 * aware.
 */
function buildGodRays(camera: THREE.Camera): GodRays {
  const geometry = new THREE.SphereGeometry(GOD_RAYS_MESH_RADIUS, 8, 8);
  const material = new THREE.MeshBasicMaterial({ color: 0xfff4d6, toneMapped: false });
  const lightMesh = new THREE.Mesh(geometry, material);
  lightMesh.position.set(0, GOD_RAYS_DISTANCE, 0); // placeholder — update() repositions every frame

  const effect = new GodRaysEffect(camera, lightMesh, {
    samples: 40,
    density: 0.92,
    decay: 0.93,
    weight: 0.35,
    exposure: 0.35,
    clampMax: 0.65,
    blur: true,
  });
  effect.blendMode.opacity.value = 0; // starts invisible; the first update() sets the real value

  return {
    effect,
    update(dir) {
      lightMesh.position.copy(dir).multiplyScalar(GOD_RAYS_DISTANCE);
      // `lightMesh` is never added to any scene (see the constructor comment),
      // so nothing else ever calls `updateMatrixWorld()` on it — worse,
      // `GodRaysEffect.update()` (pmndrs `postprocessing`) itself SAVES
      // `matrixAutoUpdate`, forces it `false`, then calls
      // `updateWorldMatrix(true, false)`, whose `if (this.matrixAutoUpdate)
      // this.updateMatrix()` guard is now false, so `updateMatrix()` never
      // runs there — and `matrixWorld` only gets copied from `matrix` when
      // `matrixWorldNeedsUpdate` is already true. Net effect: left to that
      // library call alone, `matrixWorld` freezes at its construction-time
      // identity (world origin) forever, and every position write above is
      // silently discarded. Compute both ourselves, right here, every frame:
      // `updateMatrix()` bakes `position` into `matrix` (and flips
      // `matrixWorldNeedsUpdate` true); since this mesh has no parent, its
      // world matrix IS its local matrix, so copying it across is exact — the
      // same `parent === null` branch `Object3D.updateWorldMatrix` itself
      // would take, done eagerly instead of leaving it to a call that (for
      // this mesh) never actually takes it.
      lightMesh.updateMatrix();
      lightMesh.matrixWorld.copy(lightMesh.matrix);
      effect.blendMode.opacity.value = godRaysStrength(dir.y);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * Build the N8AO ambient-occlusion pass (visual-overhaul slice 2, medium/high
 * only — it lives in this same lazy `postfx` chunk, behind the same
 * `quality.bloom` gate as the rest of this file). The look constants
 * (`aoRadius`/`distanceFalloff`/`intensity`) come from `quality.ao` — tuned
 * once, in `perf/quality.ts`, for this world's scale (520-unit island,
 * 1.7-unit eye height): grounded contact darkening under trees/rocks/tent, not
 * a dirty-corners look. Only `qualityMode` (the sample-count preset) differs
 * by tier — `setQualityMode` is called once here, at construction, per its own
 * docs (it recompiles shaders; per-frame reassignment would be expensive).
 * `halfRes` is on for both compositor tiers — N8AO's own docs measure a 2-4x
 * speed win from it with "negligible" quality loss (depth-aware upsampling),
 * a deliberate mobile-fill-rate-first default matching this team's "cap
 * fill-rate spend before touching triangles" doctrine.
 *
 * `gammaCorrection` is explicit `false`: this pass is never the LAST pass in
 * the chain (the merged bloom/SMAA/vignette/tone-map `EffectPass` always
 * follows it, and owns the sole sRGB encode) — n8ao's own auto-detection
 * targets exactly this case but its README calls out that the heuristic
 * "sometimes fails", so this is set explicitly rather than trusted to infer.
 */
export function buildAOPass(
  scene: THREE.Scene,
  camera: THREE.Camera,
  quality: QualityConfig,
): N8AOPostPass {
  const pass = new N8AOPostPass(scene, camera);
  pass.configuration.aoRadius = quality.ao.aoRadius;
  pass.configuration.distanceFalloff = quality.ao.distanceFalloff;
  pass.configuration.intensity = quality.ao.intensity;
  pass.configuration.halfRes = quality.ao.halfRes;
  pass.configuration.gammaCorrection = false;
  pass.setQualityMode(quality.ao.qualityMode);
  return pass;
}

/** The merged effect stack for the medium/high compositor path. Each effect is
 *  a plain object graph (uniforms + GLSL strings) with no WebGL calls in its
 *  constructor, so this is safe to build headless in a test — only
 *  `EffectComposer.addPass` (which reads live renderer state) needs a real
 *  `WebGLRenderer`. */
export interface EffectStack {
  bloom: BloomEffect;
  smaa: SMAAEffect;
  vignette: VignetteEffect;
  toneMapping: ToneMappingEffect;
}

/**
 * Build the four effects that make up the compositor's look. Pure aside from
 * the `postprocessing`/`three` object construction — no renderer, no scene,
 * no camera touched — so it is unit-tested headless for the tuned constants
 * (bloom threshold, AgX mode, vignette look) and the per-tier mip-level count.
 */
export function buildEffectStack(quality: QualityConfig): EffectStack {
  // Medium runs a shorter mip pyramid (cheaper, slightly softer glow); high
  // keeps the library default. Low never reaches this function at all (no
  // compositor is built).
  const levels = quality.tier === "medium" ? BLOOM_LEVELS_MEDIUM : BLOOM_LEVELS_HIGH;
  const bloom = new BloomEffect({
    mipmapBlur: true,
    luminanceThreshold: BLOOM_LUMINANCE_THRESHOLD,
    intensity: BLOOM_INTENSITY,
    levels,
  });

  const smaa = new SMAAEffect();
  const vignette = new VignetteEffect({ darkness: VIGNETTE_DARKNESS, offset: VIGNETTE_OFFSET });
  // AgX — matches the bare (low-tier) renderer path's tone-map
  // (`configureBareRendererColor`) so both grade identically; this is the ONE
  // place in the composited chain that owns tone-mapping (`configureCompositorColor`
  // switches the renderer itself to `NoToneMapping` so it never double-applies).
  const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.AGX });

  return { bloom, smaa, vignette, toneMapping };
}

/**
 * Build the three passes the composer runs: a `RenderPass`, the N8AO
 * ambient-occlusion pass, and ONE merged `EffectPass` housing every fullscreen
 * effect (bloom, SMAA, vignette, tone mapping, and — high tier only — god
 * rays). Merging is the whole point of using pmndrs `postprocessing` over the
 * old pass-per-effect `EffectComposer` chain — it costs one fullscreen
 * fragment pass instead of several for that group, which is the mobile
 * fill-rate win; N8AO needs its own separate pass (it isn't a pmndrs `Effect`
 * that could merge into the `EffectPass`) and per n8ao's own README must sit
 * BEFORE it — ambient occlusion has to modulate the lit scene before
 * bloom/tone-mapping run, not after. God rays is listed FIRST among the
 * merged effects (right after AO, before bloom) so its own scene-space light
 * shafts still pick up bloom's glow rather than bypassing it. Like
 * `buildEffectStack`, constructing these needs no WebGL context, so it is
 * unit-tested headless.
 */
export function buildPasses(
  scene: THREE.Scene,
  camera: THREE.Camera,
  quality: QualityConfig,
): {
  renderPass: RenderPass;
  aoPass: N8AOPostPass;
  effectPass: EffectPass;
  stack: EffectStack;
  /** Non-null only on the high tier — the effect + its light-source mesh,
   *  with the per-frame `update()`/`dispose()` the caller must drive. */
  godRays: GodRays | null;
} {
  const stack = buildEffectStack(quality);
  const renderPass = new RenderPass(scene, camera);
  const aoPass = buildAOPass(scene, camera, quality);
  const godRays = quality.tier === "high" ? buildGodRays(camera) : null;
  const effectPass = godRays
    ? new EffectPass(camera, godRays.effect, stack.bloom, stack.smaa, stack.vignette, stack.toneMapping)
    : new EffectPass(camera, stack.bloom, stack.smaa, stack.vignette, stack.toneMapping);
  return { renderPass, aoPass, effectPass, stack, godRays };
}

/**
 * Build the post-processing compositor for a medium/high mount.
 *
 * Chain: `RenderPass(scene,camera)` → `N8AOPostPass` (ambient occlusion) → one
 * merged `EffectPass` (bloom + SMAA + vignette + AgX tone mapping).
 *
 * Colour ownership: `configureCompositorColor` switches the renderer to
 * `NoToneMapping` (leaving `outputColorSpace` at `SRGBColorSpace`) so it draws
 * scene-linear HDR into the composer's `HalfFloatType` input buffer instead of
 * tone-mapping on the way in; the `ToneMappingEffect` inside the merged
 * `EffectPass` applies AgX exactly once, at the very end of the chain, and the
 * `EffectPass` itself sRGB-encodes the final present (postprocessing "follows
 * suit" from the renderer's `outputColorSpace` — see the `postprocessing`
 * README's "Color Management"/"Tone Mapping" sections). `HalfFloatType`
 * buffers are what make this safe: `UnsignedByteType` buffers would clamp to
 * `[0,1]` before bloom/tone-mapping ever saw the light, per the same README.
 *
 * `sunSource` (visual-overhaul slice 5) is the god-rays light-source driver —
 * on the high tier, `render()` repositions the light-source mesh and fades
 * the effect's contribution from it every frame BEFORE compositing; absent
 * or on any other tier, god rays is simply never built (`buildPasses`) and
 * this parameter is inert.
 */
export function createBloomCompositor(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  quality: QualityConfig,
  sunSource?: SunDirectionSource,
): Compositor {
  configureCompositorColor(renderer);

  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  const { renderPass, aoPass, effectPass, godRays } = buildPasses(scene, camera, quality);

  composer.addPass(renderPass);
  composer.addPass(aoPass);
  composer.addPass(effectPass);

  return {
    render() {
      if (godRays && sunSource) godRays.update(sunSource.getSunDirection());
      composer.render();
    },

    setSize(width: number, height: number) {
      // `EffectComposer.setSize` takes CSS-pixel dimensions directly (unlike
      // the old three-examples `EffectComposer`, which needed dpr baked in by
      // hand): it calls `renderer.setSize(width, height)` itself if they
      // differ from the renderer's current size (a no-op here, since `Engine`
      // already called `renderer.setSize` with these same values just before
      // this), then reads `renderer.getDrawingBufferSize()` — which already
      // accounts for pixel ratio — to size every internal buffer/pass. So no
      // manual dpr multiplication is needed on this seam any more.
      composer.setSize(width, height);
    },

    dispose() {
      // `composer.dispose()` disposes every registered pass — the `RenderPass`,
      // `N8AOPostPass` (frees its render targets), and the merged `EffectPass`
      // (whose own `dispose()` disposes each of its effects in turn: bloom,
      // SMAA, vignette, tone mapping, and — high tier — god rays) — so the
      // whole stack is freed by this one call. `godRays.dispose()` additionally
      // frees the light-source mesh's geometry/material, which `GodRaysEffect`
      // never owned (see `GodRays`'s own doc for why this is not a double-free).
      composer.dispose();
      godRays?.dispose();
    },
  };
}
