import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { QualityConfig } from "../perf/quality.ts";
import type { RenderDelegate } from "./types.ts";

/**
 * The post-processing compositor — the only place an `EffectComposer` (and any
 * `three/examples/jsm/postprocessing/*` pass) is constructed. Sibling to
 * `createRenderer.ts`: like it, nothing that runs under jsdom imports this file,
 * so the Vitest suite stays WebGL-free. It returns a `RenderDelegate`, the
 * minimal seam the Engine presents through (`EngineOptions.compositor`); the
 * Engine itself never sees a `three/examples/jsm` type.
 *
 * Built only on the medium/high tiers (where `quality.bloom` is true) so the two
 * genuine emissive sources — the beacons and the tower lamp — visibly glow. On
 * low, `GameCanvas` injects nothing and the Engine presents via the bare
 * `renderer.render`, so zero composer bytes are constructed and there is no
 * post-processing fill-rate cost.
 */
export type Compositor = RenderDelegate;

/** Bloom look, tuned by eye against the warm palette in `scripts/verify-game.mjs`.
 *  The threshold is deliberately HIGH so ordinary lit stone, the `#cfe4f2` sky
 *  and water specular do NOT bloom — only the two promoted sources clear it. */
const BLOOM_STRENGTH = 0.5;
const BLOOM_RADIUS = 0.3;
const BLOOM_THRESHOLD = 0.85;

/**
 * Build the bloom compositor for a medium/high mount.
 *
 * Chain: `RenderPass(scene,camera)` → `UnrealBloomPass` → `OutputPass`.
 *
 * Colour ownership moves to the chain while it is the one presenting: the
 * renderer is switched to `NoToneMapping` / `LinearSRGBColorSpace` so the
 * `RenderPass` writes *linear* HDR into the composer's HalfFloat targets, bloom
 * adds light in that linear space, and `OutputPass` applies ACES + sRGB exactly
 * once at the end. This keeps the base (non-glowing) pixels identical to the
 * plain low path — only the added light differs — and avoids a double tone-map.
 * The plain low path is untouched: `createRenderer` still sets ACES + sRGB and
 * the renderer presents directly.
 */
export function createBloomCompositor(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  quality: QualityConfig,
): Compositor {
  // Hand final tone-mapping + encoding to OutputPass while the chain presents.
  // RenderPass now renders linear; bloom sums in linear HDR; OutputPass encodes.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const composer = new EffectComposer(renderer);
  // The composer normally bakes `renderer.getPixelRatio()` into an internal
  // `_pixelRatio` it multiplies every `setSize` by. We instead own dpr scaling
  // explicitly (see `setSize`), so neutralise the internal factor — this makes
  // the buffers exactly the dimensions we pass and decouples them from any later
  // live pixel-ratio change on the renderer.
  composer.setPixelRatio(1);

  const renderPass = new RenderPass(scene, camera);

  // The constructor resolution is dead weight here: `EffectComposer.addPass`
  // (and every `setSize`) immediately overwrites it with the composer's
  // effective dimensions. The real per-tier bloom-buffer sizing is owned by
  // `setSize` below — a placeholder Vector2 is all the constructor needs.
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(1, 1),
    BLOOM_STRENGTH,
    BLOOM_RADIUS,
    BLOOM_THRESHOLD,
  );

  const outputPass = new OutputPass();

  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);

  const isMedium = quality.tier === "medium";

  return {
    render() {
      composer.render();
    },

    setSize(width: number, height: number) {
      // Read dpr from the renderer so the composer buffers track the actual
      // drawing buffer, not CSS pixels. With the internal factor neutralised
      // above, `setSize(w*dpr, h*dpr)` yields a base RenderPass + rt1/rt2 at
      // exactly `w*dpr` — pixel-identical to the low path's drawing buffer, so
      // the base frame matches across tiers and only the glow differs.
      const dpr = renderer.getPixelRatio();
      const w = Math.max(1, Math.round(width * dpr));
      const h = Math.max(1, Math.round(height * dpr));
      composer.setSize(w, h);
      // Half-res bloom on medium: downscale ONLY the bloom mip pyramid, after
      // the composer has pushed the full-res value to every pass. `EffectComposer.render`
      // never re-calls `setSize` per frame, so this override sticks frame-to-frame
      // and is re-applied on each resize. On high, leave the full-res value.
      if (isMedium) {
        bloomPass.setSize(Math.max(1, Math.round(w * 0.5)), Math.max(1, Math.round(h * 0.5)));
      }
    },

    dispose() {
      // `composer.dispose` frees rt1/rt2 + the copy pass; the bloom pass owns its
      // bright + horizontal/vertical mip targets, materials and fsQuad and frees
      // them itself; `OutputPass` frees its fsQuad. `RenderPass` has no targets.
      composer.dispose();
      bloomPass.dispose();
      outputPass.dispose();
    },
  };
}
