import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  FALLS_FACING,
  FALLS_POS,
  FALL_TOP,
  ROAR_RADIUS,
  WaterfallSystem,
  buildWaterfall,
  roarLevelAt,
} from "./waterfall.ts";
import { buildTerrain } from "./terrain.ts";
import { WORLD } from "./worldConfig.ts";
import { projectOntoRiver } from "./waterZones.ts";

const FRAME = (dt = 0.1) => ({
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(),
  dt,
  elapsed: 0,
});

describe("the falls placement (pinned against the REAL terrain)", () => {
  it("stands at the river's gorge head: on the course, with a rock wall tall enough behind it", () => {
    const terrain = buildTerrain();
    // On (or within a bed-width of) the river course, near the source.
    expect(projectOntoRiver(FALLS_POS.x, FALLS_POS.z).dist).toBeLessThan(6);
    // The pool at its feet is water (bed below sea level).
    expect(terrain.heightAt(FALLS_POS.x, FALLS_POS.z)).toBeLessThan(WORLD.seaLevel);
    // The wall it pours over rises above the lip just behind the curtain.
    const bx = FALLS_POS.x + FALLS_FACING.x * -6;
    const bz = FALLS_POS.z + FALLS_FACING.z * -6;
    expect(terrain.heightAt(bx, bz)).toBeGreaterThan(FALL_TOP * 0.8);
  });
});

describe("buildWaterfall", () => {
  it("builds a compact, frustum-cullable group: curtain + crest + splash + mist, few draws", () => {
    const falls = buildWaterfall();
    let meshes = 0;
    falls.group.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes++;
    });
    expect(meshes).toBeGreaterThanOrEqual(3);
    expect(meshes).toBeLessThanOrEqual(6); // the draw budget is the thin one
    // Positioned at the falls, so its child bounds stay chunk-local (the
    // group is frustum-culled as a whole scene subtree).
    expect(falls.group.position.x).toBeCloseTo(FALLS_POS.x, 5);
    expect(falls.group.position.z).toBeCloseTo(FALLS_POS.z, 5);
    falls.dispose();
  });

  it("keeps every translucent surface depthWrite:false (no transparency sorting artifacts)", () => {
    const falls = buildWaterfall();
    falls.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const m = o.material as THREE.MeshStandardMaterial;
        if (m.transparent) expect(m.depthWrite).toBe(false);
      }
    });
    falls.dispose();
  });

  it("disposes cleanly (geometries, materials, generated textures)", () => {
    const falls = buildWaterfall();
    expect(() => falls.dispose()).not.toThrow();
  });
});

describe("WaterfallSystem", () => {
  it("scrolls the curtain downward each frame, wrapping within [0,1)", () => {
    const falls = buildWaterfall();
    const sys = new WaterfallSystem(falls, { paused: false });
    const before = falls.curtainTexture.offset.y;
    for (let t = 0; t < 3; t += 0.1) sys.update(FRAME());
    expect(falls.curtainTexture.offset.y).not.toBe(before);
    expect(falls.curtainTexture.offset.y).toBeGreaterThanOrEqual(0);
    expect(falls.curtainTexture.offset.y).toBeLessThan(1);
    falls.dispose();
  });

  it("holds while paused and under reduced motion", () => {
    const falls = buildWaterfall();
    const session = { paused: true };
    const sys = new WaterfallSystem(falls, session);
    const before = falls.curtainTexture.offset.y;
    sys.update(FRAME());
    expect(falls.curtainTexture.offset.y).toBe(before);

    session.paused = false;
    const reduced = new WaterfallSystem(falls, session, {
      getSnapshot: () => ({ reducedMotion: true }),
    });
    reduced.update(FRAME());
    expect(falls.curtainTexture.offset.y).toBe(before);
    falls.dispose();
  });
});

describe("roarLevelAt (pure)", () => {
  it("is loud at the falls, silent beyond the radius, monotonic in between", () => {
    expect(roarLevelAt(FALLS_POS.x, FALLS_POS.z)).toBeGreaterThan(0.9);
    const mid = roarLevelAt(FALLS_POS.x + ROAR_RADIUS * 0.5, FALLS_POS.z);
    const near = roarLevelAt(FALLS_POS.x + ROAR_RADIUS * 0.2, FALLS_POS.z);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(0);
    expect(roarLevelAt(FALLS_POS.x + ROAR_RADIUS + 5, FALLS_POS.z)).toBe(0);
  });
});
