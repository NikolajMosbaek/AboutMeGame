import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  TERRAIN_TILE_SIZE,
  makeTerrainMaterialPatch,
} from "./terrainMaterialPatch.ts";

// The `onBeforeCompile` GLSL patch builder for the terrain `MeshStandard`
// material (visual-overhaul slice 3). Verified against the REAL three
// MeshStandard shader source (`THREE.ShaderLib.standard`), same discipline as
// `waterPatch.test.ts` — no fabricated stub, no WebGL context needed.

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

describe("makeTerrainMaterialPatch — shared (albedo, every tier)", () => {
  it("returns an onBeforeCompile fn and a string customProgramCacheKey", () => {
    const patch = makeTerrainMaterialPatch({ hasNormalMaps: false, uniforms: {} });
    expect(typeof patch.onBeforeCompile).toBe("function");
    expect(typeof patch.customProgramCacheKey).toBe("function");
    expect(typeof patch.customProgramCacheKey()).toBe("string");
  });

  it("injects the splatWeight attribute and vWorldXZ/vSplatWeight varyings", () => {
    const shader = freshShader();
    makeTerrainMaterialPatch({ hasNormalMaps: false, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const vs = stripGlslComments(shader.vertexShader);
    const fs = stripGlslComments(shader.fragmentShader);
    expect(vs).toMatch(/attribute\s+vec4\s+splatWeight/);
    expect(vs).toMatch(/varying\s+vec4\s+vSplatWeight/);
    expect(fs).toMatch(/varying\s+vec4\s+vSplatWeight/);
    expect(vs).toMatch(/varying\s+vec2\s+vWorldXZ/);
    expect(fs).toMatch(/varying\s+vec2\s+vWorldXZ/);
    // Both varyings are actually written in the vertex stage.
    expect(vs).toMatch(/vSplatWeight\s*=\s*splatWeight/);
    expect(vs).toMatch(/vWorldXZ\s*=/);
  });

  it("blends 4 albedo samples by vSplatWeight and writes diffuseColor.rgb BEFORE color_fragment", () => {
    const shader = freshShader();
    makeTerrainMaterialPatch({ hasNormalMaps: false, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const fs = stripGlslComments(shader.fragmentShader);
    for (const sampler of [
      "uAlbedoJungleFloor",
      "uAlbedoLeafLitter",
      "uAlbedoRock",
      "uAlbedoSand",
    ]) {
      expect(fs).toContain(sampler);
    }
    expect(fs).toMatch(/diffuseColor\.rgb\s*=\s*splatAlbedo/);
    // Ordering: our albedo-write anchor (map_fragment) precedes three's own
    // vertex-colour multiply (color_fragment) — that ordering IS the macro
    // tint, with zero extra code (three's `diffuseColor.rgb *= vColor` already
    // wired by `vertexColors: true` runs on our blended albedo for free).
    const mapIdx = fs.indexOf("#include <map_fragment>");
    const splatIdx = fs.indexOf("splatAlbedo");
    const colorIdx = fs.indexOf("#include <color_fragment>");
    expect(mapIdx).toBeGreaterThanOrEqual(0);
    expect(splatIdx).toBeGreaterThan(mapIdx);
    expect(colorIdx).toBeGreaterThan(splatIdx);
  });

  it("tiles the planar world-XZ UV at TERRAIN_TILE_SIZE (~5-8 world units/repeat)", () => {
    expect(TERRAIN_TILE_SIZE).toBeGreaterThanOrEqual(5);
    expect(TERRAIN_TILE_SIZE).toBeLessThanOrEqual(8);
    const shader = freshShader();
    makeTerrainMaterialPatch({ hasNormalMaps: false, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const fs = stripGlslComments(shader.fragmentShader);
    expect(fs).toMatch(/vWorldXZ\s*\/\s*TERRAIN_TILE_SIZE/);
    expect(fs).toMatch(new RegExp(`TERRAIN_TILE_SIZE\\s*=\\s*${TERRAIN_TILE_SIZE}\\.0`));
  });

  it("merges the caller's uniform bag onto shader.uniforms", () => {
    const shader = freshShader();
    const tex = {} as THREE.Texture;
    makeTerrainMaterialPatch({
      hasNormalMaps: false,
      uniforms: { uAlbedoJungleFloor: { value: tex } },
    }).onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms);
    expect(shader.uniforms.uAlbedoJungleFloor.value).toBe(tex);
  });

  it("anchors onto real three chunks (no fabricated stub) and keeps them present", () => {
    const shader = freshShader();
    makeTerrainMaterialPatch({ hasNormalMaps: false, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    expect(shader.vertexShader).toContain("#include <color_vertex>");
    expect(shader.vertexShader).toContain("#include <worldpos_vertex>");
    expect(shader.fragmentShader).toContain("#include <map_fragment>");
    expect(shader.fragmentShader).toContain("#include <color_fragment>");
  });
});

describe("makeTerrainMaterialPatch — albedo-only variant (low tier, hasNormalMaps: false)", () => {
  it("references NO normal sampler / tangent-frame helper at all (no dangling reference)", () => {
    const shader = freshShader();
    makeTerrainMaterialPatch({ hasNormalMaps: false, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const fs = stripGlslComments(shader.fragmentShader);
    expect(fs).not.toContain("uNormalJungleFloor");
    expect(fs).not.toContain("uNormalLeafLitter");
    expect(fs).not.toContain("uNormalRock");
    expect(fs).not.toContain("uNormalSand");
    expect(fs).not.toContain("terrainTangentFrame");
    expect(fs).not.toMatch(/#define\s+HAS_TERRAIN_NORMALMAPS/);
  });

  it("adds no new sampler2D beyond the 4 albedo ones (matches base + 4 exactly)", () => {
    const shader = freshShader();
    makeTerrainMaterialPatch({ hasNormalMaps: false, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const patchedFs = stripGlslComments(shader.fragmentShader);
    const baseFs = stripGlslComments(THREE.ShaderLib.standard.fragmentShader);
    const countSamplers = (s: string) => (s.match(/\bsampler2D\b/g) ?? []).length;
    expect(countSamplers(patchedFs)).toBe(countSamplers(baseFs) + 4);
  });
});

describe("makeTerrainMaterialPatch — full variant (medium/high, hasNormalMaps: true)", () => {
  it("defines HAS_TERRAIN_NORMALMAPS and blends 4 tangent-space normal samples", () => {
    const shader = freshShader();
    makeTerrainMaterialPatch({ hasNormalMaps: true, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const fs = stripGlslComments(shader.fragmentShader);
    expect(fs).toMatch(/#define\s+HAS_TERRAIN_NORMALMAPS/);
    for (const sampler of [
      "uNormalJungleFloor",
      "uNormalLeafLitter",
      "uNormalRock",
      "uNormalSand",
    ]) {
      expect(fs).toContain(sampler);
    }
    expect(fs).toContain("terrainTangentFrame");
    expect(fs).toMatch(/normal\s*=\s*normalize\s*\(\s*terrainTBN\s*\*\s*blendedN\s*\)/);
  });

  it("adds 8 sampler2D total (4 albedo + 4 normal) beyond the base program", () => {
    const shader = freshShader();
    makeTerrainMaterialPatch({ hasNormalMaps: true, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const patchedFs = stripGlslComments(shader.fragmentShader);
    const baseFs = stripGlslComments(THREE.ShaderLib.standard.fragmentShader);
    const countSamplers = (s: string) => (s.match(/\bsampler2D\b/g) ?? []).length;
    expect(countSamplers(patchedFs)).toBe(countSamplers(baseFs) + 8);
  });

  it("injects the normal blend AFTER normal_fragment_maps (normal/vViewPosition already in scope)", () => {
    const shader = freshShader();
    makeTerrainMaterialPatch({ hasNormalMaps: true, uniforms: {} }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const fs = shader.fragmentShader;
    const anchorIdx = fs.indexOf("#include <normal_fragment_maps>");
    const blendIdx = fs.indexOf("terrainTangentFrame( -vViewPosition");
    expect(anchorIdx).toBeGreaterThanOrEqual(0);
    expect(blendIdx).toBeGreaterThan(anchorIdx);
  });
});

describe("makeTerrainMaterialPatch — program cache key", () => {
  it("returns a constant, distinct-per-variant, non-empty, namespaced key", () => {
    const albedo1 = makeTerrainMaterialPatch({ hasNormalMaps: false, uniforms: {} }).customProgramCacheKey();
    const albedo2 = makeTerrainMaterialPatch({ hasNormalMaps: false, uniforms: {} }).customProgramCacheKey();
    const full = makeTerrainMaterialPatch({ hasNormalMaps: true, uniforms: {} }).customProgramCacheKey();
    expect(albedo1).toBe(albedo2);
    expect(albedo1).not.toBe(full);
    expect(albedo1).not.toBe("");
    expect(full).not.toBe("");
    expect(albedo1).toMatch(/^terrain-/);
    expect(full).toMatch(/^terrain-/);
  });
});
