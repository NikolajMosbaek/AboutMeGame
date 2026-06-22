import { describe, expect, it } from "vitest";
import { buildTerrain } from "./terrain.ts";
import { WORLD } from "./worldConfig.ts";

// buildTerrain only does geometry/maths — no renderer — so it runs under jsdom.
describe("terrain heightAt", () => {
  const { heightAt, dispose } = buildTerrain();

  it("keeps the spawn plaza gentle and above water", () => {
    const h = heightAt(0, 0);
    expect(h).toBeGreaterThan(WORLD.seaLevel);
    expect(h).toBeLessThan(WORLD.landBase + 3); // nearly flat pad
  });

  it("keeps the whole plateau interior above sea level", () => {
    for (const [x, z] of [
      [50, 0],
      [-120, 40],
      [0, -150],
      [100, 100],
    ]) {
      expect(heightAt(x, z), `(${x},${z}) underwater`).toBeGreaterThan(
        WORLD.seaLevel,
      );
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

  it("never exceeds the configured peak height", () => {
    let max = -Infinity;
    for (let x = -160; x <= 160; x += 8) {
      for (let z = -160; z <= 160; z += 8) max = Math.max(max, heightAt(x, z));
    }
    expect(max).toBeLessThanOrEqual(WORLD.landBase + WORLD.maxHeight + 1);
    dispose();
  });
});
