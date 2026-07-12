import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { hash2, mergeOrThrow, mottleFaces, stampVertexColor } from "./geometry.ts";

describe("mottleFaces", () => {
  it("leaves a face at weight() = 0 as the base colour", () => {
    const geo = stampVertexColor(new THREE.BoxGeometry(1, 1, 1), 0x112233);
    const base = new THREE.Color(0x112233);
    const accent = new THREE.Color(0xff0000);
    mottleFaces(geo, base, accent, () => 0);
    const color = geo.getAttribute("color");
    expect(color.getX(0)).toBeCloseTo(base.r, 5);
    expect(color.getY(0)).toBeCloseTo(base.g, 5);
    expect(color.getZ(0)).toBeCloseTo(base.b, 5);
  });

  it("recolours a face at weight() = 1 fully to the accent colour", () => {
    const geo = stampVertexColor(new THREE.BoxGeometry(1, 1, 1), 0x112233);
    const base = new THREE.Color(0x112233);
    const accent = new THREE.Color(0xff8800);
    mottleFaces(geo, base, accent, () => 1);
    const color = geo.getAttribute("color");
    for (let i = 0; i < color.count; i++) {
      expect(color.getX(i)).toBeCloseTo(accent.r, 5);
      expect(color.getY(i)).toBeCloseTo(accent.g, 5);
      expect(color.getZ(i)).toBeCloseTo(accent.b, 5);
    }
  });

  it("clamps a weight function outside [0,1] rather than extrapolating", () => {
    const geo = stampVertexColor(new THREE.BoxGeometry(1, 1, 1), 0x112233);
    const base = new THREE.Color(0x112233);
    const accent = new THREE.Color(0xff8800);
    mottleFaces(geo, base, accent, () => 5);
    const color = geo.getAttribute("color");
    expect(color.getX(0)).toBeCloseTo(accent.r, 5);
  });

  it("only rewrites colour, never position — geometry stays vertex-for-vertex identical", () => {
    const geo = stampVertexColor(new THREE.BoxGeometry(1, 1, 1), 0x112233);
    const before = Array.from(geo.getAttribute("position").array);
    mottleFaces(geo, new THREE.Color(0x112233), new THREE.Color(0xff8800), (cx) => (cx > 0 ? 1 : 0));
    const after = Array.from(geo.getAttribute("position").array);
    expect(after).toEqual(before);
  });

  it("varies per face when weight depends on face centre, not uniformly", () => {
    const geo = stampVertexColor(new THREE.BoxGeometry(1, 1, 1), 0x112233);
    mottleFaces(geo, new THREE.Color(0x112233), new THREE.Color(0xffffff), (cx) => (cx > 0 ? 1 : 0));
    const color = geo.getAttribute("color");
    const first = color.getX(0);
    let sawDifferent = false;
    for (let i = 3; i < color.count; i += 3) {
      if (Math.abs(color.getX(i) - first) > 1e-4) sawDifferent = true;
    }
    expect(sawDifferent).toBe(true);
  });
});

describe("hash2", () => {
  it("is deterministic for the same inputs", () => {
    expect(hash2(1.5, -2.25)).toBe(hash2(1.5, -2.25));
  });

  it("stays within [0, 1)", () => {
    for (let i = 0; i < 50; i++) {
      const h = hash2(i * 0.37, i * -1.9);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });

  it("varies across inputs (not a constant)", () => {
    const values = new Set<number>();
    for (let i = 0; i < 20; i++) values.add(hash2(i, i * 2.7));
    expect(values.size).toBeGreaterThan(1);
  });
});

describe("mergeOrThrow", () => {
  it("merges non-empty sources without throwing", () => {
    const a = stampVertexColor(new THREE.BoxGeometry(1, 1, 1), 0xff0000);
    const b = stampVertexColor(new THREE.BoxGeometry(1, 1, 1), 0x00ff00);
    expect(() => mergeOrThrow([a, b])).not.toThrow();
  });
});
