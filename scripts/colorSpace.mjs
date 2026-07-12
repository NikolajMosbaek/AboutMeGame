// Pure colour-space helper for the model pipeline (scripts/process-models.mjs).
//
// This module is side-effect-free — no filesystem/network/GPU — so it can be
// pinned by a plain Vitest unit test (scripts/colorSpace.test.mjs) instead of
// only being exercised by actually running the (slow, network-fetching)
// pipeline.

/**
 * The sRGB electro-optical transfer function (IEC 61966-2-1), applied
 * per-channel: converts one sRGB-ENCODED channel value (0..1) to LINEAR light
 * (0..1).
 *
 * This is the exact piecewise curve `THREE.Color.convertSRGBToLinear` applies
 * component-wise. It matters here because `bakeVertexColorFromTexture` reads
 * raw bytes straight out of a decoded PNG (sRGB-encoded, by the atlas image
 * format's own convention) via `sharp(...).raw()`. Three.js's renderer
 * (`SRGBColorSpace` output, `docs/team/charter.md`) treats vertex-colour
 * (`COLOR_0`) attributes as ALREADY LINEAR — it never decodes them, unlike a
 * `sRGBColorSpace`-tagged texture. Writing `byte/255` straight into `COLOR_0`
 * therefore left every `colorMode: "texture"` model (13 Kenney object models)
 * reading over-bright/washed-out: the sRGB curve is concave (encodes dark
 * tones brighter than their linear value, e.g. 0.5 sRGB ~= 0.75 perceptual
 * lightness), so feeding it to a linear-space consumer unconverted lifts every
 * mid-tone toward white.
 *
 * @param {number} c - sRGB-encoded channel value in [0, 1]
 * @returns {number} linear-light channel value in [0, 1]
 */
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Map a normalized UV coordinate (0..1, either axis) to the clamped
 * texel-CENTER index of a `size`-texel-wide/tall raster — standard
 * nearest-neighbour sampling (`floor`, not `round`), matching how a GPU
 * sampler's nearest-filter addresses a texture: `u=0` hits texel 0's centre,
 * `u=1` (the far edge) clamps to the last texel rather than reading one texel
 * past the end. `round(u*(size-1))` (this bake's original formula) instead
 * biases every UV toward the NEAREST of the two texels flanking it, shifting
 * every sample's effective footprint by half a texel versus a real nearest
 * sampler.
 *
 * @param {number} u - normalized coordinate in [0, 1]
 * @param {number} size - texel count along that axis
 * @returns {number} integer texel index in [0, size - 1]
 */
export function texelIndex(u, size) {
  return Math.min(size - 1, Math.max(0, Math.floor(u * size)));
}
