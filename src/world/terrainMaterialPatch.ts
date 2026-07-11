import type * as THREE from "three";

// The `onBeforeCompile` GLSL patch for the terrain `MeshStandardMaterial`
// (visual-overhaul slice 3, PBR terrain splatting). Same idiom as
// `waterPatch.ts`: patches the ONE existing terrain mesh in place — no extra
// geometry, no second material, still one draw call — with per-vertex splat
// WEIGHTS computed on the CPU by the pure `terrainSplat.ts` module (a
// line-for-line source for the blend math below) and packed into a vec4
// vertex attribute (`splatWeight`, `SPLAT_CHANNELS` order: r=jungleFloor,
// g=leafLitter, b=rock, a=sand).
//
// This patch is medium/high only (`quality.terrainDetail === "full"`): the low
// tier gets NO terrain textures at all (`terrainDetail === "none"`,
// `terrain.ts`'s `attachTerrainTextures` never even calls this module — see
// its own doc for why: the render gate's software-GL/SwiftShader runner, the
// low tier's real ≤2-core-device stand-in, timed out on a lighter albedo-only
// variant this module used to also build; the design's floor is "low tier
// must not get slower than today", so it keeps today's plain vertex-colour
// terrain instead). One variant now, always both passes:
//   - ALBEDO: 4 texture samples at a world-XZ planar UV, blended by the
//     interpolated `vSplatWeight`, written into `diffuseColor.rgb` right after
//     `#include <map_fragment>` — BEFORE `#include <color_fragment>` runs, so
//     three's own vertex-colour multiply (`diffuseColor.rgb *= vColor`,
//     already wired by `vertexColors: true`) applies to the blended albedo for
//     free. That IS the "macro tint": no extra code needed here, just correct
//     anchor ordering.
//   - NORMAL: 4 tangent-space normal samples, blended the same way, rotated
//     into the fragment's local frame and written into `normal` right after
//     `#include <normal_fragment_maps>` (same anchor `waterPatch.ts` uses for
//     view/normal-dependent code) so lighting sees the perturbed surface.
//     Since the terrain has no baked UV-space vertex tangents, the frame is
//     built on the fly from screen-space derivatives — the classic
//     "Normal Mapping Without Precomputed Tangents" trick (Mikkelsen; the
//     same technique three's own `getTangentFrame` helper in
//     `normalmap_pars_fragment.glsl.js` implements, but that helper is only
//     EMITTED there under `USE_NORMALMAP_TANGENTSPACE`/`USE_CLEARCOAT_NORMALMAP`
//     /`USE_ANISOTROPY`, none of which this patch sets — so a small transcript
//     is declared locally rather than depending on an internal that won't be
//     compiled into this program).

/** World units per texture repeat for the planar XZ UV — the one art tunable
 *  this patch owns (parallel to `waterPatch.ts`'s `FRESNEL_POWER`): judged
 *  visually against the island's texel density, in the middle of the design's
 *  "one repeat per ~5-8 units" band. Baked as a GLSL const (never a uniform):
 *  it's a fixed authoring choice, not something any system changes at runtime. */
export const TERRAIN_TILE_SIZE = 6;

type UniformValue = { value: unknown };

export interface TerrainMaterialPatchOptions {
  /** Uniform bag merged onto `shader.uniforms` — the 4 albedo samplers and the
   *  4 normal samplers. The caller owns the `THREE.Texture` values (loaded
   *  async via the cached `loadTexture` seam), so this patch never constructs
   *  or names a loader itself. */
  uniforms: Record<string, UniformValue>;
}

export interface TerrainMaterialPatch {
  onBeforeCompile: (shader: THREE.WebGLProgramParametersWithUniforms) => void;
  customProgramCacheKey: () => string;
}

const VERTEX_DECL = "attribute vec4 splatWeight;\nvarying vec4 vSplatWeight;\nvarying vec2 vWorldXZ;\n";
const VERTEX_COLOR_ANCHOR = "#include <color_vertex>";
const VERTEX_COLOR_BODY = "\tvSplatWeight = splatWeight;\n";
const VERTEX_WORLDPOS_ANCHOR = "#include <worldpos_vertex>";
const VERTEX_WORLDPOS_BODY =
  "\tvWorldXZ = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;\n";

const FRAG_MAP_ANCHOR = "#include <map_fragment>";
const FRAG_NORMAL_ANCHOR = "#include <normal_fragment_maps>";

// Screen-space-derivative TBN — a local transcript of the well-known "Normal
// Mapping Without Precomputed Tangents" technique (see this module's doc
// comment) so the patch depends on no internal three helper that may not even
// be emitted into this program.
const TANGENT_FRAME_FN =
  "mat3 terrainTangentFrame( vec3 eyePos, vec3 surfNormal, vec2 uv ) {\n" +
  "\tvec3 q0 = dFdx( eyePos );\n" +
  "\tvec3 q1 = dFdy( eyePos );\n" +
  "\tvec2 st0 = dFdx( uv );\n" +
  "\tvec2 st1 = dFdy( uv );\n" +
  "\tvec3 N = surfNormal;\n" +
  "\tvec3 q1perp = cross( q1, N );\n" +
  "\tvec3 q0perp = cross( N, q0 );\n" +
  "\tvec3 T = q1perp * st0.x + q0perp * st1.x;\n" +
  "\tvec3 B = q1perp * st0.y + q0perp * st1.y;\n" +
  "\tfloat det = max( dot( T, T ), dot( B, B ) );\n" +
  "\tfloat scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );\n" +
  "\treturn mat3( T * scale, B * scale, N );\n" +
  "}\n";

const FRAG_DECL =
  "varying vec4 vSplatWeight;\n" +
  "varying vec2 vWorldXZ;\n" +
  `const float TERRAIN_TILE_SIZE = ${TERRAIN_TILE_SIZE.toFixed(1)};\n` +
  "uniform sampler2D uAlbedoJungleFloor;\n" +
  "uniform sampler2D uAlbedoLeafLitter;\n" +
  "uniform sampler2D uAlbedoRock;\n" +
  "uniform sampler2D uAlbedoSand;\n" +
  "uniform sampler2D uNormalJungleFloor;\n" +
  "uniform sampler2D uNormalLeafLitter;\n" +
  "uniform sampler2D uNormalRock;\n" +
  "uniform sampler2D uNormalSand;\n" +
  TANGENT_FRAME_FN;

const ALBEDO_BODY =
  "\t{\n" +
  "\t\tvec2 uvSplat = vWorldXZ / TERRAIN_TILE_SIZE;\n" +
  "\t\tvec3 splatAlbedo =\n" +
  "\t\t\ttexture2D( uAlbedoJungleFloor, uvSplat ).rgb * vSplatWeight.x +\n" +
  "\t\t\ttexture2D( uAlbedoLeafLitter, uvSplat ).rgb * vSplatWeight.y +\n" +
  "\t\t\ttexture2D( uAlbedoRock, uvSplat ).rgb * vSplatWeight.z +\n" +
  "\t\t\ttexture2D( uAlbedoSand, uvSplat ).rgb * vSplatWeight.w;\n" +
  "\t\tdiffuseColor.rgb = splatAlbedo;\n" +
  "\t}\n";

const NORMAL_BODY =
  "\t{\n" +
  "\t\tvec2 uvSplat = vWorldXZ / TERRAIN_TILE_SIZE;\n" +
  "\t\tvec3 n0 = texture2D( uNormalJungleFloor, uvSplat ).xyz * 2.0 - 1.0;\n" +
  "\t\tvec3 n1 = texture2D( uNormalLeafLitter, uvSplat ).xyz * 2.0 - 1.0;\n" +
  "\t\tvec3 n2 = texture2D( uNormalRock, uvSplat ).xyz * 2.0 - 1.0;\n" +
  "\t\tvec3 n3 = texture2D( uNormalSand, uvSplat ).xyz * 2.0 - 1.0;\n" +
  "\t\tvec3 blendedN = normalize(\n" +
  "\t\t\tn0 * vSplatWeight.x + n1 * vSplatWeight.y + n2 * vSplatWeight.z + n3 * vSplatWeight.w\n" +
  "\t\t);\n" +
  "\t\tmat3 terrainTBN = terrainTangentFrame( -vViewPosition, normal, uvSplat );\n" +
  "\t\tnormal = normalize( terrainTBN * blendedN );\n" +
  "\t}\n";

/**
 * Build the `onBeforeCompile` / `customProgramCacheKey` pair that patches the
 * terrain `MeshStandardMaterial`. Pure and synchronous: only mutates the
 * `shader.vertexShader` / `shader.fragmentShader` strings and merges
 * `uniforms` — no WebGL context needed, so it is unit-tested headless against
 * the real `THREE.ShaderLib` source (same discipline as `waterPatch.ts`).
 *
 * Medium/high only — the low tier never calls this (see this module's doc
 * comment); there is no cheaper variant to select between.
 */
export function makeTerrainMaterialPatch(options: TerrainMaterialPatchOptions): TerrainMaterialPatch {
  const { uniforms } = options;

  const onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = VERTEX_DECL + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      VERTEX_COLOR_ANCHOR,
      VERTEX_COLOR_ANCHOR + "\n" + VERTEX_COLOR_BODY,
    );
    shader.vertexShader = shader.vertexShader.replace(
      VERTEX_WORLDPOS_ANCHOR,
      VERTEX_WORLDPOS_ANCHOR + "\n" + VERTEX_WORLDPOS_BODY,
    );

    shader.fragmentShader = FRAG_DECL + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      FRAG_MAP_ANCHOR,
      FRAG_MAP_ANCHOR + "\n" + ALBEDO_BODY,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      FRAG_NORMAL_ANCHOR,
      FRAG_NORMAL_ANCHOR + "\n" + NORMAL_BODY,
    );
  };

  const customProgramCacheKey = () => "terrain-full-v1";

  return { onBeforeCompile, customProgramCacheKey };
}
