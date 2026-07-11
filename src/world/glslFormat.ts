// Tiny GLSL-literal formatting helper for non-water `onBeforeCompile` patches
// (visual-overhaul slice 6's `windPatch.ts`). `waterSurface.ts` has an
// IDENTICAL `glslFloat` — deliberately duplicated, not imported from there:
// `waterSurface.test.ts` asserts that module is both fully self-contained
// (zero imports) and narrowly imported (only the water-material wiring files
// may pull it in), so a shared import either way would break one of those two
// guards. See `waterSurface.ts`'s own `glslFloat` doc for the full reasoning.

/**
 * Format a JS number as a GLSL float literal — always with a decimal point,
 * so an integer-valued constant like `1` becomes `1.0` (GLSL `1` is an `int`
 * and would not type-check where a `float` is wanted). Round-trips exactly:
 * `Number(glslFloat(v)) === v`, so interpolating an exported constant into
 * shader text loses no precision and stays the single source of truth.
 */
export function glslFloat(v: number): string {
  const s = String(v);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}
