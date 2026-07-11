import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { glslFloat } from "./glslFormat.ts";
import { WIND_BEND_EXPONENT, WIND_HASH_SCALE, WIND_HASH_X, WIND_HASH_Z, WIND_SPEED } from "./windSway.ts";
import { makeWindPatch } from "./windPatch.ts";

// The onBeforeCompile GLSL patch builder for foliage-bearing flora materials
// (visual-overhaul slice 6). Verified against the REAL three MeshStandard
// shader source (the `waterPatch.test.ts` idiom), not a fabricated stub, so
// the injected anchor is guarded against a three-version chunk rename. No
// WebGL context needed — onBeforeCompile mutates plain strings.

function freshShader() {
  return {
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: {} as Record<string, { value: unknown }>,
  };
}

function stripGlslComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

describe("makeWindPatch", () => {
  it("returns an onBeforeCompile fn and a string customProgramCacheKey", () => {
    const patch = makeWindPatch({ maxHeight: 9.8, strength: 0.4, uniforms: {} });
    expect(typeof patch.onBeforeCompile).toBe("function");
    expect(typeof patch.customProgramCacheKey).toBe("function");
    expect(typeof patch.customProgramCacheKey()).toBe("string");
  });

  it("injects the sway block into the vertex stage only (no fragment change)", () => {
    const shader = freshShader();
    const fragBefore = shader.fragmentShader;
    makeWindPatch({ maxHeight: 9.8, strength: 0.4, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    expect(shader.fragmentShader).toBe(fragBefore);
    const vs = stripGlslComments(shader.vertexShader);
    expect(vs).toMatch(/transformed\.x\s*\+=\s*windBend/);
  });

  it("guards the sway block behind #ifdef USE_INSTANCING", () => {
    const shader = freshShader();
    makeWindPatch({ maxHeight: 9.8, strength: 0.4, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const vs = shader.vertexShader;
    const ifdefIdx = vs.indexOf("#ifdef USE_INSTANCING");
    const bendIdx = vs.indexOf("windBend");
    expect(ifdefIdx).toBeGreaterThanOrEqual(0);
    expect(bendIdx).toBeGreaterThan(ifdefIdx);
  });

  it("bakes maxHeight/strength/WIND_SPEED as GLSL float constants", () => {
    const shader = freshShader();
    makeWindPatch({ maxHeight: 6.5, strength: 0.6, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const vs = stripGlslComments(shader.vertexShader);
    expect(vs).toContain("const float WIND_MAX_HEIGHT = 6.5;");
    expect(vs).toContain("const float WIND_STRENGTH = 0.6;");
    expect(vs).toContain(`const float WIND_SPEED = ${WIND_SPEED};`);
  });

  it("transliterates the height ramp as pow(windHeight01, WIND_BEND_EXPONENT) (squared, not linear)", () => {
    const shader = freshShader();
    makeWindPatch({ maxHeight: 1, strength: 1, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const vs = stripGlslComments(shader.vertexShader);
    expect(vs).toMatch(/pow\(\s*windHeight01\s*,\s*WIND_BEND_EXPONENT\s*\)/);
    expect(vs).toMatch(/clamp\s*\(\s*position\.y\s*\/\s*WIND_MAX_HEIGHT/);
  });

  it("bakes windSway.ts's shared hash constants and bend exponent verbatim (parity guard, #findings-5-review)", () => {
    // Every constant `windSway.ts`'s TS reference math and this GLSL patch
    // BOTH need (previously hand-typed twice) is asserted here byte-for-byte
    // against the shared export — a tuning edit to any of them can never
    // silently desync the shader from its reference implementation again.
    const shader = freshShader();
    makeWindPatch({ maxHeight: 6.5, strength: 0.6, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const vs = stripGlslComments(shader.vertexShader);
    expect(vs).toContain(`const float WIND_HASH_X = ${glslFloat(WIND_HASH_X)};`);
    expect(vs).toContain(`const float WIND_HASH_Z = ${glslFloat(WIND_HASH_Z)};`);
    expect(vs).toContain(`const float WIND_HASH_SCALE = ${glslFloat(WIND_HASH_SCALE)};`);
    expect(vs).toContain(`const float WIND_BEND_EXPONENT = ${glslFloat(WIND_BEND_EXPONENT)};`);
    expect(vs).toMatch(
      /windHash\s*=\s*sin\(\s*instanceMatrix\[3\]\.x\s*\*\s*WIND_HASH_X\s*\+\s*instanceMatrix\[3\]\.z\s*\*\s*WIND_HASH_Z\s*\)\s*\*\s*WIND_HASH_SCALE/,
    );
  });

  it("merges the caller-supplied uTime uniform onto shader.uniforms", () => {
    const shader = freshShader();
    const uTime = { value: 1.5 };
    makeWindPatch({ maxHeight: 9.8, strength: 0.4, uniforms: { uTime } }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    expect(shader.uniforms.uTime).toBe(uTime);
  });

  it("gives distinct cache keys to distinct (maxHeight, strength) pairs, same key for identical ones", () => {
    const a = makeWindPatch({ maxHeight: 9.8, strength: 0.4, uniforms: {} }).customProgramCacheKey();
    const b = makeWindPatch({ maxHeight: 6.5, strength: 0.4, uniforms: {} }).customProgramCacheKey();
    const c = makeWindPatch({ maxHeight: 9.8, strength: 0.6, uniforms: {} }).customProgramCacheKey();
    const d = makeWindPatch({ maxHeight: 9.8, strength: 0.4, uniforms: {} }).customProgramCacheKey();
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).toBe(d);
  });
});
