import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { FrameContext } from "../engine/types.ts";
import type { ReducedMotionSource } from "./buildWorld.ts";
import {
  CLOUD_COUNT,
  CLOUD_DOMAIN_HALF_EXTENT,
  CloudSystem,
  cloudDriftPosition,
  cloudTint,
  makeCloudPlacements,
} from "./clouds.ts";

describe("makeCloudPlacements (deterministic scatter)", () => {
  it("is a pure function: the same seed produces byte-identical output", () => {
    expect(makeCloudPlacements(9, 5)).toEqual(makeCloudPlacements(9, 5));
  });

  it("returns exactly `count` clouds, each inside the drift domain", () => {
    const clouds = makeCloudPlacements(9, 2);
    expect(clouds).toHaveLength(9);
    for (const c of clouds) {
      expect(Math.abs(c.baseX)).toBeLessThanOrEqual(CLOUD_DOMAIN_HALF_EXTENT);
      expect(Math.abs(c.z)).toBeLessThanOrEqual(CLOUD_DOMAIN_HALF_EXTENT);
      expect(c.scale).toBeGreaterThan(0);
      expect(c.driftSpeed).toBeGreaterThan(0);
    }
  });

  it("the default CLOUD_COUNT is within the design's 5-9 range", () => {
    expect(CLOUD_COUNT).toBeGreaterThanOrEqual(5);
    expect(CLOUD_COUNT).toBeLessThanOrEqual(9);
  });
});

describe("cloudDriftPosition (drift + wrap-around)", () => {
  it("advances with elapsed time before hitting the domain edge", () => {
    const early = cloudDriftPosition(0, 2, 1, 100);
    expect(early).toBeCloseTo(2, 10);
  });

  it("wraps around the domain instead of drifting off unbounded", () => {
    // A huge elapsed*speed product would run off to +infinity without wrap.
    const wrapped = cloudDriftPosition(0, 10, 1000, 100);
    expect(wrapped).toBeGreaterThanOrEqual(-100);
    expect(wrapped).toBeLessThan(100);
  });

  it("is continuous across the wrap seam (no reversal, only a clean jump to the far edge)", () => {
    const wrapped = cloudDriftPosition(99, 3, 1, 100); // 99 + 3 = 102 -> wraps to -98
    expect(wrapped).toBeCloseTo(-98, 6);
  });
});

describe("cloudTint (palette-driven colour)", () => {
  const WARM_SUN: readonly [number, number, number] = [1, 0.76, 0.48]; // dusk-ish amber

  it("is bright/near-white at a high (noon-strength) sun", () => {
    const t = cloudTint(0.9, WARM_SUN);
    expect(t.r).toBeGreaterThan(0.8);
    expect(t.g).toBeGreaterThan(0.8);
    expect(t.b).toBeGreaterThan(0.75);
  });

  it("warms toward the sun colour and darkens as the sun gets low", () => {
    const high = cloudTint(0.9, WARM_SUN);
    const low = cloudTint(0.05, WARM_SUN);
    // Lower sun should shift the tint away from the bright default AND overall dim it.
    expect(low.r + low.g + low.b).toBeLessThan(high.r + high.g + high.b);
  });

  it("is a pure function: identical inputs produce identical output", () => {
    expect(cloudTint(0.4, WARM_SUN)).toEqual(cloudTint(0.4, WARM_SUN));
  });
});

function dayCycle(sunDirY: number, sunColor: readonly [number, number, number]) {
  const dir = new THREE.Vector3(0, sunDirY, Math.sqrt(Math.max(0, 1 - sunDirY * sunDirY)));
  return {
    getSunDirection: () => dir,
    getPalette: () => ({ sunColor }),
  };
}

function reducedMotion(still: boolean): ReducedMotionSource {
  return { getSnapshot: () => ({ reducedMotion: still }) };
}

function ctxWith(dt: number, camera = new THREE.PerspectiveCamera()): FrameContext {
  return { scene: new THREE.Scene(), camera, dt, elapsed: 0 };
}

describe("CloudSystem (GPU wiring)", () => {
  it("adds exactly ONE InstancedMesh draw call with CLOUD_COUNT instances", () => {
    const scene = new THREE.Scene();
    new CloudSystem(scene, dayCycle(0.8, [1, 0.9, 0.7]));

    const meshes: THREE.InstancedMesh[] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) meshes.push(o);
    });
    expect(meshes).toHaveLength(1);
    expect(meshes[0].count).toBe(CLOUD_COUNT);
  });

  it("drifts instances over time when motion is allowed (matrices change frame to frame)", () => {
    const scene = new THREE.Scene();
    const sys = new CloudSystem(scene, dayCycle(0.8, [1, 0.9, 0.7]), reducedMotion(false));
    const mesh = scene.children[0] as THREE.InstancedMesh;

    const before = new THREE.Matrix4();
    mesh.getMatrixAt(0, before);
    sys.update(ctxWith(50));
    const after = new THREE.Matrix4();
    mesh.getMatrixAt(0, after);

    expect(before.equals(after)).toBe(false);
  });

  it("under reduced motion, holds drift still (matrices unchanged across frames)", () => {
    const scene = new THREE.Scene();
    const sys = new CloudSystem(scene, dayCycle(0.8, [1, 0.9, 0.7]), reducedMotion(true));
    const mesh = scene.children[0] as THREE.InstancedMesh;

    sys.update(ctxWith(10));
    const first = new THREE.Matrix4();
    mesh.getMatrixAt(0, first);
    sys.update(ctxWith(10));
    const second = new THREE.Matrix4();
    mesh.getMatrixAt(0, second);

    expect(first.equals(second)).toBe(true);
  });

  it("re-orients every quad to face the CURRENT camera each frame", () => {
    const scene = new THREE.Scene();
    const sys = new CloudSystem(scene, dayCycle(0.8, [1, 0.9, 0.7]));
    const mesh = scene.children[0] as THREE.InstancedMesh;

    const camA = new THREE.PerspectiveCamera();
    camA.quaternion.setFromEuler(new THREE.Euler(0, Math.PI / 4, 0));
    sys.update(ctxWith(0, camA));
    const afterA = new THREE.Matrix4();
    mesh.getMatrixAt(0, afterA);
    const rotA = new THREE.Quaternion();
    const posA = new THREE.Vector3();
    const scaleA = new THREE.Vector3();
    afterA.decompose(posA, rotA, scaleA);

    expect(rotA.x).toBeCloseTo(camA.quaternion.x, 6);
    expect(rotA.y).toBeCloseTo(camA.quaternion.y, 6);
    expect(rotA.z).toBeCloseTo(camA.quaternion.z, 6);
    expect(rotA.w).toBeCloseTo(camA.quaternion.w, 6);
  });

  it("tints instances from the live palette (instanceColor present and updated)", () => {
    const scene = new THREE.Scene();
    const source = { dirY: 0.9, color: [1, 0.9, 0.7] as [number, number, number] };
    const sys = new CloudSystem(scene, {
      getSunDirection: () => new THREE.Vector3(0, source.dirY, 0.4),
      getPalette: () => ({ sunColor: source.color }),
    });
    const mesh = scene.children[0] as THREE.InstancedMesh;

    sys.update(ctxWith(0));
    const bright = new THREE.Color();
    mesh.getColorAt(0, bright);

    source.dirY = 0.05;
    source.color = [1, 0.6, 0.35];
    sys.update(ctxWith(0));
    const dim = new THREE.Color();
    mesh.getColorAt(0, dim);

    expect(bright.getHexString()).not.toBe(dim.getHexString());
  });

  it("dispose() removes the mesh from the scene and disposes GPU resources", () => {
    const scene = new THREE.Scene();
    const sys = new CloudSystem(scene, dayCycle(0.8, [1, 0.9, 0.7]));
    const mesh = scene.children[0] as THREE.InstancedMesh;
    const meshDispose = vi.spyOn(mesh, "dispose");
    const geoDispose = vi.spyOn(mesh.geometry, "dispose");
    const matDispose = vi.spyOn(mesh.material as THREE.Material, "dispose");

    sys.dispose();

    expect(scene.children).toHaveLength(0);
    expect(meshDispose).toHaveBeenCalledTimes(1);
    expect(geoDispose).toHaveBeenCalledTimes(1);
    expect(matDispose).toHaveBeenCalledTimes(1);
  });
});
