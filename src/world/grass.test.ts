import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GRASS_COUNT, buildGrass, grassPlacements, isOpenGround } from "./grass.ts";
import { buildTerrain, distToRiver } from "./terrain.ts";
import { POI_ANCHORS, RIVER, SPAWN, WORLD } from "./worldConfig.ts";
import type { WindUniforms } from "./windSystem.ts";

describe("isOpenGround", () => {
  const terrain = buildTerrain();

  it("reads the river-mud lowlands as NOT open ground (sand-dominant)", () => {
    // Just above the shoreline threshold used elsewhere in this file's own
    // terrain — low, flat ground right at the waterline reads sandy.
    expect(isOpenGround(terrain, 0, 0)).toBe(false);
  });

  it("is a plain boolean for arbitrary in-world points (never throws/NaNs)", () => {
    for (let i = 0; i < 40; i++) {
      const x = (i - 20) * 11;
      const z = (i - 10) * 13;
      expect(typeof isOpenGround(terrain, x, z)).toBe("boolean");
    }
  });
});

describe("grassPlacements", () => {
  const terrain = buildTerrain();

  it("is deterministic: two calls at the same density yield identical placements", () => {
    const a = grassPlacements(terrain, 1);
    const b = grassPlacements(terrain, 1);
    expect(b).toEqual(a);
  });

  it("scales down with density and never exceeds the GRASS_COUNT budget", () => {
    const full = grassPlacements(terrain, 1);
    const half = grassPlacements(terrain, 0.5);
    expect(full.length).toBeLessThanOrEqual(GRASS_COUNT);
    expect(half.length).toBeLessThan(full.length);
  });

  it("never places a tuft inside the river channel", () => {
    const placements = grassPlacements(terrain, 1);
    for (const p of placements) {
      expect(distToRiver(p.x, p.z)).toBeGreaterThanOrEqual(RIVER.bankHalfWidth + 1 - 1e-6);
    }
  });

  it("never places a tuft within the camp clearing or a site's clearance radius", () => {
    const placements = grassPlacements(terrain, 1);
    for (const p of placements) {
      const dCamp = Math.hypot(p.x - SPAWN.x, p.z - SPAWN.z);
      expect(dCamp).toBeGreaterThanOrEqual(WORLD.campClearRadius + 2 - 1e-6);
      for (const a of POI_ANCHORS) {
        expect(Math.hypot(p.x - a.x, p.z - a.z)).toBeGreaterThanOrEqual(6 - 1e-6);
      }
    }
  });

  it("places every tuft within the world boundary, on open ground", () => {
    const placements = grassPlacements(terrain, 1);
    expect(placements.length).toBeGreaterThan(0);
    for (const p of placements) {
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(WORLD.boundaryRadius - 4 + 1e-6);
      expect(isOpenGround(terrain, p.x, p.z)).toBe(true);
    }
  });
});

describe("buildGrass", () => {
  const terrain = buildTerrain();
  const windUniforms: WindUniforms = { uTime: { value: 0 } };

  it("builds exactly ONE InstancedMesh draw call", () => {
    const grass = buildGrass(terrain, 1, windUniforms);
    let count = 0;
    grass.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) count++;
    });
    expect(count).toBe(1);
    grass.dispose();
  });

  it("never casts a shadow (thin ground-level foliage) but receives them", () => {
    const grass = buildGrass(terrain, 1, windUniforms);
    let mesh: THREE.InstancedMesh | undefined;
    grass.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) mesh = o;
    });
    expect(mesh?.castShadow).toBe(false);
    expect(mesh?.receiveShadow).toBe(true);
    grass.dispose();
  });

  it("matches grassPlacements' instance count for the same density", () => {
    const placements = grassPlacements(terrain, 0.6);
    const grass = buildGrass(terrain, 0.6, windUniforms);
    let mesh: THREE.InstancedMesh | undefined;
    grass.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) mesh = o;
    });
    expect(mesh?.count).toBe(placements.length);
    grass.dispose();
  });

  it("dispose() releases geometry/material without throwing", () => {
    const grass = buildGrass(terrain, 1, windUniforms);
    expect(() => grass.dispose()).not.toThrow();
  });
});
