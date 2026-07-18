// Aggregate wildlife budget (pivot slice F, #184; jaguar added by the
// 2026-07-10 owner note): all five systems together stay within the slice's
// own draw-call/triangle ceiling — a fraction of the whole-game budget in
// docs/perf-budget.md (≤150 draw calls, ≤500k triangles).

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

/** Triangles per draw: instance triangles × live `.count` for an
 *  InstancedMesh, plain geometry triangles for a Mesh (the jaguar). */
function triangles(mesh: THREE.Mesh): number {
  const geo = mesh.geometry;
  const per = geo.index ? geo.index.count / 3 : geo.getAttribute("position").count / 3;
  return mesh instanceof THREE.InstancedMesh ? per * mesh.count : per;
}

describe("wildlife draw-call and triangle budget", () => {
  it("stays within ≤11 draw calls and ≤40k triangles across birds/fliers/fish/snakes/jaguar/monkeys", () => {
    const engine = new Engine({ renderer: stubRenderer() });
    const world = buildWorld(engine, QUALITY_TIERS.high);
    const session = createSession();
    const player = { state: { position: new THREE.Vector3(0, 0, 0), speed: 0 } };

    buildWildlife(engine, world, player, session, () => {});

    // Populate every flier instance to its cap so the triangle count reflects
    // the worst case, not whatever the construction-time day phase happened to be.
    engine.advanceTime(0);

    const meshes: THREE.Mesh[] = [];
    engine.scene.traverse((o) => {
      if (o.name.startsWith("wildlife-") && o instanceof THREE.Mesh) meshes.push(o);
    });

    // 2 bird + 2 flier + 1 fish + 2 snake instanced draws, + 2 jaguar,
    // + 2 monkey (body + shared carried/dropped fruit — J1 #220) meshes.
    expect(meshes.length).toBeLessThanOrEqual(11);

    let totalTris = 0;
    for (const m of meshes) totalTris += triangles(m);
    expect(totalTris).toBeLessThanOrEqual(40000);

    world.dispose();
    engine.dispose();
  });
});
