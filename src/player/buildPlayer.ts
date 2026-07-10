import type { Engine } from "../engine/Engine.ts";
import type { System, FrameContext } from "../engine/types.ts";
import type { World, ReducedMotionSource } from "../world/buildWorld.ts";
import type { GameSession } from "../gameSession.ts";
import { createPlayerInput, type PlayerInputController } from "./input.ts";
import { ExplorerSystem } from "./explorer.ts";
import { FirstPersonCameraSystem } from "./fpCamera.ts";
import { SPAWN } from "../world/worldConfig.ts";
import { createSwimZones } from "../world/waterZones.ts";

export interface Player {
  input: PlayerInputController;
  explorer: ExplorerSystem;
}

/**
 * Wire input → explorer → first-person camera into the engine, in update order
 * (pivot slice B — replaces buildMovement's vehicle/flight rig). Input polls
 * first so the control state is fresh, the explorer advances next, and the
 * camera reads the updated state last. `overlay` is the DOM element the touch
 * controls mount into and the pointer-lock target. Spawns at the expedition
 * camp (worldConfig.SPAWN), waking up facing the lagoon.
 */
export function buildPlayer(
  engine: Engine,
  world: World,
  overlay: HTMLElement,
  session: GameSession,
  motion?: ReducedMotionSource,
  /** Survival's sprint gate (stamina left?). Absent = always allowed. */
  canSprint?: () => boolean,
): Player {
  const input = createPlayerInput(overlay, undefined, () => !session.paused);
  engine.addSystem(new InputPollSystem(input, session));

  const explorer = new ExplorerSystem(
    input,
    world.terrain,
    world.boundaries,
    world.waterDepthAt,
    { x: SPAWN.x, z: SPAWN.z, yaw: SPAWN.yaw },
    session,
    canSprint,
    // Where deep water swims (the lagoon) vs grips (the river current, #184).
    createSwimZones(),
  );
  engine.addSystem(explorer);

  engine.addSystem(new FirstPersonCameraSystem(engine, explorer, motion));

  return { input, explorer };
}

/** Polls all input sources once per frame, before the explorer reads them. Owns
 *  the input controller's teardown. While the session is paused (a panel or
 *  menu is up) it asks the controller to release its pointer lock so the cursor
 *  is available — the *when* lives here, every lock transition lives in input. */
class InputPollSystem implements System {
  readonly id = "input";
  constructor(
    private readonly input: PlayerInputController,
    private readonly session?: GameSession,
  ) {}
  update(ctx: FrameContext): void {
    this.input.update(ctx.dt);
    if (this.session?.paused) this.input.releasePointerLock();
  }
  describe(): Record<string, unknown> {
    return { touch: this.input.touchActive };
  }
  dispose(): void {
    this.input.dispose();
  }
}
