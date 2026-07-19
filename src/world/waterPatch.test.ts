import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  DEPTH_ABSORPTION_RATE,
  FOAM_BREAKUP_STRENGTH,
  FOAM_DEPTH_END,
  FOAM_DEPTH_START,
  RIPPLE_HEADING_2_COS,
  RIPPLE_TILE_1,
  STREAM_STREAK_SCROLL,
  STREAM_STREAK_TILE_ALONG,
  WRAP_PERIOD,
  glslFloat,
  waveGlsl,
} from "./waterSurface.ts";
import {
  FOAM_COLOR_LINEAR,
  WATER_DEEP_DETAIL_LINEAR,
  WATER_DEEP_LINEAR,
  WATER_SHALLOW_DETAIL_LINEAR,
  WATER_SHALLOW_LINEAR,
} from "./waterUniforms.ts";
import { FRESNEL_POWER, RIPPLE_NORMAL_STRENGTH, makeWaterPatch } from "./waterPatch.ts";

// T4 — the onBeforeCompile GLSL patch builder for the water `MeshStandard`
// material (G1 slice 2). It must transliterate `waterSurface.ts` line-for-line:
// the fresnel ramp `pow(1 - max(dot(N,V),0), p)` mixing uWaterShallow ->
// uWaterDeep, and (only under the compile-time `#define HAS_FOAM`) the foam band
// `1 - smoothstep(uFoamStart, uFoamEnd, depth)` over a tone-mapped off-white.
//
// Verified against the REAL three MeshStandard shader source (THREE.ShaderLib /
// ShaderChunk), not a fabricated stub, so the injected anchors are guarded
// against a three-version chunk rename. Both the foam and no-foam variants are
// exercised. No WebGL context is needed — onBeforeCompile mutates plain strings.

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** A fresh `shader`-like object mirroring what three hands `onBeforeCompile`:
 *  the real MeshStandard source plus an empty `uniforms` bag. */
function freshShader() {
  return {
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: {} as Record<string, { value: unknown }>,
  };
}

/** Strip `//` and block comments so anchor scans don't trip over commentary. */
function stripGlslComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

describe("makeWaterPatch — shared (foam + no-foam)", () => {
  it("returns an onBeforeCompile fn and a string customProgramCacheKey", () => {
    const patch = makeWaterPatch({ hasFoam: false, uniforms: {} });
    expect(typeof patch.onBeforeCompile).toBe("function");
    expect(typeof patch.customProgramCacheKey).toBe("function");
    expect(typeof patch.customProgramCacheKey()).toBe("string");
  });

  it("injects the vWorldXZ varying into both vertex and fragment stages", () => {
    const shader = freshShader();
    makeWaterPatch({ hasFoam: false, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const vs = stripGlslComments(shader.vertexShader);
    const fs = stripGlslComments(shader.fragmentShader);
    expect(vs).toMatch(/varying\s+vec2\s+vWorldXZ/);
    expect(fs).toMatch(/varying\s+vec2\s+vWorldXZ/);
    // The varying is written from a world-space position in the vertex stage.
    expect(vs).toMatch(/vWorldXZ\s*=/);
  });

  it("transliterates the fresnel ramp pow(1 - max(dot(N,V),0), p) and mixes shallow -> deep", () => {
    const shader = freshShader();
    makeWaterPatch({ hasFoam: false, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const fs = stripGlslComments(shader.fragmentShader);
    // The fresnel term: pow(1.0 - max(dot(N, V), 0.0), p)
    expect(fs).toMatch(/pow\s*\(\s*1\.0\s*-\s*max\s*\(\s*dot\s*\(/);
    // Mixes the two palette uniforms by the fresnel term.
    expect(fs).toMatch(/mix\s*\(\s*uWaterShallow\s*,\s*uWaterDeep/);
    expect(fs).toContain("uWaterShallow");
    expect(fs).toContain("uWaterDeep");
  });

  it("uses the FRESNEL_POWER exponent constant in the ramp (p = 3.5)", () => {
    expect(FRESNEL_POWER).toBeCloseTo(3.5, 6);
    const shader = freshShader();
    makeWaterPatch({ hasFoam: false, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const fs = stripGlslComments(shader.fragmentShader);
    // The single art tunable the patch owns, emitted as a GLSL float literal.
    expect(fs).toMatch(/3\.5/);
  });

  it("anchors onto real three chunks (no fabricated stub) and keeps them present", () => {
    const shader = freshShader();
    makeWaterPatch({ hasFoam: false, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    // The vertex injection rides the world-position chunk; the fragment one
    // rides the diffuseColor declaration — both must still be present after the
    // patch (we add to, not destroy, the standard program).
    expect(shader.vertexShader).toContain("#include <worldpos_vertex>");
    expect(shader.fragmentShader).toContain("vec4 diffuseColor = vec4( diffuse, opacity )");
  });

  it("inlines NO centralised palette hex or foam-edge numeric literal in the GLSL", () => {
    const shader = freshShader();
    makeWaterPatch({ hasFoam: true, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const glsl = stripGlslComments(shader.vertexShader + "\n" + shader.fragmentShader);
    // No re-declared palette hex.
    expect(glsl).not.toMatch(/0x2e6f9e/i);
    expect(glsl).not.toMatch(/0x193d57/i);
    // No inlined foam-edge literals — they arrive as uniforms.
    expect(glsl).not.toContain(String(FOAM_DEPTH_END));
    // The foam edges are referenced by uniform name, not value.
    expect(glsl).toContain("uFoamStart");
    expect(glsl).toContain("uFoamEnd");
  });

  it("the builder's own source inlines no palette hex / foam-edge literal (AC1)", () => {
    const code = stripGlslComments(
      readFileSync(join(MODULE_DIR, "waterPatch.ts"), "utf8"),
    );
    expect(code).not.toMatch(/0x2e6f9e/i);
    expect(code).not.toMatch(/0x193d57/i);
    // Foam edges live only in waterSurface.ts; the patch references them as
    // uniforms, never as inline numbers.
    expect(code).not.toMatch(/\b1\.5\b/); // FOAM_DEPTH_END value
  });
});

describe("makeWaterPatch — foam variant (#define HAS_FOAM)", () => {
  it("defines HAS_FOAM and references the ground-height sampler + foam math", () => {
    const shader = freshShader();
    makeWaterPatch({ hasFoam: true, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const fs = stripGlslComments(shader.fragmentShader);
    expect(fs).toMatch(/#define\s+HAS_FOAM/);
    // The depth = seaLevel - groundHeight transcription.
    expect(fs).toMatch(/uSeaLevel\s*-/);
    // The sampler and its UV-space lookup of the baked ground-height texture.
    expect(fs).toContain("uGroundHeight");
    // The foam term 1.0 - smoothstep(uFoamStart, uFoamEnd, depth).
    expect(fs).toMatch(/1\.0\s*-\s*smoothstep\s*\(\s*uFoamStart\s*,\s*uFoamEnd/);
    // Foam blends the tone-mapped off-white over the water colour.
    expect(fs).toContain("uFoamColor");
  });

  it("returns a distinct, constant cache key for the foam variant", () => {
    const a = makeWaterPatch({ hasFoam: true, uniforms: {} }).customProgramCacheKey();
    const b = makeWaterPatch({ hasFoam: true, uniforms: {} }).customProgramCacheKey();
    expect(a).toBe(b); // constant — identical across builds
    const noFoam = makeWaterPatch({ hasFoam: false, uniforms: {} }).customProgramCacheKey();
    expect(a).not.toBe(noFoam); // disambiguated from the no-foam variant
  });
});

describe("makeWaterPatch — no-foam variant (heightAt absent)", () => {
  it("references NO foam sampler / foam uniform at all (no dangling reference)", () => {
    const shader = freshShader();
    makeWaterPatch({ hasFoam: false, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const fs = stripGlslComments(shader.fragmentShader);
    // HAS_FOAM is NOT defined, so the foam branch compiles out — but the patch
    // must also avoid referencing the sampler/uniforms outside that guard, so a
    // raw scan finds none of them in the no-foam program text.
    expect(fs).not.toContain("uGroundHeight");
    expect(fs).not.toContain("uFoamStart");
    expect(fs).not.toContain("uFoamEnd");
    expect(fs).not.toContain("uFoamColor");
    expect(fs).not.toMatch(/#define\s+HAS_FOAM/);
    // The colour ramp still applies — water still renders the fresnel blend.
    expect(fs).toContain("uWaterShallow");
    expect(fs).toContain("uWaterDeep");
  });

  it("still injects the vWorldXZ varying (the vertex stage is variant-agnostic)", () => {
    const shader = freshShader();
    makeWaterPatch({ hasFoam: false, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    expect(stripGlslComments(shader.vertexShader)).toMatch(/varying\s+vec2\s+vWorldXZ/);
  });
});

describe("makeWaterPatch — no-foam variant (T5: leak-free + cache-key disambiguation)", () => {
  it("adds NO new sampler2D and NO ground-texture sampling in the no-foam program", () => {
    const shader = freshShader();
    makeWaterPatch({ hasFoam: false, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const patchedFs = stripGlslComments(shader.fragmentShader);
    const baseFs = stripGlslComments(THREE.ShaderLib.standard.fragmentShader);
    // The base MeshStandard program declares its own optional-map samplers; the
    // contract is that the no-foam patch introduces NONE of its own. Counting the
    // `sampler2D` tokens, the patched program must match the base exactly — proof
    // the variant carries no dangling sampler the runtime would have to bind (AC8).
    const countSamplers = (s: string) => (s.match(/\bsampler2D\b/g) ?? []).length;
    expect(countSamplers(patchedFs)).toBe(countSamplers(baseFs));
    // The foam sampler in particular is absent.
    expect(patchedFs).not.toContain("uGroundHeight");
    // No ground-texture sampling call — the foam lookup is the only sampler call
    // the patch would ever add, and it is compiled out of this variant.
    expect(patchedFs).not.toMatch(/texture2D\s*\(\s*uGroundHeight/);
    expect(patchedFs).not.toMatch(/\btexture\s*\(\s*uGroundHeight/);
    // And the foam-depth math the sampling feeds is absent too.
    expect(patchedFs).not.toMatch(/uSeaLevel\s*-/);
    expect(patchedFs).not.toContain("groundUV");
  });

  it("keeps the vWorldXZ varying but uses it for NO foam sampling in the no-foam fragment", () => {
    const shader = freshShader();
    makeWaterPatch({ hasFoam: false, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const fs = stripGlslComments(shader.fragmentShader);
    // The varying is still declared (the vertex stage is variant-agnostic)...
    expect(fs).toMatch(/varying\s+vec2\s+vWorldXZ/);
    // ...but the fragment never reads it into a UV / sampler lookup.
    expect(fs).not.toMatch(/vWorldXZ\s*\//); // no `vWorldXZ / (...extent...)`
    expect(fs).not.toContain("groundUV");
  });

  it("retains the fresnel colour ramp in the no-foam fragment", () => {
    const shader = freshShader();
    makeWaterPatch({ hasFoam: false, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const fs = stripGlslComments(shader.fragmentShader);
    expect(fs).toMatch(/pow\s*\(\s*1\.0\s*-\s*max\s*\(\s*dot\s*\(/);
    expect(fs).toMatch(/mix\s*\(\s*uWaterShallow\s*,\s*uWaterDeep/);
  });

  it("returns a no-foam cache key distinct from the foam variant AND from a default MeshStandard program", () => {
    const noFoam = makeWaterPatch({ hasFoam: false, uniforms: {} }).customProgramCacheKey();
    const foam = makeWaterPatch({ hasFoam: true, uniforms: {} }).customProgramCacheKey();
    // Constant per variant, and distinct from the foam variant.
    expect(noFoam).toBe(makeWaterPatch({ hasFoam: false, uniforms: {} }).customProgramCacheKey());
    expect(noFoam).not.toBe(foam);
    // A material WITHOUT a customProgramCacheKey (terrain/props use the stock
    // MeshStandard program) caches under three's default empty key. The patched
    // water key must be a non-empty string so it never collides with those.
    expect(noFoam).not.toBe("");
    expect(foam).not.toBe("");
    // Namespaced so neither water variant can collide with a sibling program key.
    expect(noFoam).toMatch(/^water-/);
    expect(foam).toMatch(/^water-/);
  });
});

describe("makeWaterPatch — displacement variant (G1 animation, two vertex anchors)", () => {
  // The dead-code trap (proven against three 0.169 source): a normal recompute
  // injected at begin_vertex is too late — beginnormal_vertex declares
  // objectNormal, defaultnormal_vertex consumes it into transformedNormal, and
  // normal_vertex writes vNormal, ALL before begin_vertex. So the swell must be
  // injected at beginnormal_vertex (BEFORE defaultnormal_vertex) for the lit
  // normal to ripple; the y-displacement rides begin_vertex for the silhouette.

  /** Index of an anchor's `#include` in the patched vertex source (or -1). */
  const at = (src: string, chunk: string) =>
    src.indexOf(`#include <${chunk}>`);

  it("(1) injects the objectNormal overwrite anchored on #include <beginnormal_vertex>", () => {
    const shader = freshShader();
    makeWaterPatch({ hasFoam: false, uniforms: {}, displacement: true }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const vs = stripGlslComments(shader.vertexShader);
    // The recompute overwrites objectNormal from the analytic gradient, as
    // normalize(vec3(-dHdx, 1.0, -dHdz)).
    expect(vs).toMatch(/objectNormal\s*=\s*normalize\s*\(\s*vec3\s*\(/);
    // And it is anchored ON the beginnormal_vertex chunk — the overwrite text
    // appears AFTER that include (the include is the injection point).
    const begin = at(vs, "beginnormal_vertex");
    expect(begin).toBeGreaterThanOrEqual(0);
    const overwrite = vs.search(/objectNormal\s*=\s*normalize\s*\(\s*vec3\s*\(/);
    expect(overwrite).toBeGreaterThan(begin);
  });

  it("(2) ORDER: the objectNormal overwrite appears BEFORE #include <defaultnormal_vertex> (dead-code guard)", () => {
    const shader = freshShader();
    makeWaterPatch({ hasFoam: false, uniforms: {}, displacement: true }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const vs = stripGlslComments(shader.vertexShader);
    const overwrite = vs.search(/objectNormal\s*=\s*normalize\s*\(\s*vec3\s*\(/);
    const defaultNormal = at(vs, "defaultnormal_vertex");
    expect(overwrite).toBeGreaterThanOrEqual(0);
    expect(defaultNormal).toBeGreaterThanOrEqual(0);
    // The overwrite must run UPSTREAM of defaultnormal_vertex (which consumes
    // objectNormal into transformedNormal) — else it is dead for shading.
    expect(overwrite).toBeLessThan(defaultNormal);
  });

  it("(3) injects transformed.y += waveHeight(...) anchored on #include <begin_vertex>", () => {
    const shader = freshShader();
    makeWaterPatch({ hasFoam: false, uniforms: {}, displacement: true }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const vs = stripGlslComments(shader.vertexShader);
    // transformed.y is displaced by the wave height.
    expect(vs).toMatch(/transformed\.y\s*\+=\s*waveHeight\s*\(/);
    const beginVertex = at(vs, "begin_vertex");
    const displace = vs.search(/transformed\.y\s*\+=\s*waveHeight\s*\(/);
    expect(beginVertex).toBeGreaterThanOrEqual(0);
    // Displacement runs after `transformed` is born (i.e. after begin_vertex).
    expect(displace).toBeGreaterThan(beginVertex);
  });

  it("(4) both anchors source the raw `position` attribute, NOT `transformed`", () => {
    const shader = freshShader();
    makeWaterPatch({ hasFoam: false, uniforms: {}, displacement: true }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const vs = stripGlslComments(shader.vertexShader);
    // Anchor A reads position for the gradient; anchor B reads position for the
    // height. Both calls pass position.x/position.z (model space == world XZ).
    expect(vs).toMatch(/waveGradient\s*\(\s*position\.x\s*,\s*position\.z/);
    expect(vs).toMatch(/waveHeight\s*\(\s*position\.x\s*,\s*position\.z/);
    // Neither displacement read may key off `transformed` (which is the already
    // model-displaced position — using it would feed the prior frame's offset).
    expect(vs).not.toMatch(/waveGradient\s*\(\s*transformed/);
    expect(vs).not.toMatch(/waveHeight\s*\(\s*transformed/);
  });

  it("(5) both #include anchors are still present after the patch", () => {
    const shader = freshShader();
    makeWaterPatch({ hasFoam: false, uniforms: {}, displacement: true }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    expect(shader.vertexShader).toContain("#include <beginnormal_vertex>");
    expect(shader.vertexShader).toContain("#include <begin_vertex>");
  });

  it("(6) with displacement:false, NEITHER injection appears", () => {
    const shader = freshShader();
    makeWaterPatch({ hasFoam: false, uniforms: {}, displacement: false }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const vs = stripGlslComments(shader.vertexShader);
    expect(vs).not.toMatch(/objectNormal\s*=\s*normalize\s*\(\s*vec3\s*\(/);
    expect(vs).not.toMatch(/transformed\.y\s*\+=\s*waveHeight\s*\(/);
    // No wave functions emitted at all when displacement is off.
    expect(vs).not.toContain("waveHeight");
    expect(vs).not.toContain("waveGradient");
  });

  it("displacement defaults to false (omitted option leaves the vertex stage swell-free)", () => {
    const shader = freshShader();
    makeWaterPatch({ hasFoam: false, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const vs = stripGlslComments(shader.vertexShader);
    expect(vs).not.toContain("waveHeight");
  });

  it("emits the wave GLSL from the shared waveGlsl() emitter (no hand-copied math)", () => {
    const shader = freshShader();
    makeWaterPatch({ hasFoam: false, uniforms: {}, displacement: true }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    // The patched vertex source contains the exact shared emitter output — the
    // single source of truth for both anchors' math (no second magic-number copy).
    expect(shader.vertexShader).toContain(waveGlsl());
  });

  it("merges the caller-supplied uTime uniform onto shader.uniforms (identity-stable)", () => {
    const uTime = { value: 0 };
    const uniforms = { uTime };
    const shader = freshShader();
    makeWaterPatch({ hasFoam: false, uniforms, displacement: true }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    // The SAME {value} object is on the shader — the live WaterSystem and the
    // shader share one reference, no post-compile name-hunt or re-merge.
    expect(shader.uniforms.uTime).toBe(uTime);
  });

  it("the displacement cache key differs from the undisplaced key (no program collision)", () => {
    const disp = makeWaterPatch({ hasFoam: false, uniforms: {}, displacement: true }).customProgramCacheKey();
    const noDisp = makeWaterPatch({ hasFoam: false, uniforms: {}, displacement: false }).customProgramCacheKey();
    expect(disp).not.toBe(noDisp);
    // The displacement axis is orthogonal to foam: all four variants are distinct.
    const dispFoam = makeWaterPatch({ hasFoam: true, uniforms: {}, displacement: true }).customProgramCacheKey();
    const noDispFoam = makeWaterPatch({ hasFoam: true, uniforms: {}, displacement: false }).customProgramCacheKey();
    const keys = new Set([disp, noDisp, dispFoam, noDispFoam]);
    expect(keys.size).toBe(4);
    // Still namespaced under `water-`.
    for (const k of keys) expect(k).toMatch(/^water-/);
  });

  it("(T4) the four {hasFoam}x{displacement} keys are mutually distinct, water- namespaced, and the no-displacement keys are unchanged", () => {
    const key = (hasFoam: boolean, displacement: boolean) =>
      makeWaterPatch({ hasFoam, uniforms: {}, displacement }).customProgramCacheKey();

    const variants = [
      key(false, false),
      key(false, true),
      key(true, false),
      key(true, true),
    ];
    // Every one of the four logical variants gets its own program slot — no two
    // collide, so three can never serve an undisplaced program to a displaced
    // mesh (or vice versa), nor a foam program to a no-foam mesh.
    expect(new Set(variants).size).toBe(4);
    // Each is a non-empty, `water-`-namespaced string (so none collides with the
    // stock MeshStandard programs that cache under three's default empty key).
    for (const k of variants) {
      expect(k).not.toBe("");
      expect(k).toMatch(/^water-/);
    }

    // REGRESSION LOCK: adding the displacement axis must NOT have perturbed the
    // pre-existing slice-2 (no-displacement) keys — a changed key there would
    // silently invalidate the cached static-water programs. Pin the exact values.
    expect(key(false, false)).toBe("water-nofoam-v1");
    expect(key(true, false)).toBe("water-foam-v1");
    // The displacement variants carry the `-disp` axis suffix.
    expect(key(false, true)).toBe("water-nofoam-disp-v1");
    expect(key(true, true)).toBe("water-foam-disp-v1");
  });
});

describe("makeWaterPatch — uniform wiring", () => {
  it("merges the caller-supplied uniforms onto shader.uniforms", () => {
    const uniforms = {
      uWaterShallow: { value: new THREE.Vector3(...WATER_SHALLOW_LINEAR) },
      uWaterDeep: { value: new THREE.Vector3(...WATER_DEEP_LINEAR) },
      uFoamColor: { value: new THREE.Vector3(...FOAM_COLOR_LINEAR) },
      uFoamStart: { value: FOAM_DEPTH_START },
      uFoamEnd: { value: FOAM_DEPTH_END },
    };
    const shader = freshShader();
    makeWaterPatch({ hasFoam: true, uniforms }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    expect(shader.uniforms.uWaterShallow).toBe(uniforms.uWaterShallow);
    expect(shader.uniforms.uWaterDeep).toBe(uniforms.uWaterDeep);
    expect(shader.uniforms.uFoamStart.value).toBe(FOAM_DEPTH_START);
    expect(shader.uniforms.uFoamEnd.value).toBe(FOAM_DEPTH_END);
  });
});

describe("makeWaterPatch — detail variant (visual-overhaul slice 4: ripple normal + depth absorption + foam breakup)", () => {
  it("defensively ANDs detail with hasFoam && displacement — detail:true alone changes NOTHING", () => {
    // hasFoam:false, displacement:false — an invalid combination in practice
    // (boundaries.ts never requests it), but the patch must degrade instead
    // of compiling a dangling `depth`/`uTime` reference.
    const shader = freshShader();
    makeWaterPatch({ hasFoam: false, uniforms: {}, detail: true }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const fs = stripGlslComments(shader.fragmentShader);
    expect(fs).not.toMatch(/#define\s+HAS_DETAIL/);
    expect(fs).not.toContain("uWaterNormal");
    expect(fs).not.toContain("rippleUV");
    // Cache key is identical to the plain no-foam/no-displacement key.
    expect(makeWaterPatch({ hasFoam: false, uniforms: {}, detail: true }).customProgramCacheKey()).toBe(
      "water-nofoam-v1",
    );
  });

  it("hasFoam && displacement && detail: defines HAS_DETAIL and declares the ripple + detail-palette uniforms", () => {
    const shader = freshShader();
    makeWaterPatch({ hasFoam: true, uniforms: {}, displacement: true, detail: true }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const fs = stripGlslComments(shader.fragmentShader);
    expect(fs).toMatch(/#define\s+HAS_DETAIL/);
    expect(fs).toContain("uWaterNormal");
    expect(fs).toContain("uWaterShallowDetail");
    expect(fs).toContain("uWaterDeepDetail");
    // The fragment stage declares its OWN uTime uniform (GLSL uniforms are
    // per-stage) rather than relying on the vertex stage's declaration.
    expect(fs).toMatch(/uniform\s+float\s+uTime\s*;/);
    // Regression guard: `normalMatrix` is part of three's VERTEX-only prefix
    // (confirmed against a real WebGL compile — the fragment program failed
    // with "undeclared identifier" before this declaration was added), so the
    // detail block's own `normalMatrix *` use needs an explicit fragment-side
    // declaration too.
    expect(fs).toMatch(/uniform\s+mat3\s+normalMatrix\s*;/);
  });

  it("emits the ripple/depth-absorption GLSL from the shared waterSurface.ts emitters (no hand-copied math)", () => {
    const shader = freshShader();
    makeWaterPatch({ hasFoam: true, uniforms: {}, displacement: true, detail: true }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const fs = stripGlslComments(shader.fragmentShader);
    expect(fs).toMatch(/vec2\s+rippleUV\s*\(/);
    expect(fs).toMatch(/vec2\s+rippleWorldSlope\s*\(/);
    expect(fs).toMatch(/float\s+depthAbsorption\s*\(/);
    // The two ripple samples are actually sampled and combined.
    expect(fs).toContain("texture2D( uWaterNormal, rUV1 )");
    expect(fs).toContain("texture2D( uWaterNormal, rUV2 )");
    // Every art constant is carried BY VALUE from its single-source export.
    for (const v of [RIPPLE_TILE_1, RIPPLE_HEADING_2_COS, RIPPLE_NORMAL_STRENGTH, FOAM_BREAKUP_STRENGTH, DEPTH_ABSORPTION_RATE]) {
      expect(fs).toContain(glslFloat(v));
    }
  });

  it("reassigns `normal` from the detail block BEFORE fresnel is computed (glints reach the BRDF)", () => {
    const shader = freshShader();
    makeWaterPatch({ hasFoam: true, uniforms: {}, displacement: true, detail: true }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const fs = stripGlslComments(shader.fragmentShader);
    const detailNormalIdx = fs.search(/normal\s*=\s*normalize\s*\(\s*normal\s*\+/);
    const fresnelIdx = fs.search(/float\s+fresnel\s*=\s*pow/);
    expect(detailNormalIdx).toBeGreaterThanOrEqual(0);
    expect(fresnelIdx).toBeGreaterThan(detailNormalIdx);
  });

  it("scales the detail-normal perturbation by faceDirection (DoubleSide back-face mirror)", () => {
    // The water material is `side: THREE.DoubleSide` (swimming/looking-up-at-
    // the-surface). Three's `normal_fragment_begin` flips the BASE `normal` by
    // `faceDirection` under `#ifdef DOUBLE_SIDED` before this block runs; the
    // ADDED ripple perturbation must mirror that flip too, or the glint stays
    // sign-locked to the front face while the base normal flips underneath it.
    const shader = freshShader();
    makeWaterPatch({ hasFoam: true, uniforms: {}, displacement: true, detail: true }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const fs = stripGlslComments(shader.fragmentShader);
    expect(fs).toMatch(
      /normal\s*=\s*normalize\s*\(\s*normal\s*\+\s*faceDirection\s*\*\s*\(\s*normalMatrix\s*\*\s*vec3\s*\(\s*-microGrad\.x\s*,\s*0\.0\s*,\s*-microGrad\.y\s*\)\s*\)\s*\)/,
    );
    // The patch itself declares NO `faceDirection` — it only references the
    // variable three's own `normal_fragment_begin` chunk declares (that chunk
    // is still an un-expanded `#include` token at this string-patching stage,
    // resolved later by three's real compile step), so this must not
    // introduce a second, colliding declaration.
    expect(fs).not.toMatch(/float\s+faceDirection\s*=/);
  });

  it("the detail-tier ramp combines fresnel and depth absorption via max(), replacing the plain ramp", () => {
    const shader = freshShader();
    makeWaterPatch({ hasFoam: true, uniforms: {}, displacement: true, detail: true }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const fs = stripGlslComments(shader.fragmentShader);
    expect(fs).toMatch(/max\s*\(\s*fresnel\s*,\s*depthAbs\s*\)/);
    expect(fs).toMatch(/mix\s*\(\s*uWaterShallowDetail\s*,\s*uWaterDeepDetail/);
  });

  it("foam breakup jitters BOTH smoothstep edges identically from the ripple samples", () => {
    const shader = freshShader();
    makeWaterPatch({ hasFoam: true, uniforms: {}, displacement: true, detail: true }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const fs = stripGlslComments(shader.fragmentShader);
    expect(fs).toMatch(
      /smoothstep\s*\(\s*uFoamStart\s*\+\s*foamBreakup\s*,\s*uFoamEnd\s*\+\s*foamBreakup\s*,\s*depth\s*\)/,
    );
  });

  it("without detail (hasFoam && displacement only), the plain ramp/foam text is BYTE-IDENTICAL to before this slice", () => {
    const withoutDetail = freshShader();
    makeWaterPatch({ hasFoam: true, uniforms: {}, displacement: true }).onBeforeCompile(
      withoutDetail as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const fs = stripGlslComments(withoutDetail.fragmentShader);
    expect(fs).not.toContain("uWaterNormal");
    expect(fs).not.toContain("rippleUV");
    expect(fs).not.toContain("depthAbsorption");
    expect(fs).not.toContain("foamBreakup");
    expect(fs).toMatch(/mix\s*\(\s*uWaterShallow\s*,\s*uWaterDeep\s*,\s*clamp\s*\(\s*fresnel/);
    expect(fs).toMatch(/1\.0\s*-\s*smoothstep\s*\(\s*uFoamStart\s*,\s*uFoamEnd\s*,\s*depth\s*\)/);
  });

  it("the detail cache key is distinct from — and namespaced consistently with — the non-detail keys", () => {
    const key = (hasFoam: boolean, displacement: boolean, detail: boolean) =>
      makeWaterPatch({ hasFoam, uniforms: {}, displacement, detail }).customProgramCacheKey();

    const detailKey = key(true, true, true);
    expect(detailKey).toBe("water-foam-disp-detail-v2");
    expect(detailKey).not.toBe(key(true, true, false));
    expect(detailKey).toMatch(/^water-/);

    // The pre-existing four keys stay byte-identical (regression lock from the
    // displacement-axis test above) when `detail` is omitted.
    expect(key(false, false, false)).toBe("water-nofoam-v1");
    expect(key(true, false, false)).toBe("water-foam-v1");
    expect(key(false, true, false)).toBe("water-nofoam-disp-v1");
    expect(key(true, true, false)).toBe("water-foam-disp-v1");
  });

  it("merges the caller-supplied detail uniforms (sampler + detail palette) onto shader.uniforms", () => {
    const uWaterNormal = { value: new THREE.Texture() };
    const uWaterShallowDetail = { value: new THREE.Vector3(...WATER_SHALLOW_DETAIL_LINEAR) };
    const uWaterDeepDetail = { value: new THREE.Vector3(...WATER_DEEP_DETAIL_LINEAR) };
    const uTime = { value: 0 };
    const uniforms = { uWaterNormal, uWaterShallowDetail, uWaterDeepDetail, uTime };
    const shader = freshShader();
    makeWaterPatch({ hasFoam: true, uniforms, displacement: true, detail: true }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    expect(shader.uniforms.uWaterNormal).toBe(uWaterNormal);
    expect(shader.uniforms.uWaterShallowDetail).toBe(uWaterShallowDetail);
    expect(shader.uniforms.uWaterDeepDetail).toBe(uWaterDeepDetail);
    // The SAME uTime object the live WaterSystem advances — no separate clock.
    expect(shader.uniforms.uTime).toBe(uTime);
  });
});

describe("makeWaterPatch — stream flow (living-water epic: the current is visible)", () => {
  const detailPatch = () =>
    makeWaterPatch({ hasFoam: true, uniforms: {}, displacement: true, detail: true });

  it("the detail fragment samples the baked flow field and draws drifting streak lanes", () => {
    const shader = freshShader();
    detailPatch().onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms);
    const fs = stripGlslComments(shader.fragmentShader);
    expect(fs).toMatch(/uniform\s+sampler2D\s+uRiverFlow/);
    expect(fs).toMatch(/uniform\s+float\s+uFlowExtent/);
    expect(fs).toMatch(/STREAM_STREAK_SCROLL/);
    expect(fs).toMatch(/STREAM_STREAK_STRENGTH/);
    // Lanes mix toward the foam colour, scaled by the flow strength channel.
    expect(fs).toMatch(/uFoamColor,\s*clamp\(\s*lane/);
  });

  it("bakes the streak constants from their waterSurface exports — wrap-safe scroll included", () => {
    const shader = freshShader();
    detailPatch().onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms);
    const fs = shader.fragmentShader;
    expect(fs).toContain(`const float STREAM_STREAK_SCROLL = ${glslFloat(STREAM_STREAK_SCROLL)};`);
    expect(fs).toContain(
      `const float STREAM_STREAK_TILE_ALONG = ${glslFloat(STREAM_STREAK_TILE_ALONG)};`,
    );
    // The scroll closes exactly over the uTime wrap (integer cycles).
    expect(Number.isInteger(STREAM_STREAK_SCROLL * WRAP_PERIOD)).toBe(true);
  });

  it("non-detail variants compile ZERO flow tokens — low tier and base look untouched", () => {
    for (const opts of [
      { hasFoam: false, uniforms: {} },
      { hasFoam: true, uniforms: {} },
      { hasFoam: true, uniforms: {}, displacement: true },
    ]) {
      const shader = freshShader();
      makeWaterPatch(opts).onBeforeCompile(
        shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      );
      expect(shader.fragmentShader).not.toContain("uRiverFlow");
      expect(shader.fragmentShader).not.toContain("STREAM_STREAK");
    }
  });

  it("the detail cache key is bumped so three never serves the pre-flow program", () => {
    expect(detailPatch().customProgramCacheKey()).toBe("water-foam-disp-detail-v2");
  });
});
