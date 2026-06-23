import type * as THREE from "three";

// The `onBeforeCompile` GLSL patch for the water `MeshStandardMaterial` (G1
// slice 2). It patches the ONE existing water plane in place — no new geometry,
// no second mesh, no `ShaderMaterial` — keeping the water at one draw call and
// triangles ±0.
//
// The GLSL here is a line-for-line transcription of `waterSurface.ts`, which
// stays the single source of truth: the palette and foam edges arrive ONLY as
// uniforms (`uWaterShallow`/`uWaterDeep`/`uFoamStart`/`uFoamEnd`/`uFoamColor`),
// never as inline hex or numeric literals (AC1). The one art tunable this patch
// owns is the fresnel exponent `p` ({@link FRESNEL_POWER}) — a ramp shape knob,
// not a palette/foam constant — so AC1 holds.
//
// Two variants share this builder:
//   - foam (`hasFoam: true`): the vertex stage passes a `vWorldXZ` world-space
//     varying; the fragment samples the baked ground-height `DataTexture` to
//     recover `groundHeight`, computes `depth = uSeaLevel - groundHeight`, and
//     mixes a tone-mapped off-white foam over the water by
//     `1 - smoothstep(uFoamStart, uFoamEnd, depth)` (transcribing `shorelineFoam`).
//   - no-foam (`hasFoam: false`, `heightAt` absent): the foam block is omitted
//     ENTIRELY at build time, so the program text references no sampler/uniform
//     (no dangling uniform, no null sampler, no three warning — AC8). The water
//     still renders the fresnel colour ramp.
//
// `customProgramCacheKey` returns a distinct constant per variant so the patched
// water program never collides with the terrain/props MeshStandard programs in
// three's shader cache.

/**
 * Fresnel ramp exponent `p` in `fresnel = pow(1 - max(dot(N, V), 0), p)`.
 *
 * The single art tunable this patch owns: it shapes how sharply the view-angle
 * blend pushes toward the grazing-horizon `uWaterDeep` tone. It is NOT a palette
 * or foam constant (those live in `waterSurface.ts`), so re-declaring it here
 * does not breach the single-source rule (AC1). On the flat horizontal plane the
 * normal is uniformly +Y, so the in-build camera height yields a strong radial
 * gradient (≈0 near-overhead → high toward the horizon) — the visible depth
 * blend AC2 requires, WITHOUT normalising raw depth.
 */
export const FRESNEL_POWER = 3.5;

/** A GLSL uniform record entry as three's `onBeforeCompile` expects it. */
type UniformValue = { value: unknown };

export interface WaterPatchOptions {
  /** Whether to compile the foam band (true only when a ground-height texture
   *  was baked, i.e. `heightAt` was supplied to `buildBoundaries`). */
  hasFoam: boolean;
  /** Uniform bag merged onto `shader.uniforms`. The caller owns the values
   *  (the linear palette vec3s, the foam edges, the sampler) so this patch
   *  re-declares no palette hex or foam-edge literal. */
  uniforms: Record<string, UniformValue>;
}

export interface WaterPatch {
  onBeforeCompile: (shader: THREE.WebGLProgramParametersWithUniforms) => void;
  customProgramCacheKey: () => string;
}

// Vertex injection: declare the world-space XZ varying and write it from the
// model-space `transformed` position (produced by `begin_vertex`, in scope at
// the `worldpos_vertex` anchor). Independent of the conditional `worldPosition`
// the standard chunk only declares under envmap/shadow defines.
const VERTEX_DECL = "varying vec2 vWorldXZ;\n";
const VERTEX_BODY = "\tvWorldXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;\n";

// The colour-ramp + (optional) foam injection runs after `normal_fragment_maps`,
// where the view-space `normal` and `vViewPosition` (fragment→camera) are both
// in scope, and rewrites `diffuseColor.rgb`.
const FRAG_ANCHOR = "#include <normal_fragment_maps>";

/**
 * Build the `onBeforeCompile` / `customProgramCacheKey` pair that patches the
 * water `MeshStandardMaterial`.
 *
 * Pure and synchronous: `onBeforeCompile` only mutates the `shader.vertexShader`
 * / `shader.fragmentShader` strings and merges `uniforms` onto `shader.uniforms`
 * — no allocation on any per-frame path, no WebGL context needed (so it is unit
 * tested headless against the real `THREE.ShaderLib` source).
 */
export function makeWaterPatch(options: WaterPatchOptions): WaterPatch {
  const { hasFoam, uniforms } = options;

  // Fragment preamble: the palette uniforms, the fresnel exponent, and — only
  // for the foam variant — the foam uniforms, the sampler, and `#define HAS_FOAM`.
  // The no-foam variant emits NONE of the foam tokens, so its program text holds
  // no sampler/uniform reference at all (AC8).
  const fragDecl =
    (hasFoam ? "#define HAS_FOAM\n" : "") +
    "uniform vec3 uWaterShallow;\n" +
    "uniform vec3 uWaterDeep;\n" +
    `const float WATER_FRESNEL_POWER = ${FRESNEL_POWER.toFixed(1)};\n` +
    "varying vec2 vWorldXZ;\n" +
    (hasFoam
      ? "uniform vec3 uFoamColor;\n" +
        "uniform float uFoamStart;\n" +
        "uniform float uFoamEnd;\n" +
        "uniform float uSeaLevel;\n" +
        "uniform sampler2D uGroundHeight;\n" +
        "uniform float uGroundExtent;\n"
      : "");

  // Fragment body, injected after the normal/view vars exist. The fresnel ramp
  // transcribes `waterColor`: mix(shallow, deep, clamp(fresnel,0,1)); the foam
  // band transcribes `shorelineFoam`: 1 - smoothstep(start, end, depth), over a
  // tone-mapped off-white. `depth = uSeaLevel - groundHeight`, with groundHeight
  // sampled from the baked R-channel texture in normalized [0,1] UV.
  //
  // The foam block is emitted at BUILD TIME only when `hasFoam`. It is ALSO kept
  // inside `#ifdef HAS_FOAM`: the build-time omission guarantees the no-foam
  // program references no foam token at all (AC8), while the `#ifdef` keeps the
  // emitted block self-documenting and consistent with the `#define` preamble.
  const foamBlock = hasFoam
    ? "#ifdef HAS_FOAM\n" +
      "\t\tvec2 groundUV = vWorldXZ / ( 2.0 * uGroundExtent ) + 0.5;\n" +
      "\t\tfloat groundHeight = texture2D( uGroundHeight, groundUV ).r;\n" +
      "\t\tfloat depth = uSeaLevel - groundHeight;\n" +
      "\t\tfloat foam = 1.0 - smoothstep( uFoamStart, uFoamEnd, depth );\n" +
      "\t\twaterCol = mix( waterCol, uFoamColor, clamp( foam, 0.0, 1.0 ) );\n" +
      "#endif\n"
    : "";
  const fragBody =
    "\t{\n" +
    "\t\tvec3 V = normalize( vViewPosition );\n" +
    "\t\tfloat fresnel = pow( 1.0 - max( dot( normal, V ), 0.0 ), WATER_FRESNEL_POWER );\n" +
    "\t\tvec3 waterCol = mix( uWaterShallow, uWaterDeep, clamp( fresnel, 0.0, 1.0 ) );\n" +
    foamBlock +
    "\t\tdiffuseColor.rgb = waterCol;\n" +
    "\t}\n";

  const onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    // Merge the caller's uniforms (palette/foam/sampler) — never re-declare them.
    Object.assign(shader.uniforms, uniforms);

    // Vertex: prepend the varying decl, write it at the world-position anchor.
    shader.vertexShader = VERTEX_DECL + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      "#include <worldpos_vertex>\n" + VERTEX_BODY,
    );

    // Fragment: prepend declarations, inject the ramp/foam body after the normal
    // chunk so `normal` and `vViewPosition` are in scope.
    shader.fragmentShader = fragDecl + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      FRAG_ANCHOR,
      FRAG_ANCHOR + "\n" + fragBody,
    );
  };

  // Distinct constant per variant; the `water-` prefix disambiguates both from
  // the terrain/props MeshStandard programs in three's program cache.
  const customProgramCacheKey = () =>
    hasFoam ? "water-foam-v1" : "water-nofoam-v1";

  return { onBeforeCompile, customProgramCacheKey };
}
