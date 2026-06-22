import * as THREE from "three";
import type { Engine } from "../engine/Engine.ts";
import type { World } from "../world/buildWorld.ts";
import type { Movement } from "../movement/buildMovement.ts";
import type { GameSession } from "../gameSession.ts";
import { buildDiscoverablePois, type DiscoverablePoi } from "../content/discoverablePois.ts";
import { DiscoverySystem } from "./DiscoverySystem.ts";
import { createDiscoveryStore, type DiscoveryStore } from "./discoveryStore.ts";
import { createPersistence, type DiscoveryPersistence } from "./persistence.ts";

export interface Discovery {
  store: DiscoveryStore;
  /** The resolved landmarks, reused by the nav-hint projector (#44). */
  pois: DiscoverablePoi[];
  /** Wipe all progress (#41 "Reset progress" in the settings menu). */
  reset(): void;
}

/**
 * Wire discovery into the engine: resolve each landmark's world position from
 * `world.landmarks`, join it to content, and register the `DiscoverySystem`
 * (after the vehicle/camera, so it reads fresh positions). Returns the store the
 * React reveal UI subscribes to.
 */
export function buildDiscovery(
  engine: Engine,
  world: World,
  movement: Movement,
  session: GameSession,
  persist: DiscoveryPersistence = createPersistence(),
): Discovery {
  const posById = new Map(world.landmarks.placed.map((p) => [p.poiId, p.position]));
  const pois = buildDiscoverablePois((id) => posById.get(id) ?? new THREE.Vector3());

  const store = createDiscoveryStore(pois.length);
  const system = new DiscoverySystem(
    movement.input,
    movement.vehicle,
    pois,
    store,
    persist,
    session,
  );
  engine.addSystem(system);

  return { store, pois, reset: () => system.reset() };
}
