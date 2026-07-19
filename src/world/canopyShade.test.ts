import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { SHADE_MAX, applyCanopyShade, coverageGrid } from "./canopyShade.ts";
import { buildProps } from "./props.ts";
import { buildTerrain } from "./terrain.ts";

function flatColoredPlane(size = 40, segments = 20): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const n = geo.attributes.position.count;
  const colors = new Float32Array(n * 3).fill(1);
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

describe("coverageGrid", () => {
  it("is full under a crown centre, fades toward the rim, zero beyond", () => {
    const grid = coverageGrid([{ x: 0, z: 0, r: 3 }]);
    expect(grid.get(0, 0)).toBeGreaterThan(0.8);
    expect(grid.get(2.4, 0)).toBeGreaterThan(0);
    expect(grid.get(2.4, 0)).toBeLessThan(grid.get(0, 0));
    expect(grid.get(8, 0)).toBe(0);
  });

  it("overlapping crowns saturate at 1 — a grove is dark, never over-dark", () => {
    const crowns = [
      { x: 0, z: 0, r: 3 },
      { x: 1, z: 0, r: 3 },
      { x: 0, z: 1, r: 3 },
      { x: 1, z: 1, r: 3 },
    ];
    const grid = coverageGrid(crowns);
    expect(grid.get(0.5, 0.5)).toBeLessThanOrEqual(1);
    expect(grid.get(0.5, 0.5)).toBeGreaterThan(0.9);
  });
});

describe("applyCanopyShade", () => {
  it("darkens ground under crowns, leaves open ground untouched, never exceeds SHADE_MAX", () => {
    const geo = flatColoredPlane();
    applyCanopyShade(geo, [{ x: 0, z: 0, r: 4 }]);
    const pos = geo.attributes.position;
    const col = geo.attributes.color;
    let shadedMin = 1;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const g = col.getY(i);
      const d = Math.hypot(x, z);
      if (d < 1) shadedMin = Math.min(shadedMin, g);
      if (d > 8) expect(g).toBe(1); // open ground untouched
      expect(g).toBeGreaterThanOrEqual(1 - SHADE_MAX - 1e-6);
    }
    expect(shadedMin).toBeLessThan(1 - SHADE_MAX * 0.5); // real darkening under the crown
  });

  it("shades green-biased: red drops at least as much as green (jungle shade, not soot)", () => {
    const geo = flatColoredPlane();
    applyCanopyShade(geo, [{ x: 0, z: 0, r: 4 }]);
    const pos = geo.attributes.position;
    const col = geo.attributes.color;
    for (let i = 0; i < pos.count; i++) {
      if (Math.hypot(pos.getX(i), pos.getZ(i)) < 1) {
        expect(col.getX(i)).toBeLessThanOrEqual(col.getY(i) + 1e-6);
      }
    }
  });

  it("flags the color attribute for re-upload (version bump)", () => {
    const geo = flatColoredPlane();
    const col = geo.attributes.color as THREE.BufferAttribute;
    const before = col.version;
    applyCanopyShade(geo, [{ x: 0, z: 0, r: 4 }]);
    expect(col.version).toBeGreaterThan(before);
  });
});

describe("props canopyCrowns", () => {
  it("exposes one crown per placed canopy tree, radii scaled to the instance", () => {
    const terrain = buildTerrain();
    const props = buildProps(terrain);
    let trunks = 0;
    props.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh && o.name === "canopy-trunk") trunks = o.count;
    });
    expect(props.canopyCrowns.length).toBe(trunks);
    for (const c of props.canopyCrowns) {
      expect(c.r).toBeGreaterThan(0.8);
      expect(c.r).toBeLessThan(6);
      expect(Number.isFinite(c.x + c.z)).toBe(true);
    }
    props.dispose();
  });
});
