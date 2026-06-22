import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildProps, TREE_COUNT, ROCK_COUNT } from "./props.ts";
import { buildTerrain } from "./terrain.ts";

/** Count placed instances across the prop group's InstancedMeshes. */
function instanceCounts(group: THREE.Group): { trees: number; rocks: number } {
  let trees = 0;
  let rocks = 0;
  group.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) {
      // Trees use two meshes (trunk + foliage) sharing a count; rocks one.
      if (o.geometry instanceof THREE.DodecahedronGeometry) rocks = o.count;
      else trees = Math.max(trees, o.count);
    }
  });
  return { trees, rocks };
}

describe("buildProps density scaling (#47/#48)", () => {
  const terrain = buildTerrain();

  it("places the full set at density 1 (default)", () => {
    const full = buildProps(terrain);
    const { trees, rocks } = instanceCounts(full.group);
    // Placement skips bad ground, so the realised count is ≤ the budget; it must
    // not exceed it, and the world should be well-populated.
    expect(trees).toBeLessThanOrEqual(TREE_COUNT);
    expect(rocks).toBeLessThanOrEqual(ROCK_COUNT);
    expect(trees).toBeGreaterThan(TREE_COUNT * 0.5);
    full.dispose();
  });

  it("thins the props on the low tier (~40% density)", () => {
    const full = buildProps(terrain, 1);
    const low = buildProps(terrain, 0.4);
    const f = instanceCounts(full.group);
    const l = instanceCounts(low.group);
    // Fewer trees and rocks than full — the low tier carries materially less
    // geometry, which is how it keeps the mobile triangle budget.
    expect(l.trees).toBeLessThan(f.trees);
    expect(l.trees).toBeLessThanOrEqual(Math.round(TREE_COUNT * 0.4));
    expect(l.rocks).toBeLessThanOrEqual(Math.round(ROCK_COUNT * 0.4));
    full.dispose();
    low.dispose();
  });

  it("never allocates zero instances even at density 0", () => {
    // A degenerate density must still build valid (non-empty) instanced buffers.
    const min = buildProps(terrain, 0);
    const { trees, rocks } = instanceCounts(min.group);
    expect(trees).toBeGreaterThanOrEqual(1);
    expect(rocks).toBeGreaterThanOrEqual(1);
    min.dispose();
  });
});
