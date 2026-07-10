import * as THREE from "three";
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
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
 * effect (bloom, SMAA, vignette, tone mapping). Merging the LATTER into a
 * single `EffectPass` is the whole point of using pmndrs `postprocessing` over
 * the old pass-per-effect `EffectComposer` chain — it costs one fullscreen
 * fragment pass instead of four for that group, which is the mobile fill-rate
 * win; N8AO needs its own separate pass (it isn't a pmndrs `Effect` that could
 * merge into the `EffectPass`) and per n8ao's own README must sit BEFORE it —
 * ambient occlusion has to modulate the lit scene before bloom/tone-mapping
 * run, not after. Like `buildEffectStack`, constructing these needs no WebGL
 * context, so it is unit-tested headless.
 */
export function buildPasses(
  scene: THREE.Scene,
  camera: THREE.Camera,
  quality: QualityConfig,
): { renderPass: RenderPass; aoPass: N8AOPostPass; effectPass: EffectPass; stack: EffectStack } {
  const stack = buildEffectStack(quality);
  const renderPass = new RenderPass(scene, camera);
  const aoPass = buildAOPass(scene, camera, quality);
  const effectPass = new EffectPass(camera, stack.bloom, stack.smaa, stack.vignette, stack.toneMapping);
  return { renderPass, aoPass, effectPass, stack };
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
 */
export function createBloomCompositor(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  quality: QualityConfig,
): Compositor {
  configureCompositorColor(renderer);

  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  const { renderPass, aoPass, effectPass } = buildPasses(scene, camera, quality);

  composer.addPass(renderPass);
  composer.addPass(aoPass);
  composer.addPass(effectPass);

  return {
    render() {
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
      // SMAA, vignette, tone mapping) — so the whole stack is freed by this
      // one call.
      composer.dispose();
    },
  };
}
