import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  AMBIENT_CENTERS,
  AMBIENT_LEAF_COUNT,
  AMBIENT_MOTE_COUNT,
  AMBIENT_WRAP_PERIOD,
  LEAF_COLOR_A,
  LEAF_COLOR_B,
  LEAF_FALL_BOTTOM,
  LEAF_FALL_TOP,
  MOTE_COLOR,
  MOTE_HEIGHT_MAX,
  MOTE_HEIGHT_MIN,
  buildLeafSeeds,
  buildMoteSeeds,
  leafPosition,
  motePosition,
} from "./ambientMotes.ts";

// Rec. 709 relative-luma weights — the exact same formula
// `landmarks.test.ts`'s bloom-source pin (lines 66-90) uses against the
// compositor's 0.85 bloom-luminance threshold.
function luma(hex: number): number {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

const FLAT_HEIGHT = 4;
const flatHeightAt = () => FLAT_HEIGHT;

describe("buildMoteSeeds — deterministic placement", () => {
  it("returns exactly `count` seeds, byte-identical across calls (seeded, not random)", () => {
    const a = buildMoteSeeds(AMBIENT_MOTE_COUNT, AMBIENT_CENTERS, flatHeightAt);
    const b = buildMoteSeeds(AMBIENT_MOTE_COUNT, AMBIENT_CENTERS, flatHeightAt);
    expect(a).toHaveLength(AMBIENT_MOTE_COUNT);
    expect(a).toEqual(b);
  });

  it("every seed sits within its centre's radius and the mote height band above ground", () => {
    const seeds = buildMoteSeeds(AMBIENT_MOTE_COUNT, AMBIENT_CENTERS, flatHeightAt);
    for (const s of seeds) {
      const withinSomeCenter = AMBIENT_CENTERS.some(
        (c) => Math.hypot(s.baseX - c.x, s.baseZ - c.z) <= c.radius + 1e-6,
      );
      expect(withinSomeCenter).toBe(true);
      expect(s.baseY).toBeGreaterThanOrEqual(FLAT_HEIGHT + MOTE_HEIGHT_MIN - 1e-6);
      expect(s.baseY).toBeLessThanOrEqual(FLAT_HEIGHT + MOTE_HEIGHT_MAX + 1e-6);
    }
  });

  it("samples ground height per mote (a sloped heightAt shifts baseY)", () => {
    const sloped = (x: number, _z: number) => x * 0.1;
    const seeds = buildMoteSeeds(20, AMBIENT_CENTERS, sloped);
    const distinctY = new Set(seeds.map((s) => Math.round(s.baseY * 100)));
    expect(distinctY.size).toBeGreaterThan(1);
  });
});

describe("motePosition — bounded drift/bob", () => {
  it("stays within the seed's drift radius / bob amplitude of its base", () => {
    const [seed] = buildMoteSeeds(1, AMBIENT_CENTERS, flatHeightAt);
    for (let t = 0; t < 50; t += 1.3) {
      const p = motePosition(seed, t);
      expect(Math.hypot(p.x - seed.baseX, p.z - seed.baseZ)).toBeLessThanOrEqual(
        seed.driftRadius + 1e-9,
      );
      expect(Math.abs(p.y - seed.baseY)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it("is exactly periodic across one AMBIENT_WRAP_PERIOD (every sine closes a whole cycle)", () => {
    const [seed] = buildMoteSeeds(1, AMBIENT_CENTERS, flatHeightAt);
    const p0 = motePosition(seed, 123.4);
    const p1 = motePosition(seed, 123.4 + AMBIENT_WRAP_PERIOD);
    expect(p1.x).toBeCloseTo(p0.x, 6);
    expect(p1.y).toBeCloseTo(p0.y, 6);
    expect(p1.z).toBeCloseTo(p0.z, 6);
  });

  it("actually moves over time (not frozen)", () => {
    const [seed] = buildMoteSeeds(1, AMBIENT_CENTERS, flatHeightAt);
    const p0 = motePosition(seed, 0);
    const p1 = motePosition(seed, 3);
    expect(p0).not.toEqual(p1);
  });
});

describe("buildLeafSeeds / leafPosition — falling leaves", () => {
  it("returns exactly `count` seeds, deterministic", () => {
    const a = buildLeafSeeds(AMBIENT_LEAF_COUNT, AMBIENT_CENTERS);
    const b = buildLeafSeeds(AMBIENT_LEAF_COUNT, AMBIENT_CENTERS);
    expect(a).toHaveLength(AMBIENT_LEAF_COUNT);
    expect(a).toEqual(b);
  });

  it("falls between LEAF_FALL_BOTTOM and LEAF_FALL_TOP above the local ground", () => {
    const [seed] = buildLeafSeeds(1, AMBIENT_CENTERS);
    const groundY = 7;
    for (let t = 0; t < 500; t += 11) {
      const p = leafPosition(seed, t, groundY);
      expect(p.y).toBeGreaterThanOrEqual(groundY + LEAF_FALL_BOTTOM - 1e-6);
      expect(p.y).toBeLessThanOrEqual(groundY + LEAF_FALL_TOP + 1e-6);
    }
  });

  it("descends then wraps back to the top rather than falling forever", () => {
    const [seed] = buildLeafSeeds(1, AMBIENT_CENTERS);
    const heights: number[] = [];
    for (let t = 0; t < 60; t += 1) heights.push(leafPosition(seed, t, 0).y);
    // Somewhere in the sampled window it must have both fallen (a decrease)
    // and wrapped back up (an increase) — never monotonically one direction.
    const decreased = heights.some((h, i) => i > 0 && h < heights[i - 1] - 1e-6);
    const wrapped = heights.some((h, i) => i > 0 && h > heights[i - 1] + 1e-6);
    expect(decreased).toBe(true);
    expect(wrapped).toBe(true);
  });

  it("is exactly periodic across one AMBIENT_WRAP_PERIOD", () => {
    const [seed] = buildLeafSeeds(1, AMBIENT_CENTERS);
    const p0 = leafPosition(seed, 50, 2);
    const p1 = leafPosition(seed, 50 + AMBIENT_WRAP_PERIOD, 2);
    expect(p1.x).toBeCloseTo(p0.x, 4);
    expect(p1.y).toBeCloseTo(p0.y, 4);
    expect(p1.z).toBeCloseTo(p0.z, 4);
  });
});

// Reviewer follow-up (visual-overhaul slice 7, polish): MOTE_COLOR/LEAF_COLOR_A
// /LEAF_COLOR_B have no `landmarks.test.ts`-style numeric guard of their own —
// nothing fails if a future palette tweak silently pushed one of these across
// the compositor's 0.85 bloom-luminance threshold. These three are NOT
// bloom sources by design (motes/leaves render `NormalBlending`, never
// additive — see the MOTE_COLOR doc comment above), so this pins the SAME
// invariant `landmarks.test.ts`'s bloom-source test proves from the other
// side: comfortably below 0.85, not just "happens not to cross it".
describe("MOTE_COLOR / LEAF_COLOR_A / LEAF_COLOR_B — pinned below the bloom threshold", () => {
  const SAFETY_MARGIN = 0.05; // must clear the threshold by at least this much

  it("MOTE_COLOR's luma sits safely below the compositor's 0.85 bloom threshold", () => {
    expect(luma(MOTE_COLOR)).toBeLessThan(0.85 - SAFETY_MARGIN);
  });

  it("LEAF_COLOR_A's luma sits safely below the compositor's 0.85 bloom threshold", () => {
    expect(luma(LEAF_COLOR_A)).toBeLessThan(0.85 - SAFETY_MARGIN);
  });

  it("LEAF_COLOR_B's luma sits safely below the compositor's 0.85 bloom threshold", () => {
    expect(luma(LEAF_COLOR_B)).toBeLessThan(0.85 - SAFETY_MARGIN);
  });
});
