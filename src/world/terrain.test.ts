import { describe, expect, it } from "vitest";
import { buildTerrain, distToRiver } from "./terrain.ts";
import { WORLD, RIVER, LAGOON, SPAWN, POI_ANCHORS } from "./worldConfig.ts";

// buildTerrain only does geometry/maths — no renderer — so it runs under jsdom.
describe("terrain heightAt (jungle river valley)", () => {
  const { heightAt, dispose } = buildTerrain();

  it("keeps the camp clearing gentle and above water", () => {
    const h = heightAt(SPAWN.x, SPAWN.z);
    expect(h).toBeGreaterThan(WORLD.seaLevel);
    expect(h).toBeLessThan(WORLD.landBase + 3); // nearly flat pad
  });

  it("keeps every site anchor on dry land", () => {
    for (const a of POI_ANCHORS) {
      expect(heightAt(a.x, a.z), `${a.poiId} underwater`).toBeGreaterThan(
        WORLD.seaLevel + 0.2,
      );
    }
  });

  it("carves the river bed below wading depth along the whole course", () => {
    // Sample the middle of each river segment: the bed must be a real
    // obstacle (deeper than the explorer's maxWadeDepth of 1.2).
    const pts = RIVER.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const mz = (pts[i].z + pts[i + 1].z) / 2;
      expect(heightAt(mx, mz), `river segment ${i} too shallow`).toBeLessThan(
        WORLD.seaLevel - 1.3,
      );
    }
  });

  it("blends the river banks back to dry jungle floor past bankHalfWidth", () => {
    // Take a mid-course point and step perpendicular-ish away from the river:
    // beyond the bank blend the ground must be dry again.
    const p = RIVER.points[3];
    let found = false;
    for (const dx of [RIVER.bankHalfWidth + 6, -(RIVER.bankHalfWidth + 6)]) {
      const x = p.x + dx;
      if (distToRiver(x, p.z) > RIVER.bankHalfWidth + 2) {
        expect(heightAt(x, p.z)).toBeGreaterThan(WORLD.seaLevel);
        found = true;
      }
    }
    expect(found).toBe(true); // at least one side was genuinely off-river
  });

  it("sinks the lagoon basin below sea level", () => {
    expect(heightAt(LAGOON.x, LAGOON.z)).toBeLessThan(WORLD.seaLevel - 2);
  });

  it("raises the northern highland above the southern floor", () => {
    // Average a few samples per region — noise makes single points unreliable.
    const north = avg([[30, -120], [-20, -130], [60, -110]]);
    const south = avg([[30, 60], [-60, 40], [60, 40]]);
    expect(north).toBeGreaterThan(south + 5);
    function avg(pts: ReadonlyArray<readonly [number, number]>): number {
      return pts.reduce((s, [x, z]) => s + heightAt(x, z), 0) / pts.length;
    }
  });

  it("keeps the interior above sea level away from the carved water", () => {
    for (const [x, z] of [
      [60, 0],
      [-120, 40],
      [-60, -140],
      [100, 100],
    ] as const) {
      if (distToRiver(x, z) > RIVER.bankHalfWidth + 2) {
        expect(heightAt(x, z), `(${x},${z}) underwater`).toBeGreaterThan(WORLD.seaLevel);
      }
    }
  });

  it("drops below sea level out past the island radius (open water)", () => {
    const far = WORLD.islandRadius + 20;
    expect(heightAt(far, 0)).toBeLessThan(WORLD.seaLevel);
    expect(heightAt(0, -far)).toBeLessThan(WORLD.seaLevel);
  });

  it("is deterministic for the fixed seed", () => {
    const a = buildTerrain();
    expect(a.heightAt(33, -77)).toBe(heightAt(33, -77));
    a.dispose();
  });

  it("never exceeds the configured peak height (relief + highland)", () => {
    let max = -Infinity;
    for (let x = -160; x <= 160; x += 8) {
      for (let z = -160; z <= 160; z += 8) max = Math.max(max, heightAt(x, z));
    }
    expect(max).toBeLessThanOrEqual(
      WORLD.landBase + WORLD.maxHeight + WORLD.highlandBoost + 1,
    );
    dispose();
  });
});

describe("distToRiver", () => {
  it("is zero on a river vertex and grows off-course", () => {
    const p = RIVER.points[2];
    expect(distToRiver(p.x, p.z)).toBe(0);
    expect(distToRiver(p.x + 50, p.z)).toBeGreaterThan(20);
  });
});
