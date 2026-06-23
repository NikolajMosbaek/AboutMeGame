import { afterEach, describe, expect, it, vi } from "vitest";
import { Engine } from "../engine/Engine.ts";
import type { RendererLike } from "../engine/types.ts";
import { QUALITY_TIERS } from "../perf/quality.ts";

// Wrap the real buildBoundaries in a spy so we can assert HOW buildWorld calls
// it (G1 slice 2, #116, T8) while keeping the genuine water/bounds behaviour —
// the foam DI seam is only useful if buildWorld actually feeds terrain.heightAt
// into it. importActual keeps every other export real.
const { buildBoundaries } = vi.hoisted(() => ({
  buildBoundaries: vi.fn(),
}));

vi.mock("./boundaries.ts", async (importActual) => {
  const actual = await importActual<typeof import("./boundaries.ts")>();
  buildBoundaries.mockImplementation(actual.buildBoundaries);
  return { ...actual, buildBoundaries };
});

const { buildWorld } = await import("./buildWorld.ts");

// jsdom has no WebGL — a bare renderer stub is all buildWorld needs.
function stubRenderer(): RendererLike {
  return {
    render: vi.fn(),
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    dispose: vi.fn(),
    info: { render: { calls: 0, triangles: 0 } },
  };
}

describe("buildWorld → boundaries heightAt seam (#116, T8)", () => {
  afterEach(() => buildBoundaries.mockClear());

  it("calls buildBoundaries with (terrain.heightAt, quality.waterDisplacement)", () => {
    const engine = new Engine({ renderer: stubRenderer() });
    const world = buildWorld(engine);

    expect(buildBoundaries).toHaveBeenCalledTimes(1);
    const [heightArg, dispArg, ...rest] = buildBoundaries.mock.calls[0];
    // G1 slice 3: the boundaries seam is threaded with TWO positional args —
    // the heightAt fn and the resolved waterDisplacement flag (kept a plain
    // function arg, not folded into an options object).
    expect(rest).toHaveLength(0);
    expect(typeof heightArg).toBe("function");
    // The exact function the terrain exposes, not a copy — so the baked
    // ground-height texture reads the real coastline.
    expect(heightArg).toBe(world.terrain.heightAt);
    // The default quality is high, which animates the water.
    expect(dispArg).toBe(true);

    world.dispose();
    engine.dispose();
  });

  it("registers NO WaterSystem on low (waterDisplacement false)", () => {
    // Low protects mobile fill rate: no subdivided grid, no swell clock. With
    // displacement off, `buildBoundaries` exposes no `waterUniforms`, so
    // buildWorld must NOT install the per-frame WaterSystem at all.
    const engine = new Engine({ renderer: stubRenderer() });
    expect(QUALITY_TIERS.low.waterDisplacement).toBe(false);
    const world = buildWorld(engine, QUALITY_TIERS.low);

    expect(engine.getSystem("water")).toBeUndefined();
    expect(world.boundaries.waterUniforms).toBeUndefined();

    world.dispose();
    engine.dispose();
  });

  it("registers a WaterSystem on medium/high (waterDisplacement true)", () => {
    // Medium/high compile the vertex swell and expose the live `uTime` uniform,
    // so buildWorld installs exactly one WaterSystem to advance it.
    const engine = new Engine({ renderer: stubRenderer() });
    expect(QUALITY_TIERS.high.waterDisplacement).toBe(true);
    const world = buildWorld(engine, QUALITY_TIERS.high);

    expect(engine.getSystem("water")).toBeDefined();
    expect(world.boundaries.waterUniforms).toBeDefined();

    world.dispose();
    engine.dispose();
  });

  it("disposes the world cleanly after wiring the seam", () => {
    const engine = new Engine({ renderer: stubRenderer() });
    const world = buildWorld(engine);
    // The boundaries group (with the patched water plane) is in the scene.
    expect(engine.scene.getObjectByName("boundaries")).toBeDefined();
    expect(() => {
      world.dispose();
      engine.dispose();
    }).not.toThrow();
  });
});
