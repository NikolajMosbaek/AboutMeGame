import type * as THREE from "three";
import {
  FOAM_BREAKUP_STRENGTH,
  RIPPLE_HEADING_1_COS,
  RIPPLE_HEADING_1_SIN,
  RIPPLE_HEADING_2_COS,
  RIPPLE_HEADING_2_SIN,
  RIPPLE_SPEED_1,
  RIPPLE_SPEED_2,
  RIPPLE_TILE_1,
  RIPPLE_TILE_2,
  depthAbsorptionGlsl,
  glslFloat,
  rippleGlsl,
  waveGlsl,
} from "./waterSurface.ts";

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
//
// G1 ANIMATION (slice 3) — opt-in `displacement` adds a gentle two-sine swell in
// the VERTEX stage at TWO anchors, both reading the raw `position` attribute
// (model space == world XZ, since the plane baked `rotateX(-PI/2)`):
//   - Anchor A `#include <beginnormal_vertex>`: AFTER three declares
//     `objectNormal` from the un-perturbed +Y normal and BEFORE
//     `defaultnormal_vertex` consumes it into `transformedNormal`, OVERWRITE
//     `objectNormal = normalize(vec3(-dHdx, 1.0, -dHdz))` from the analytic
//     `waveGradient`. This is load-bearing and order-sensitive: it is the ONLY
//     path by which the swell reaches `vNormal`/the fragment `normal`, so the
//     DirectionalLight response AND the slice-1/2 fresnel ramp both ripple. An
//     overwrite at `begin_vertex` (downstream) would be dead code for shading.
//   - Anchor B `#include <begin_vertex>`: AFTER `transformed` is born,
//     `transformed.y += waveHeight(position.x, position.z, uTime)` for the
//     silhouette. Reads raw `position`, NOT `transformed`, so it stays
//     consistent with the normal (both close-form from the SAME constants).
// The closed-form `waveHeight`/`waveGradient` GLSL comes from the shared
// `waveGlsl()` emitter in `waterSurface.ts` (interpolated from the SAME exported
// A1/A2/K1/S1/K2/S2 constants) — never a second hand-copy of the magic numbers.
// The `uTime` uniform is merged by the caller's `uniforms` bag (one identity-
// stable `{value}` object the live `WaterSystem` advances), and the displacement
// axis is added to `customProgramCacheKey` so three never serves an undisplaced
// program to a displaced mesh.

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

/**
 * Detail-normal blend weight (visual-overhaul slice 4) — how strongly the two
 * ripple-normal-map samples' decoded slope (`waterSurface.ts`'s
 * `rippleWorldSlope`) perturbs the already-analytic wave normal before it
 * feeds the fresnel/lighting response. The second art tunable this patch owns
 * (parallel to {@link FRESNEL_POWER}): a shader blend-shape knob, NOT a
 * palette/foam/ripple-geometry constant (those live in `waterSurface.ts`).
 */
export const RIPPLE_NORMAL_STRENGTH = 0.4;

/** A GLSL uniform record entry as three's `onBeforeCompile` expects it. */
type UniformValue = { value: unknown };

export interface WaterPatchOptions {
  /** Whether to compile the foam band (true only when a ground-height texture
   *  was baked, i.e. `heightAt` was supplied to `buildBoundaries`). */
  hasFoam: boolean;
  /** Uniform bag merged onto `shader.uniforms`. The caller owns the values
   *  (the linear palette vec3s, the foam edges, the sampler, and — for the
   *  displacement variant — the live `uTime` `{value}` object) so this patch
   *  re-declares no palette hex or foam-edge literal. */
  uniforms: Record<string, UniformValue>;
  /** Whether to compile the G1 two-sine vertex swell (true only on medium/high
   *  tiers, i.e. `quality.waterDisplacement`). When false (the default, and on
   *  low) NEITHER vertex anchor is injected and the program text references no
   *  `uTime`/wave function — the water is the static slice-2 surface. */
  displacement?: boolean;
  /** Whether to compile the ripple normal-map detail + depth-based colour
   *  absorption + foam breakup + (`boundaries.ts`) roughness tuning
   *  (visual-overhaul slice 4, `quality.waterDetail === "full"`). Needs BOTH
   *  `hasFoam` (the baked ground-height depth) and `displacement` (the live
   *  `uTime` the ripple scroll reuses, so reduced-motion holds it for free —
   *  see `WaterSystem`) — this patch ANDs the three together defensively so an
   *  invalid combination can never compile a dangling reference; in practice
   *  `boundaries.ts` only ever requests it alongside both. Off by default: the
   *  low tier, and the terrain-style "render the base look now, upgrade once
   *  the async ripple texture attaches" first pass, both compile without it. */
  detail?: boolean;
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

// G1 displacement anchors. The shared `waveGlsl()` callable definitions are
// prepended once; each anchor calls them from the raw `position` attribute.
//
// Anchor A rides `#include <beginnormal_vertex>` — injected AFTER it so
// `objectNormal` is already declared, but it MUST land before
// `defaultnormal_vertex` consumes it. (`beginnormal_vertex` is the last vertex
// chunk before `defaultnormal_vertex` in three's standard program, so appending
// to it satisfies the ordering by construction.) It overwrites the un-perturbed
// +Y normal with the analytic surface normal of the wave field.
const DISP_NORMAL_ANCHOR = "#include <beginnormal_vertex>";
const DISP_NORMAL_BODY =
  "\t{\n" +
  "\t\tvec2 wGrad = waveGradient( position.x, position.z, uTime );\n" +
  "\t\tobjectNormal = normalize( vec3( -wGrad.x, 1.0, -wGrad.y ) );\n" +
  "\t}\n";

// Anchor B rides `#include <begin_vertex>` — injected AFTER it so `transformed`
// exists, then displaces its y by the wave height (read from raw `position`, so
// it is consistent with the normal above rather than the prior offset).
const DISP_HEIGHT_ANCHOR = "#include <begin_vertex>";
const DISP_HEIGHT_BODY =
  "\ttransformed.y += waveHeight( position.x, position.z, uTime );\n";

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
  const { hasFoam, uniforms, displacement = false } = options;
  // Detail needs BOTH the live `uTime` (from displacement) and the baked
  // ground-height depth (from hasFoam) — see this module's `detail` doc.
  const wantDetail = Boolean(options.detail) && hasFoam && displacement;

  // Fragment preamble: the palette uniforms, the fresnel exponent, and — only
  // for the foam variant — the foam uniforms, the sampler, and `#define HAS_FOAM`.
  // The no-foam variant emits NONE of the foam tokens, so its program text holds
  // no sampler/uniform reference at all (AC8). The detail variant (medium/high,
  // G1 slice 4) ALSO declares `uTime` (the fragment stage needs its own copy —
  // GLSL uniforms are per-stage, three binds the SAME `{value}` object to both
  // by name), the ripple normal sampler + detail palette, the ripple/foam-
  // breakup art constants baked as GLSL float literals from their single-source
  // `waterSurface.ts` exports (never hand-copied), and the shared
  // `rippleUV`/`rippleWorldSlope`/`depthAbsorption` GLSL emitters.
  const fragDecl =
    (hasFoam ? "#define HAS_FOAM\n" : "") +
    (wantDetail ? "#define HAS_DETAIL\n" : "") +
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
      : "") +
    (wantDetail
      ? "uniform float uTime;\n" +
        // `normalMatrix` is part of three's VERTEX-only prefix (never the
        // fragment one — confirmed against `WebGLProgram.js`'s separate
        // `prefixVertex`/`prefixFragment` builders), so the fragment stage
        // needs its own declaration; `WebGLUniforms` binds by NAME across the
        // whole linked program, so declaring it here is enough to receive the
        // renderer's per-object value with no further wiring.
        "uniform mat3 normalMatrix;\n" +
        "uniform sampler2D uWaterNormal;\n" +
        "uniform vec3 uWaterShallowDetail;\n" +
        "uniform vec3 uWaterDeepDetail;\n" +
        `const float RIPPLE_TILE_1 = ${glslFloat(RIPPLE_TILE_1)};\n` +
        `const float RIPPLE_TILE_2 = ${glslFloat(RIPPLE_TILE_2)};\n` +
        `const float RIPPLE_HEADING_1_COS = ${glslFloat(RIPPLE_HEADING_1_COS)};\n` +
        `const float RIPPLE_HEADING_1_SIN = ${glslFloat(RIPPLE_HEADING_1_SIN)};\n` +
        `const float RIPPLE_HEADING_2_COS = ${glslFloat(RIPPLE_HEADING_2_COS)};\n` +
        `const float RIPPLE_HEADING_2_SIN = ${glslFloat(RIPPLE_HEADING_2_SIN)};\n` +
        `const float RIPPLE_SPEED_1 = ${glslFloat(RIPPLE_SPEED_1)};\n` +
        `const float RIPPLE_SPEED_2 = ${glslFloat(RIPPLE_SPEED_2)};\n` +
        `const float RIPPLE_NORMAL_STRENGTH = ${glslFloat(RIPPLE_NORMAL_STRENGTH)};\n` +
        `const float FOAM_BREAKUP_STRENGTH = ${glslFloat(FOAM_BREAKUP_STRENGTH)};\n` +
        rippleGlsl() +
        depthAbsorptionGlsl()
      : "");

  // Detail-normal block: reassigns `normal` (view space) BEFORE fresnel reads
  // it, so both the colour ramp AND three's own specular BRDF (computed later
  // from this same `normal`) see the per-fragment ripple sparkle — this is
  // where "sharp sun glints" comes from, at zero extra draw calls. Combines
  // the two ripple samples' decoded slope (rotated back to world axes by
  // `rippleWorldSlope`) additively with the existing (already analytic-wave)
  // normal — a standard small-angle "detail normal add", valid because both
  // the macro wave tilt and the micro ripple slope are small perturbations
  // from +Y by construction (`waveHeight`'s amplitudes, and a normal map's
  // near-flat neutral texel).
  const detailNormalBody = wantDetail
    ? "#ifdef HAS_DETAIL\n" +
      "\t\tvec2 rUV1 = rippleUV( vWorldXZ, uTime, RIPPLE_TILE_1, RIPPLE_HEADING_1_COS, RIPPLE_HEADING_1_SIN, RIPPLE_SPEED_1 );\n" +
      "\t\tvec2 rUV2 = rippleUV( vWorldXZ, uTime, RIPPLE_TILE_2, RIPPLE_HEADING_2_COS, RIPPLE_HEADING_2_SIN, RIPPLE_SPEED_2 );\n" +
      "\t\tvec3 rTex1 = texture2D( uWaterNormal, rUV1 ).xyz * 2.0 - 1.0;\n" +
      "\t\tvec3 rTex2 = texture2D( uWaterNormal, rUV2 ).xyz * 2.0 - 1.0;\n" +
      "\t\tvec2 micro1 = rippleWorldSlope( rTex1.xy, RIPPLE_HEADING_1_COS, RIPPLE_HEADING_1_SIN );\n" +
      "\t\tvec2 micro2 = rippleWorldSlope( rTex2.xy, RIPPLE_HEADING_2_COS, RIPPLE_HEADING_2_SIN );\n" +
      "\t\tvec2 microGrad = ( micro1 + micro2 ) * RIPPLE_NORMAL_STRENGTH;\n" +
      "\t\tnormal = normalize( normal + normalMatrix * vec3( -microGrad.x, 0.0, -microGrad.y ) );\n" +
      "#endif\n"
    : "";

  // Depth (shore distance) is needed by BOTH the detail-tier ramp (absorption)
  // and the foam band below — computed ONCE here, ahead of both, whenever
  // `hasFoam` (unconditional on detail: today's non-detail foam variant reads
  // it too, unchanged from before this slice, just relocated earlier in the
  // block — a pure reordering with no behaviour change since it has no side
  // effects).
  const depthDeclBody = hasFoam
    ? "#ifdef HAS_FOAM\n" +
      "\t\tvec2 groundUV = vWorldXZ / ( 2.0 * uGroundExtent ) + 0.5;\n" +
      "\t\tfloat groundHeight = texture2D( uGroundHeight, groundUV ).r;\n" +
      "\t\tfloat depth = uSeaLevel - groundHeight;\n" +
      "#endif\n"
    : "";

  // The colour ramp: the detail tier transcribes `detailWaterRamp` (fresnel
  // combined with depth-based absorption via `max`); every other variant keeps
  // the EXACT slice-2 fresnel-only ramp (transcribing `waterColor`), unchanged.
  const rampBody = wantDetail
    ? "#ifdef HAS_DETAIL\n" +
      "\t\tfloat depthAbs = depthAbsorption( depth );\n" +
      "\t\tfloat waterRamp = clamp( max( fresnel, depthAbs ), 0.0, 1.0 );\n" +
      "\t\tvec3 waterCol = mix( uWaterShallowDetail, uWaterDeepDetail, waterRamp );\n" +
      "#endif\n"
    : "\t\tvec3 waterCol = mix( uWaterShallow, uWaterDeep, clamp( fresnel, 0.0, 1.0 ) );\n";

  // Foam band: transcribes `shorelineFoam` — 1 - smoothstep(start, end, depth)
  // — over a tone-mapped off-white. The detail tier additionally raggedizes
  // the band edge with a scalar derived from the SAME two ripple samples
  // already read above (no extra texture fetch): the edge jitters instead of
  // reading as a clean smoothstep line (the design's "foam upgrade").
  //
  // The foam block is emitted at BUILD TIME only when `hasFoam`. It is ALSO
  // kept inside `#ifdef HAS_FOAM`: the build-time omission guarantees the
  // no-foam program references no foam token at all (AC8), while the `#ifdef`
  // keeps the emitted block self-documenting and consistent with the
  // `#define` preamble.
  const foamBlock = hasFoam
    ? "#ifdef HAS_FOAM\n" +
      (wantDetail
        ? "#ifdef HAS_DETAIL\n" +
          "\t\tfloat foamBreakup = ( rTex1.x + rTex2.x ) * 0.5 * FOAM_BREAKUP_STRENGTH;\n" +
          "\t\tfloat foam = 1.0 - smoothstep( uFoamStart + foamBreakup, uFoamEnd + foamBreakup, depth );\n" +
          "#endif\n"
        : "\t\tfloat foam = 1.0 - smoothstep( uFoamStart, uFoamEnd, depth );\n") +
      "\t\twaterCol = mix( waterCol, uFoamColor, clamp( foam, 0.0, 1.0 ) );\n" +
      "#endif\n"
    : "";
  const fragBody =
    "\t{\n" +
    detailNormalBody +
    "\t\tvec3 V = normalize( vViewPosition );\n" +
    "\t\tfloat fresnel = pow( 1.0 - max( dot( normal, V ), 0.0 ), WATER_FRESNEL_POWER );\n" +
    depthDeclBody +
    rampBody +
    foamBlock +
    "\t\tdiffuseColor.rgb = waterCol;\n" +
    "\t}\n";

  const onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    // Merge the caller's uniforms (palette/foam/sampler) — never re-declare them.
    Object.assign(shader.uniforms, uniforms);

    // Vertex: prepend the varying decl, write it at the world-position anchor.
    // For the displacement variant also prepend the `uTime` uniform decl and the
    // shared `waveHeight`/`waveGradient` GLSL definitions, then inject the two
    // swell anchors (normal recompute upstream of `defaultnormal_vertex`,
    // y-displacement after `transformed` is born).
    const vertexPreamble = displacement
      ? VERTEX_DECL + "uniform float uTime;\n" + waveGlsl()
      : VERTEX_DECL;
    shader.vertexShader = vertexPreamble + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      "#include <worldpos_vertex>\n" + VERTEX_BODY,
    );
    if (displacement) {
      shader.vertexShader = shader.vertexShader.replace(
        DISP_NORMAL_ANCHOR,
        DISP_NORMAL_ANCHOR + "\n" + DISP_NORMAL_BODY,
      );
      shader.vertexShader = shader.vertexShader.replace(
        DISP_HEIGHT_ANCHOR,
        DISP_HEIGHT_ANCHOR + "\n" + DISP_HEIGHT_BODY,
      );
    }

    // Fragment: prepend declarations, inject the ramp/foam body after the normal
    // chunk so `normal` and `vViewPosition` are in scope.
    shader.fragmentShader = fragDecl + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      FRAG_ANCHOR,
      FRAG_ANCHOR + "\n" + fragBody,
    );
  };

  // Distinct constant per variant; the `water-` prefix disambiguates all
  // {foam, no-foam} x {displace, no-displace} x {detail, no-detail} programs
  // from each other and from the terrain/props MeshStandard programs in
  // three's program cache, so three never serves a mismatched program to a
  // differently-configured mesh. The `-detail` axis is appended last so the
  // four slice-2/3 keys this was already pinned to (regression-locked in
  // `waterPatch.test.ts`) are BYTE-IDENTICAL when `detail` is omitted/false.
  const customProgramCacheKey = () =>
    `water-${hasFoam ? "foam" : "nofoam"}${displacement ? "-disp" : ""}${wantDetail ? "-detail" : ""}-v1`;

  return { onBeforeCompile, customProgramCacheKey };
}
