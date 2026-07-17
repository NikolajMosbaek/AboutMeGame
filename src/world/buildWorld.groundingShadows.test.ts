import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Engine } from "../engine/Engine.ts";
import type { RendererLike } from "../engine/types.ts";
import { QUALITY_TIERS } from "../perf/quality.ts";
import { buildWorld } from "./buildWorld.ts";

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

function groundingMesh(scene: THREE.Scene): THREE.InstancedMesh | undefined {
  let found: THREE.InstancedMesh | undefined;
  scene.traverse((o) => {
    if (o instanceof THREE.InstancedMesh && o.name === "grounding-shadows") found = o;
  });
  return found;
}

describe("buildWorld grounding shadows (G5 #160)", () => {
  it("grounds the shadow-less low tier: one instanced disc mesh under the solid props", () => {
    const engine = new Engine({ renderer: stubRenderer() });
    const world = buildWorld(engine, QUALITY_TIERS.low);

    const mesh = groundingMesh(engine.scene);
    expect(mesh).toBeDefined();
    // Trees + palms + rocks at low density, plus the 6 landmark sites —
    // dozens of discs, exactly one draw call.
    expect(mesh!.count).toBeGreaterThan(50);

    world.dispose();
    engine.dispose();
  });

  it("adds nothing on tiers whose real shadow pass already grounds objects", () => {
    const engine = new Engine({ renderer: stubRenderer() });
    const world = buildWorld(engine, QUALITY_TIERS.high);

    expect(groundingMesh(engine.scene)).toBeUndefined();

    world.dispose();
    engine.dispose();
  });
});
