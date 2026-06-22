import type { Engine } from "./engine/Engine.ts";
import { buildWorld, type World } from "./world/buildWorld.ts";
import { buildMovement, type Movement } from "./movement/buildMovement.ts";
import { buildDiscovery, type Discovery } from "./discovery/buildDiscovery.ts";
import { createSession, type GameSession } from "./gameSession.ts";
import { createHudStore, type HudStore } from "./ui/hudStore.ts";
import { HudSystem } from "./ui/HudSystem.ts";
import { createNavStore, type NavStore } from "./ui/navStore.ts";
import { NavSystem } from "./ui/NavSystem.ts";
import { createSettingsStore, type SettingsStore } from "./settings/settingsStore.ts";

export interface Game {
  world: World;
  movement: Movement;
  discovery: Discovery;
  session: GameSession;
  /** Throttled vehicle telemetry for the HUD (#42). */
  hud: HudStore;
  /** Projected nav hints to undiscovered landmarks (#44). */
  nav: NavStore;
  /** Persisted player settings (#41), read/written by the pause menu. */
  settings: SettingsStore;
}

/**
 * Compose the whole playable game into an engine: the world (Epic 2), the
 * vehicle/input/camera (Epic 3), discovery (Epic 4) and the shell overlays —
 * HUD, nav hints, settings (Epic 5). This is the default `GameCanvas` builder.
 * `overlay` is the canvas container touch controls mount into.
 *
 * System update order is registration order, so the shell systems go in *after*
 * the systems they read: the HUD feed after the vehicle, and the nav projector
 * after the camera (both established by `buildMovement`). The returned stores are
 * what the React overlays subscribe to; `session` is the shared pause flag (set
 * while a reveal panel or the menu is open).
 */
export function buildGame(engine: Engine, overlay: HTMLElement): Game {
  const session = createSession();
  const world = buildWorld(engine);
  const movement = buildMovement(engine, world, overlay, session);
  const discovery = buildDiscovery(engine, world, movement, session);

  // HUD telemetry feed — registered after the vehicle so it reads fresh state.
  const hud = createHudStore();
  engine.addSystem(new HudSystem(movement.vehicle, hud));

  // Nav hints — registered after the camera so it reads the updated view matrix.
  const nav = createNavStore();
  engine.addSystem(
    new NavSystem(engine, movement.vehicle, discovery.pois, nav, discovery.store),
  );

  const settings = createSettingsStore();

  return { world, movement, discovery, session, hud, nav, settings };
}
