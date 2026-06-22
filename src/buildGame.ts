import type { Engine } from "./engine/Engine.ts";
import { buildWorld, type World } from "./world/buildWorld.ts";
import { buildMovement, type Movement } from "./movement/buildMovement.ts";
import { buildDiscovery, type Discovery } from "./discovery/buildDiscovery.ts";
import { createSession, type GameSession } from "./gameSession.ts";

export interface Game {
  world: World;
  movement: Movement;
  discovery: Discovery;
  session: GameSession;
}

/**
 * Compose the whole playable game into an engine: the world (Epic 2), the
 * vehicle/input/camera (Epic 3) and discovery (Epic 4). This is the default
 * `GameCanvas` builder. `overlay` is the canvas container touch controls mount
 * into. The returned `discovery.store` is what the React reveal UI subscribes
 * to; `session` is the shared pause flag (set while a panel is open).
 */
export function buildGame(engine: Engine, overlay: HTMLElement): Game {
  const session = createSession();
  const world = buildWorld(engine);
  const movement = buildMovement(engine, world, overlay, session);
  const discovery = buildDiscovery(engine, world, movement, session);
  return { world, movement, discovery, session };
}
