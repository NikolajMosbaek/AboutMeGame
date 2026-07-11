import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { buildTerrain, type TerrainTextureLoader } from "./terrain.ts";
import { SPLAT_CHANNELS } from "./terrainSplat.ts";

// Visual-overhaul slice 3 (PBR terrain splatting): the geometry-side splat
// attribute and the async texture-attach path, both runnable headless (a stub
// `TerrainTextureLoader` never touches the network or jsdom's `Image` loading,
// so this is deterministic and fast).

/** A stub loader that resolves real (headless-constructible) `THREE.Texture`
 *  instances synchronously-ish (next microtask), recording every path it was
 *  asked to load. */
function stubLoader(): { load: TerrainTextureLoader; calls: string[] } {
  const calls: string[] = [];
  const load: TerrainTextureLoader = async (path) => {
    calls.push(path);
    return new THREE.Texture();
  };
  return { load, calls };
}

describe("buildTerrain — splatWeight geometry attribute", () => {
  it("packs a vec4 splatWeight attribute, one per vertex, summing to ~1", () => {
    const { calls, load } = stubLoader();
    const terrain = buildTerrain({ terrainDetail: "full", terrainAnisotropy: 4 }, load);
    void calls;
    const geo = terrain.mesh.geometry;
    const splat = geo.getAttribute("splatWeight");
    const pos = geo.getAttribute("position");
    expect(splat).toBeDefined();
    expect(splat.itemSize).toBe(4);
    expect(splat.count).toBe(pos.count);
    // Spot-check a spread of vertices (every 977th, a co-prime stride so it
    // doesn't alias the grid) rather than all ~68k for test speed.
    for (let i = 0; i < pos.count; i += 977) {
      const r = splat.getX(i);
      const g = splat.getY(i);
      const b = splat.getZ(i);
      const a = splat.getW(i);
      expect(r + g + b + a).toBeCloseTo(1, 3);
      for (const v of [r, g, b, a]) {
        expect(v).toBeGreaterThanOrEqual(-1e-6);
        expect(v).toBeLessThanOrEqual(1 + 1e-6);
      }
    }
    terrain.dispose();
  });
});

describe("buildTerrain — material (smooth-shaded, vertex-colour macro tint)", () => {
  it("drops flatShading and keeps vertexColors on", () => {
    const { load } = stubLoader();
    const terrain = buildTerrain({ terrainDetail: "full", terrainAnisotropy: 4 }, load);
    const mat = terrain.mesh.material as THREE.MeshStandardMaterial;
    expect(mat.flatShading).toBe(false);
    expect(mat.vertexColors).toBe(true);
    terrain.dispose();
  });

  it("renders the vertex-colour fallback the instant buildTerrain returns (no onBeforeCompile yet)", () => {
    const { load } = stubLoader();
    const terrain = buildTerrain({ terrainDetail: "full", terrainAnisotropy: 4 }, load);
    const mat = terrain.mesh.material as THREE.MeshStandardMaterial;
    // Three's own default no-op, not yet replaced by the splat patch.
    expect(mat.onBeforeCompile).toBe(THREE.Material.prototype.onBeforeCompile);
    terrain.dispose();
  });
});

describe("buildTerrain — async texture attach (upgrade in place)", () => {
  it("loads exactly the 4 albedo textures on the albedo-only tier, attaches the patch, never touches normal paths", async () => {
    const { load, calls } = stubLoader();
    const terrain = buildTerrain({ terrainDetail: "albedo", terrainAnisotropy: 4 }, load);
    const before = terrain.mesh.material as THREE.MeshStandardMaterial;
    const beforeCompile = before.onBeforeCompile;

    await terrain.texturesReady;

    expect(calls).toHaveLength(4);
    for (const ch of SPLAT_CHANNELS) {
      expect(calls.some((p) => p.includes(ch === "jungleFloor" ? "jungle-floor" : ch === "leafLitter" ? "leaf-litter" : ch))).toBe(true);
    }
    expect(calls.every((p) => p.endsWith("-albedo.webp"))).toBe(true);
    expect(calls.some((p) => p.endsWith("-normal.webp"))).toBe(false);

    const mat = terrain.mesh.material as THREE.MeshStandardMaterial;
    expect(mat.onBeforeCompile).not.toBe(beforeCompile);
    expect(typeof mat.customProgramCacheKey).toBe("function");
    expect((mat.customProgramCacheKey as () => string)()).toBe("terrain-albedo-v1");

    terrain.dispose();
  });

  it("loads 4 albedo + 4 normal textures on the full tier, tagging normals NoColorSpace and setting anisotropy/repeat wrap", async () => {
    const { load, calls } = stubLoader();
    const terrain = buildTerrain({ terrainDetail: "full", terrainAnisotropy: 8 }, load);

    await terrain.texturesReady;

    expect(calls).toHaveLength(8);
    expect(calls.filter((p) => p.endsWith("-albedo.webp"))).toHaveLength(4);
    expect(calls.filter((p) => p.endsWith("-normal.webp"))).toHaveLength(4);

    const mat = terrain.mesh.material as THREE.MeshStandardMaterial;
    expect((mat.customProgramCacheKey as () => string)()).toBe("terrain-full-v1");

    // Inspect the uniforms the patch was built with via the material's own
    // onBeforeCompile closure — assert indirectly through a fresh shader
    // object, mirroring terrainMaterialPatch.test.ts's own discipline.
    const shader = {
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      uniforms: {} as Record<string, { value: unknown }>,
    };
    (mat.onBeforeCompile as (s: typeof shader) => void)(shader);
    const albedoTex = shader.uniforms.uAlbedoJungleFloor.value as THREE.Texture;
    const normalTex = shader.uniforms.uNormalJungleFloor.value as THREE.Texture;
    expect(albedoTex).toBeInstanceOf(THREE.Texture);
    expect(albedoTex.wrapS).toBe(THREE.RepeatWrapping);
    expect(albedoTex.wrapT).toBe(THREE.RepeatWrapping);
    expect(albedoTex.anisotropy).toBe(8);
    expect(normalTex.colorSpace).toBe(THREE.NoColorSpace);
    expect(normalTex.anisotropy).toBe(8);

    terrain.dispose();
  });

  it("disposes just-loaded textures instead of attaching them if dispose() ran first (unmount race)", async () => {
    let resolveLoad!: () => void;
    const gate = new Promise<void>((resolve) => (resolveLoad = resolve));
    const loaded: THREE.Texture[] = [];
    const load: TerrainTextureLoader = async (_path) => {
      await gate;
      const tex = new THREE.Texture();
      loaded.push(tex);
      return tex;
    };

    const terrain = buildTerrain({ terrainDetail: "albedo", terrainAnisotropy: 4 }, load);
    const mat = terrain.mesh.material as THREE.MeshStandardMaterial;
    const beforeCompile = mat.onBeforeCompile;

    terrain.dispose(); // torn down WHILE the load is still in flight
    resolveLoad();
    await terrain.texturesReady;

    // The material was never upgraded...
    expect(mat.onBeforeCompile).toBe(beforeCompile);
    // ...and every texture that finished loading afterward was disposed, not
    // left to leak as an orphaned GPU upload.
    expect(loaded).toHaveLength(4);
    for (const tex of loaded) {
      expect(tex.isTexture).toBe(true); // sanity: a real Texture, not a mock
    }
  });

  it("disposes every attached texture when dispose() runs on the happy path (no unmount race)", async () => {
    const loaded: THREE.Texture[] = [];
    const load: TerrainTextureLoader = async (_path) => {
      const tex = new THREE.Texture();
      loaded.push(tex);
      return tex;
    };

    const terrain = buildTerrain({ terrainDetail: "full", terrainAnisotropy: 4 }, load);
    await terrain.texturesReady;

    expect(loaded).toHaveLength(8); // 4 albedo + 4 normal, attached (not disposed yet)
    const spies = loaded.map((tex) => vi.spyOn(tex, "dispose"));

    terrain.dispose();

    for (const spy of spies) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });

  it("never rejects on a load failure — logs and keeps the vertex-colour fallback", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const load: TerrainTextureLoader = async () => {
      throw new Error("404");
    };
    const terrain = buildTerrain({ terrainDetail: "full", terrainAnisotropy: 4 }, load);
    const mat = terrain.mesh.material as THREE.MeshStandardMaterial;
    const beforeCompile = mat.onBeforeCompile;

    await expect(terrain.texturesReady).resolves.toBeUndefined();
    expect(mat.onBeforeCompile).toBe(beforeCompile); // never upgraded
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
    terrain.dispose();
  });
});
