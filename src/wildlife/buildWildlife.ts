// Compose the wildlife slice (pivot slice F, #184) into the engine: birds,
// butterflies/fireflies, fish, snakes and the jaguar (owner note 2026-07-10)
// — mirrors the `buildWorld`/`buildPlayer`/`buildDiscovery` composer idiom.
// Registered from `buildGame` AFTER the survival system, so snake strikes and
// the jaguar's pounce can call the same `hurt()` seam starvation death uses.

import * as THREE from "three";
import type { Engine } from "../engine/Engine.ts";
import type { World } from "../world/buildWorld.ts";
import { BirdsSystem } from "./birds.ts";
import { FliersSystem } from "./fliers.ts";
import { FishSystem } from "./fish.ts";
import { SnakesSystem, type HurtFn } from "./snakes.ts";
import { JaguarSystem } from "./jaguar.ts";

/** Where the player is — the explorer satisfies it via `state.position` (same
 *  shape every wildlife system reads). */
export interface PositionSource {
  readonly state: { position: THREE.Vector3 };
}

/** Hold all movement while true — the shared session pause flag satisfies it. */
export interface PauseSource {
  readonly paused: boolean;
}

export interface Wildlife {
  birds: BirdsSystem;
  fliers: FliersSystem;
  fish: FishSystem;
  snakes: SnakesSystem;
  jaguar: JaguarSystem;
}

/**
 * Build and register the five wildlife systems. `hurt` is a plain callback
 * (not the SurvivalSystem itself), so this module — and the snakes/jaguar it
 * wires — never depends on survival's shape, just on "can deal damage."
 */
export function buildWildlife(
  engine: Engine,
  world: World,
  player: PositionSource,
  session: PauseSource,
  hurt: HurtFn,
): Wildlife {
  const birds = new BirdsSystem(engine.scene, world.terrain, player, session);
  const fliers = new FliersSystem(engine.scene, world.terrain, world.dayCycle, session);
  const fish = new FishSystem(engine.scene, world.waterDepthAt, player, session);
  const snakes = new SnakesSystem(engine.scene, world.terrain, player, session, hurt);
  const jaguar = new JaguarSystem(
    engine.scene,
    world.terrain,
    world.waterDepthAt,
    world.dayCycle,
    player,
    session,
    hurt,
  );

  engine.addSystem(birds);
  engine.addSystem(fliers);
  engine.addSystem(fish);
  engine.addSystem(snakes);
  engine.addSystem(jaguar);

  return { birds, fliers, fish, snakes, jaguar };
}
