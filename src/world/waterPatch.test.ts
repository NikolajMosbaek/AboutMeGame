import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  FOAM_DEPTH_END,
  FOAM_DEPTH_START,
} from "./waterSurface.ts";
import {
  FOAM_COLOR_LINEAR,
  WATER_DEEP_LINEAR,
  WATER_SHALLOW_LINEAR,
} from "./waterUniforms.ts";
import { FRESNEL_POWER, makeWaterPatch } from "./waterPatch.ts";

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
