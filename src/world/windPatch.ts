import type * as THREE from "three";
import { glslFloat } from "./glslFormat.ts";
import { WIND_BEND_EXPONENT, WIND_HASH_SCALE, WIND_HASH_X, WIND_HASH_Z, WIND_SPEED } from "./windSway.ts";

// The `onBeforeCompile` GLSL patch for foliage-bearing flora materials
// (visual-overhaul slice 6) — the SAME idiom as `waterPatch.ts`: it patches the
// caller's existing `MeshStandardMaterial` in place, so it costs zero extra
// draw calls / triangles, and the GLSL is a line-for-line transcription of
// `windSway.ts`'s pure reference math (never a second hand-typed copy of the
// wind formula).
//
// Deliberately the CHEAPEST version of "foliage moves": one `#include
// <begin_vertex>` vertex anchor, no fragment cost at all (unlike the water
// patch, this never touches lighting/colour). The sway direction is a fixed
// LOCAL-space axis (`transformed.x`), not a world-consistent wind heading — a
// documented simplification: rotating a world-space wind direction into each
// instance's local frame (undoing its random per-instance yaw via
// `transpose(mat3(instanceMatrix))`) would be the "physically" consistent
// version, but every consumer here (canopy/palm/understory/grass, all
// `InstancedMesh` with a RANDOM per-instance yaw from `props.ts`/`grass.ts`)
// already reads as natural, non-uniform swaying with the cheaper local-axis
// version — many stylized low-poly scenes make exactly this trade. Recorded
// here rather than silently simplified.
//
// Only compiled when `USE_INSTANCING` is defined (every caller is an
// `InstancedMesh`, but the `#ifdef` guard keeps the patch a defensive no-op —
// not a dangling `instanceMatrix` reference — if it were ever attached to a
// plain `Mesh`).

export interface WindPatchOptions {
  /** World-unit height (in the geometry's own LOCAL space) at which
   *  `windOffset`'s `height01` reaches 1 — the model's own known bounding-box
   *  height, baked as a shader constant (one per model variant, since each
   *  variant compiles its own program via `customProgramCacheKey`). */
  maxHeight: number;
  /** World-unit sway amplitude at the top of the model (`height01 = 1`). */
  strength: number;
  /** Uniform bag merged onto `shader.uniforms` — the caller-owned `uTime`
   *  `{value}` object the live `WindSystem` advances (mirrors
   *  `WaterPatchOptions.uniforms`). */
  uniforms: Record<string, { value: unknown }>;
}

export interface WindPatch {
  onBeforeCompile: (shader: THREE.WebGLProgramParametersWithUniforms) => void;
  customProgramCacheKey: () => string;
}

const VERTEX_ANCHOR = "#include <begin_vertex>";

/**
 * Build the `onBeforeCompile` / `customProgramCacheKey` pair that patches one
 * foliage material with the wind sway. Pure and synchronous — no WebGL context
 * needed, so it is unit-tested headless against the real `THREE.ShaderLib`
 * source (the `waterPatch.ts` discipline).
 */
export function makeWindPatch(options: WindPatchOptions): WindPatch {
  const { maxHeight, strength, uniforms } = options;

  // Every constant shared with `windSway.ts`'s pure reference math (hash
  // multipliers, the per-instance hash scale, the height-ramp bend exponent —
  // WIND_SPEED already was) is baked here from that module's exports, never
  // hand-typed a second time — a tuning edit to any of them propagates to
  // this shader for free (the `waterPatch.ts`/`waterSurface.ts` ripple-
  // constant discipline).
  const decl =
    "uniform float uTime;\n" +
    `const float WIND_SPEED = ${glslFloat(WIND_SPEED)};\n` +
    `const float WIND_MAX_HEIGHT = ${glslFloat(maxHeight)};\n` +
    `const float WIND_STRENGTH = ${glslFloat(strength)};\n` +
    `const float WIND_HASH_X = ${glslFloat(WIND_HASH_X)};\n` +
    `const float WIND_HASH_Z = ${glslFloat(WIND_HASH_Z)};\n` +
    `const float WIND_HASH_SCALE = ${glslFloat(WIND_HASH_SCALE)};\n` +
    `const float WIND_BEND_EXPONENT = ${glslFloat(WIND_BEND_EXPONENT)};\n`;

  const body =
    "#ifdef USE_INSTANCING\n" +
    "\t{\n" +
    "\t\tfloat windHeight01 = clamp( position.y / WIND_MAX_HEIGHT, 0.0, 1.0 );\n" +
    "\t\tfloat windHash = sin( instanceMatrix[3].x * WIND_HASH_X + instanceMatrix[3].z * WIND_HASH_Z ) * WIND_HASH_SCALE;\n" +
    "\t\tfloat windPhase = fract( windHash ) * 6.28318530718;\n" +
    "\t\tfloat windBend = sin( uTime * WIND_SPEED + windPhase ) * WIND_STRENGTH * pow( windHeight01, WIND_BEND_EXPONENT );\n" +
    "\t\ttransformed.x += windBend;\n" +
    "\t}\n" +
    "#endif\n";

  const onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = decl + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(VERTEX_ANCHOR, VERTEX_ANCHOR + "\n" + body);
  };

  // Distinct per (maxHeight, strength) pair — different model variants compile
  // different constants, so they must never share a cached program.
  const customProgramCacheKey = () => `wind-${maxHeight}-${strength}-v1`;

  return { onBeforeCompile, customProgramCacheKey };
}
