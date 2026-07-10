import * as THREE from "three";

/** The minimal slice of a renderer whose colour ownership these functions move.
 *  A real `THREE.WebGLRenderer` satisfies it; a test passes a plain object so the
 *  decision can be asserted WebGL-free. `outputColorSpace` is typed as `string`
 *  (not `THREE.ColorSpace`) because `WebGLRenderer.outputColorSpace` itself is
 *  — three widened it so a custom-registered colour space can be assigned too;
 *  the literal `THREE.SRGBColorSpace` we assign is still a valid `string`. */
export interface ColorOwnedRenderer {
  toneMapping: THREE.ToneMapping;
  outputColorSpace: string;
}

/**
 * Configure colour ownership for the BARE renderer path — the low tier, where
 * no post-processing compositor is built (`quality.bloom` is false, so
 * `GameCanvas` never calls `createBloomCompositor`). Here the renderer itself
 * is the ONLY stage in the pipeline, so it owns the single tone-map + sRGB
 * encode outright: `AgXToneMapping` + `SRGBColorSpace`.
 *
 * Kept beside {@link configureCompositorColor} so the two paths are visibly a
 * pair: AgX is the tone-map BOTH grade with (the visual-overhaul contract),
 * they just apply it in different places — the renderer here, a
 * `ToneMappingEffect` at the end of the `EffectPass` chain there.
 */
export function configureBareRendererColor(renderer: ColorOwnedRenderer): void {
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

/**
 * Configure the renderer's final colour ownership for the *compositor*
 * (pmndrs `postprocessing`) path.
 *
 * This SWITCHES the renderer to `NoToneMapping` — the opposite of the bare
 * path above — while leaving `outputColorSpace` at `SRGBColorSpace`. That is
 * the library's own documented setup (see `postprocessing`'s README, "Color
 * Management" and "Tone Mapping" sections):
 *
 *  - `outputColorSpace = SRGBColorSpace` is the ONE thing the renderer needs to
 *    declare; postprocessing "follows suit" and encodes sRGB itself at the end
 *    of the merged `EffectPass`, once the whole chain has run.
 *  - `toneMapping` must be `NoToneMapping` so the renderer does NOT tone-map
 *    when it draws into the compositor's linear `HalfFloatType` input buffer —
 *    the `EffectComposer`'s intermediate targets need real scene-linear HDR
 *    light (so bloom sums correctly) rather than an already-clamped [0,1]
 *    frame. Tone-mapping is instead applied exactly ONCE, by a
 *    `ToneMappingEffect` (AgX — matching the bare path) at the very end of the
 *    `EffectPass` chain.
 *
 * Leaving the renderer at its own tone-map (e.g. AgX, like the bare path) here
 * would tone-map the scene TWICE — once on the way into the composited chain,
 * once again in the `ToneMappingEffect` — which is exactly the double-gamma /
 * washed-out pitfall this function exists to avoid.
 */
export function configureCompositorColor(renderer: ColorOwnedRenderer): void {
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}
