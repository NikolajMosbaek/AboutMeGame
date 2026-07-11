import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { buildBoundaries, WATER_ROUGHNESS_BASE, WATER_ROUGHNESS_DETAIL, type WaterTextureLoader } from "./boundaries.ts";

// Visual-overhaul slice 4 (ripple normal-map detail): the async
// ripple-texture-attach path, runnable headless (a stub `WaterTextureLoader`
// never touches the network or jsdom's `Image` loading path). Mirrors
// `terrain.textures.test.ts`'s discipline exactly.

const stubHeightAt = (x: number, z: number) => 3 - 0.01 * (x * x + z * z) ** 0.5;

/** A stub loader that resolves a real (headless-constructible) `THREE.Texture`
 *  next microtask, recording every path it was asked to load. */
function stubLoader(): { load: WaterTextureLoader; calls: string[] } {
  const calls: string[] = [];
  const load: WaterTextureLoader = async (path) => {
    calls.push(path);
    return new THREE.Texture();
  };
  return { load, calls };
}

/** The single Mesh named "water" inside a boundaries group. */
function waterMesh(group: THREE.Group): THREE.Mesh {
  const found = group.children.filter(
    (o): o is THREE.Mesh => o instanceof THREE.Mesh && o.name === "water",
  );
  expect(found).toHaveLength(1);
  return found[0];
}

describe("buildBoundaries — detail off (default): no fetch, base look untouched", () => {
  it("never fetches the ripple texture and resolves texturesReady immediately", async () => {
    const { load, calls } = stubLoader();
    const b = buildBoundaries(stubHeightAt, true, false, load);
    const mat = waterMesh(b.group).material as THREE.MeshStandardMaterial;
    const beforeCompile = mat.onBeforeCompile;

    await b.texturesReady;

    expect(calls).toHaveLength(0);
    expect(mat.onBeforeCompile).toBe(beforeCompile);
    expect(mat.roughness).toBe(WATER_ROUGHNESS_BASE);
    b.dispose();
  });

  it("also never fetches when detail:true but heightAt/displacement are absent (defensive AND-gate)", async () => {
    const { load, calls } = stubLoader();
    const noHeight = buildBoundaries(undefined, true, true, load);
    const noDisplacement = buildBoundaries(stubHeightAt, false, true, load);
    await Promise.all([noHeight.texturesReady, noDisplacement.texturesReady]);
    expect(calls).toHaveLength(0);
    noHeight.dispose();
    noDisplacement.dispose();
  });
});

describe("buildBoundaries — detail on: async ripple-texture attach (upgrade in place)", () => {
  it("renders the base look the instant buildBoundaries returns (no onBeforeCompile swap yet)", () => {
    const { load } = stubLoader();
    const b = buildBoundaries(stubHeightAt, true, true, load);
    const mat = waterMesh(b.group).material as THREE.MeshStandardMaterial;
    // Roughness is set eagerly (a plain scalar, no recompile needed)...
    expect(mat.roughness).toBe(WATER_ROUGHNESS_DETAIL);
    // ...but the shader patch itself hasn't upgraded yet.
    expect((mat.customProgramCacheKey as () => string)()).toBe("water-foam-disp-v1");
    b.dispose();
  });

  it("fetches exactly the ripple-normal path and upgrades the patch once it attaches", async () => {
    const { load, calls } = stubLoader();
    const b = buildBoundaries(stubHeightAt, true, true, load);
    const mat = waterMesh(b.group).material as THREE.MeshStandardMaterial;

    await b.texturesReady;

    expect(calls).toEqual(["assets/textures/water/ripple-normal.webp"]);
    expect((mat.customProgramCacheKey as () => string)()).toBe("water-foam-disp-detail-v1");

    // Inspect the uniforms via a fresh shader object, mirroring
    // terrain.textures.test.ts's own discipline.
    const shader = {
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      uniforms: {} as Record<string, { value: unknown }>,
    };
    (mat.onBeforeCompile as (s: typeof shader) => void)(shader);
    const normalTex = shader.uniforms.uWaterNormal.value as THREE.Texture;
    expect(normalTex).toBeInstanceOf(THREE.Texture);
    expect(normalTex.wrapS).toBe(THREE.RepeatWrapping);
    expect(normalTex.wrapT).toBe(THREE.RepeatWrapping);
    expect(normalTex.colorSpace).toBe(THREE.NoColorSpace);
    // The SAME uTime object the live WaterSystem holds is still wired through
    // the upgraded patch (no second clock).
    expect(shader.uniforms.uTime).toBe(b.waterUniforms!.uTime);

    b.dispose();
  });

  it("disposes the just-loaded texture instead of attaching it if dispose() ran first (unmount race)", async () => {
    let resolveLoad!: () => void;
    const gate = new Promise<void>((resolve) => (resolveLoad = resolve));
    const loaded: THREE.Texture[] = [];
    const load: WaterTextureLoader = async (_path) => {
      await gate;
      const tex = new THREE.Texture();
      loaded.push(tex);
      return tex;
    };

    const b = buildBoundaries(stubHeightAt, true, true, load);
    const mat = waterMesh(b.group).material as THREE.MeshStandardMaterial;
    const beforeCompile = mat.onBeforeCompile;

    b.dispose(); // torn down WHILE the load is still in flight
    resolveLoad();
    await b.texturesReady;

    expect(mat.onBeforeCompile).toBe(beforeCompile); // never upgraded
    expect(loaded).toHaveLength(1);
    expect(loaded[0].isTexture).toBe(true);
  });

  it("disposes the attached texture when dispose() runs on the happy path", async () => {
    const loaded: THREE.Texture[] = [];
    const load: WaterTextureLoader = async (_path) => {
      const tex = new THREE.Texture();
      loaded.push(tex);
      return tex;
    };

    const b = buildBoundaries(stubHeightAt, true, true, load);
    await b.texturesReady;
    expect(loaded).toHaveLength(1);
    const spy = vi.spyOn(loaded[0], "dispose");

    b.dispose();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("never rejects on a load failure — logs and keeps the base water look", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const load: WaterTextureLoader = async () => {
      throw new Error("404");
    };
    const b = buildBoundaries(stubHeightAt, true, true, load);
    const mat = waterMesh(b.group).material as THREE.MeshStandardMaterial;
    const beforeCompile = mat.onBeforeCompile;

    await expect(b.texturesReady).resolves.toBeUndefined();
    expect(mat.onBeforeCompile).toBe(beforeCompile);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
    b.dispose();
  });
});
