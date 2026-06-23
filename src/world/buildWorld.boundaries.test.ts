import { afterEach, describe, expect, it, vi } from "vitest";
import { Engine } from "../engine/Engine.ts";
import type { RendererLike } from "../engine/types.ts";

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

  it("calls buildBoundaries with terrain.heightAt (arity 1, the same fn)", () => {
    const engine = new Engine({ renderer: stubRenderer() });
    const world = buildWorld(engine);

    expect(buildBoundaries).toHaveBeenCalledTimes(1);
    const [arg, ...rest] = buildBoundaries.mock.calls[0];
    // Arity 1: nothing else is threaded into the boundaries seam.
    expect(rest).toHaveLength(0);
    expect(typeof arg).toBe("function");
    // The exact function the terrain exposes, not a copy — so the baked
    // ground-height texture reads the real coastline.
    expect(arg).toBe(world.terrain.heightAt);

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
