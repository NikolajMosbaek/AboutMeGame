import type { Engine } from "./engine/Engine.ts";
import { buildWorld, type World } from "./world/buildWorld.ts";
import { buildMovement, type Movement } from "./movement/buildMovement.ts";

export interface Game {
  world: World;
  movement: Movement;
}

/**
 * Compose the whole playable game into an engine: the world (Epic 2) plus the
 * vehicle, input and camera (Epic 3). This is the default `GameCanvas` builder.
 * `overlay` is the canvas container the touch controls mount into. Discovery
 * (Epic 4) and the HUD (Epic 5) layer onto the returned handle.
 */
export function buildGame(engine: Engine, overlay: HTMLElement): Game {
  const world = buildWorld(engine);
  const movement = buildMovement(engine, world, overlay);
  return { world, movement };
}
