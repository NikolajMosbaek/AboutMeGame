// Aggregate wildlife budget (pivot slice F, #184): all four systems together
// stay within the slice's own draw-call/triangle ceiling — a fraction of the
// whole-game budget in docs/perf-budget.md (≤150 draw calls, ≤500k triangles).

import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Engine } from "../engine/Engine.ts";
import type { RendererLike } from "../engine/types.ts";
import { buildWorld } from "../world/buildWorld.ts";
import { QUALITY_TIERS } from "../perf/quality.ts";
import { buildWildlife } from "./buildWildlife.ts";
import { createSession } from "../gameSession.ts";

function stubRenderer(): RendererLike {
  return {
    render: vi.fn(),
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    dispose: vi.fn(),
    info: { render: { calls: 0, triangles: 0 } },
  };
}

/** Triangle count of one InstancedMesh instance × its live `.count`. */
function triangles(mesh: THREE.InstancedMesh): number {
  const geo = mesh.geometry;
  const perInstance = geo.index ? geo.index.count / 3 : geo.getAttribute("position").count / 3;
  return perInstance * mesh.count;
}

describe("wildlife draw-call and triangle budget", () => {
  it("stays within ≤7 draw calls and ≤40k triangles across birds/fliers/fish/snakes", () => {
    const engine = new Engine({ renderer: stubRenderer() });
    const world = buildWorld(engine, QUALITY_TIERS.high);
    const session = createSession();
    const player = { state: { position: new THREE.Vector3(0, 0, 0) } };

    buildWildlife(engine, world, player, session, () => {});

    // Populate every flier instance to its cap so the triangle count reflects
    // the worst case, not whatever the construction-time day phase happened to be.
    engine.advanceTime(0);

    const meshes: THREE.InstancedMesh[] = [];
    engine.scene.traverse((o) => {
      if (o.name.startsWith("wildlife-") && o instanceof THREE.InstancedMesh) meshes.push(o);
    });

    expect(meshes.length).toBeLessThanOrEqual(7);

    let totalTris = 0;
    for (const m of meshes) totalTris += triangles(m);
    expect(totalTris).toBeLessThanOrEqual(40000);

    world.dispose();
    engine.dispose();
  });
});
