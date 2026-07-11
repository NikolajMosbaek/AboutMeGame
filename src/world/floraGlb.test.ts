import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { parseFloraGlb } from "./floraGlb.ts";

// `parseFloraGlb` is a minimal, purpose-built GLB parser replacing three's
// `GLTFLoader` for the flora payload (see `floraGlb.ts`'s own header doc for
// the measured byte-budget finding that motivated it). Verified here against
// the REAL processed output `scripts/process-models.mjs` ships (not a hand-
// fabricated fixture), so a future pipeline change that breaks this parser's
// assumptions (interleaving, quantization, node transform) fails a test
// instead of silently mis-rendering.

const FLORA_DIR = join(process.cwd(), "public/assets/models/flora");

function readGlbBuffer(name: string): ArrayBuffer {
  const bytes = readFileSync(join(FLORA_DIR, `${name}.glb`));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe("parseFloraGlb — real processed model fixtures", () => {
  const MODEL_HEIGHTS: [string, number][] = [
    ["canopy-a", 9.8],
    ["canopy-b", 9.8],
    ["palm-a", 6.5],
    ["understory-a", 1.2],
    ["understory-b", 1.2],
    ["rock-a", 1.6],
    ["rock-b", 1.6],
  ];

  it.each(MODEL_HEIGHTS)("parses %s into a geometry grounded at y=0, ~%d units tall", (name, targetHeight) => {
    const geometry = parseFloraGlb(readGlbBuffer(name));
    expect(geometry.getAttribute("position")).toBeDefined();
    expect(geometry.getAttribute("normal")).toBeDefined();
    expect(geometry.getAttribute("color")).toBeDefined();
    expect(geometry.getIndex()).not.toBeNull();

    geometry.computeBoundingBox();
    const bbox = geometry.boundingBox!;
    // Grounded: the base sits at (or very near) y=0 — quantization rounding
    // allows a small tolerance, never a large drift.
    expect(Math.abs(bbox.min.y)).toBeLessThan(0.1);
    // Rescaled to the process script's target height, within quantization
    // rounding tolerance (int16 over the model's own bounding box).
    expect(bbox.max.y).toBeGreaterThan(targetHeight * 0.95);
    expect(bbox.max.y).toBeLessThan(targetHeight * 1.05);
  });

  it("decodes vertex colours into a plausible [0,1] RGB range (never raw quantized ints)", () => {
    const geometry = parseFloraGlb(readGlbBuffer("canopy-a"));
    const color = geometry.getAttribute("color");
    expect(color.normalized).toBe(true);
    for (let i = 0; i < color.count; i++) {
      for (let c = 0; c < 3; c++) {
        const v = color.getComponent(i, c);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("produces a geometry three can build an InstancedMesh from without throwing", () => {
    const geometry = parseFloraGlb(readGlbBuffer("rock-a"));
    const material = new THREE.MeshStandardMaterial({ vertexColors: true });
    expect(() => new THREE.InstancedMesh(geometry, material, 5)).not.toThrow();
  });

  it("throws a clear error on a non-GLB buffer rather than silently misparsing", () => {
    const bogus = new TextEncoder().encode("not a glb file at all").buffer;
    expect(() => parseFloraGlb(bogus)).toThrow(/bad magic/i);
  });
});
