import * as THREE from "three";

/** The minimal slice of a renderer whose colour ownership the compositor moves.
 *  A real `THREE.WebGLRenderer` satisfies it; a test passes a plain object so the
 *  decision can be asserted WebGL-free. */
export interface ColorOwnedRenderer {
  toneMapping: THREE.ToneMapping;
  outputColorSpace: THREE.ColorSpace;
}

/**
 * Configure the renderer's final colour ownership for the *compositor* path.
 *
 * Counter-intuitively this LEAVES the renderer at `ACESFilmicToneMapping` /
 * `SRGBColorSpace` — the same values `createRenderer` already sets — rather than
 * neutralising them to `NoToneMapping` / `LinearSRGBColorSpace`.
 *
 * The reason is how `OutputPass` works in three r169: at its render step it reads
 * `renderer.toneMapping` and `renderer.outputColorSpace` to decide which shader
 * defines to compile. `SRGB_TRANSFER` is set only when
 * `ColorManagement.getTransfer(outputColorSpace) === SRGBTransfer` (true for
 * `SRGBColorSpace`, **false** for `LinearSRGBColorSpace`), and a tone-mapping
 * define is set only when `toneMapping` matches a *named* mode (`NoToneMapping`
 * matches none). So if we neutralised the renderer, `OutputPass` would set
 * NEITHER define and become a pass-through, presenting the raw linear,
 * un-sRGB-encoded buffer — the whole scene comes out dark/under-exposed.
 *
 * Leaving the renderer at ACES + sRGB lets `OutputPass` pick them up and apply
 * tone-map + sRGB encode exactly once at the end of the chain. The intermediate
 * `EffectComposer` targets are linear `HalfFloatType`, so `RenderPass` still
 * writes scene-linear HDR (the renderer applies no tone-map/encode when drawing
 * into a linear render target) and bloom still sums in linear HDR; only the final
 * present is tone-mapped + encoded, so the base (non-glowing) pixels stay
 * identical to the plain low path and only the added glow differs.
 */
export function configureCompositorColor(renderer: ColorOwnedRenderer): void {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}
